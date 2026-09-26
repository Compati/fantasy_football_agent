import { test } from "node:test";
import assert from "node:assert/strict";
import { faabTier, faabRange, faabNeed, bidForNeed, claimSamples, leagueSpendFactor, percentile, type ClaimSample } from "@/lib/features/faab";

test("faabTier takes the higher of value tier and projection tier", () => {
  assert.equal(faabTier("WR", 8, 3000, 1), "impact"); // market value carries it
  assert.equal(faabTier("RB", 15.5, 50, 1), "impact"); // projection carries it
  assert.equal(faabTier("WR", 8, 100, 1), "flex");
  assert.equal(faabTier("TE", 4, 0, 1), "depth");
  assert.equal(faabTier("DEF", 12, 0, 1), "dst_k");
});

test("faabTier shifts QBs down one notch in 1-QB leagues, not superflex", () => {
  assert.equal(faabTier("QB", 15.7, 60, 1), "starter"); // streaming QB in 1QB
  assert.equal(faabTier("QB", 15.7, 60, 2), "impact"); // same QB in superflex
});

test("percentile interpolates", () => {
  assert.equal(percentile([0, 10], 0.5), 5);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.9), 4.6);
  assert.equal(percentile([], 0.5), 0);
});

// neededPct defaults to the winning pct (as if the runner-up bid just under it).
const s = (leagueId: string, tier: ClaimSample["tier"], pct: number, neededPct = pct): ClaimSample => ({
  leagueId,
  tier,
  pct,
  neededPct,
  contested: neededPct > 0,
});

test("faabRange uses the league's own bids when it has enough of them", () => {
  const samples = [s("A", "starter", 2), s("A", "starter", 4), s("A", "starter", 10), s("B", "starter", 40)];
  const r = faabRange("starter", "A", samples, 1000, 800);
  assert.equal(r.basis, "league");
  assert.equal(r.low, 40); // median 4% of $1000
  assert.equal(r.high, 76); // p80 7.6%
  assert.equal(r.samples, 3);
});

test("faabRange borrows pooled prices scaled by league spend when thin", () => {
  // League B's flex bids (4%) vs the pooled flex median (3.5%) -> factor ~1.14.
  const samples = [
    s("A", "flex", 1), s("A", "flex", 2), s("A", "flex", 3),
    s("B", "flex", 4), s("B", "flex", 4), s("B", "flex", 4),
    s("A", "starter", 5), s("A", "starter", 5), s("A", "starter", 5),
  ];
  assert.ok(Math.abs(leagueSpendFactor("B", samples) - 4 / 3.5) < 1e-9);
  const r = faabRange("starter", "B", samples, 100, null);
  assert.equal(r.basis, "pooled");
  assert.equal(r.low, 6); // 5% x 1.14 of $100 = 5.7
});

test("faabRange falls back to defaults with no history, caps at remaining budget", () => {
  const r = faabRange("impact", "A", [], 100, 20);
  assert.equal(r.basis, "default");
  assert.equal(r.low, 15);
  assert.equal(r.high, 20); // 35 capped at the $20 left
});

test("faabRange never puts a better tier's going rate below a worse tier's", () => {
  // Thin, cheap 'starter' history but pricey 'flex' history in the same league.
  const samples = [s("A", "flex", 10), s("A", "flex", 20), s("A", "flex", 30), s("A", "starter", 1), s("A", "starter", 2), s("A", "starter", 3)];
  const starter = faabRange("starter", "A", samples, 100, null);
  const flex = faabRange("flex", "A", samples, 100, null);
  assert.ok(starter.low >= flex.low);
  assert.ok(starter.high > starter.low);
  assert.equal(starter.basis, "league"); // basis still describes the tier's own data
});

test("faabNeed + bidForNeed: clear upgrade -> high, marginal -> midpoint, else low", () => {
  assert.equal(faabNeed(15.7, 11), "starts"); // +4.7
  assert.equal(faabNeed(15.7, 14.73), "marginal"); // +1
  assert.equal(faabNeed(9, 12), "depth");
  assert.equal(faabNeed(9, null), "depth"); // no eligible slot
  assert.equal(faabNeed(8, 0), "starts"); // fills an empty/ruled-out slot
  const range = { low: 10, high: 30 };
  assert.equal(bidForNeed(range, "starts"), 30);
  assert.equal(bidForNeed(range, "marginal"), 20);
  assert.equal(bidForNeed(range, "depth"), 10);
});

test("claimSamples pairs each winner with its runner-up; uncontested needs $0", () => {
  const out = claimSamples(
    "A",
    100,
    [
      { week: 2, sleeperId: "p1", bid: 76, won: true },
      { week: 2, sleeperId: "p1", bid: 27, won: false },
      { week: 2, sleeperId: "p1", bid: 13, won: false },
      { week: 2, sleeperId: "p2", bid: 32, won: true }, // nobody else bid
      { week: 3, sleeperId: "p3", bid: 5, won: false }, // all-failed: no price signal
    ],
    () => "flex",
  );
  assert.equal(out.length, 2);
  const p1 = out.find((x) => x.pct === 76)!;
  assert.equal(p1.neededPct, 28); // beat the $27 runner-up by $1
  assert.equal(p1.contested, true);
  const p2 = out.find((x) => x.pct === 32)!;
  assert.equal(p2.neededPct, 0);
  assert.equal(p2.contested, false);
});

test("faabRange low end tracks casual interest (runner-up), high end the winners", () => {
  // Winners overpaid: won at 20%, but the runner-up was at ~2% (or nobody).
  const samples = [s("A", "flex", 20, 2), s("A", "flex", 20, 0), s("A", "flex", 20, 3)];
  const r = faabRange("flex", "A", samples, 100, null);
  assert.equal(r.low, 2);
  assert.equal(r.high, 20);
  assert.ok(Math.abs(r.contestedShare! - 2 / 3) < 1e-9);
});

test("bidForNeed: a hot marginal upgrade gets the high end; hot depth stays low", () => {
  const range = { low: 10, high: 30 };
  assert.equal(bidForNeed(range, "marginal", true), 30);
  assert.equal(bidForNeed(range, "depth", true), 10);
});
