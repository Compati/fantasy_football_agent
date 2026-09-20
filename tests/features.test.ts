import { test } from "node:test";
import assert from "node:assert/strict";
import { faabSuggestion } from "@/lib/features/waivers";
import { scoreTrade } from "@/lib/features/trade";

test("faabSuggestion: bid scales with projection tier", () => {
  const stud = faabSuggestion(18, 0, 100);
  const streamer = faabSuggestion(10, 0, 100);
  const spec = faabSuggestion(4, 0, 100);
  assert.ok(stud.pct > streamer.pct);
  assert.ok(streamer.pct > spec.pct);
  assert.equal(stud.dollars, 45); // 45% of $100
});

test("faabSuggestion: trend nudges the bid up/down, budget optional", () => {
  const flat = faabSuggestion(12, 0, null);
  const hot = faabSuggestion(12, 500, null);
  const cold = faabSuggestion(12, -500, null);
  assert.ok(hot.pct > flat.pct);
  assert.ok(cold.pct < flat.pct);
  assert.equal(flat.dollars, null); // no budget -> no dollar amount
});

test("scoreTrade: even when totals match", () => {
  const v = scoreTrade([5000, 3000], [8000]);
  assert.equal(v.diff, 0);
  assert.equal(v.verdict, "Even trade");
  // fewer players received -> consolidation note
  assert.match(v.note ?? "", /consolidate/);
});

test("scoreTrade: clearly favors the side gaining value", () => {
  const v = scoreTrade([4000], [4000, 3000]);
  assert.ok(v.diff > 0);
  assert.match(v.verdict, /favors you/i);
  assert.match(v.note ?? "", /depth/);
});

test("scoreTrade: percentage is relative to the larger side", () => {
  const v = scoreTrade([100], [110]);
  assert.equal(v.pct, 9); // 10 / 110 ≈ 9%
  assert.equal(v.verdict, "Slightly favors you");
});
