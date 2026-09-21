import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSurvival, survivalProbability, type SurvivalTeam } from "@/lib/features/survival";

function t(teamName: string, projected: number, opts: Partial<SurvivalTeam> = {}): SurvivalTeam {
  return { teamName, projected, actual: 0, isMine: false, ...opts };
}

test("computeSurvival ranks by projection and finds the elimination line", () => {
  const teams = [
    t("Alpha", 130),
    t("Me", 110, { isMine: true }),
    t("Bravo", 95),
    t("Charlie", 88), // projected last -> on the block
  ];
  const r = computeSurvival(2, teams);
  assert.ok(r);
  assert.equal(r!.numActive, 4);
  assert.equal(r!.myRank, 2); // second-highest projection
  assert.equal(r!.eliminationLine, 88);
  assert.equal(r!.onTheBlock, "Charlie");
  assert.equal(r!.cushion, 22); // 110 - 88
  assert.equal(r!.standings[0].teamName, "Alpha"); // safest first
  assert.equal(r!.standings[3].teamName, "Charlie"); // most at risk last
});

test("computeSurvival: being projected last yields a negative cushion and self on the block", () => {
  const teams = [t("Alpha", 120), t("Bravo", 118), t("Me", 90, { isMine: true })];
  const r = computeSurvival(5, teams);
  assert.ok(r);
  assert.equal(r!.myRank, 3);
  assert.equal(r!.onTheBlock, "Me");
  assert.ok(r!.cushion < 0);
  assert.ok(r!.survivalProb! < 0.5); // clear favorite to be eliminated
});

test("computeSurvival ignores eliminated teams (no set starters -> projected 0)", () => {
  const teams = [
    t("Me", 100, { isMine: true }),
    t("Alive", 92),
    t("Eliminated", 0), // dispersed roster
  ];
  const r = computeSurvival(3, teams);
  assert.ok(r);
  assert.equal(r!.numActive, 2);
  assert.equal(r!.eliminationLine, 92);
});

test("computeSurvival returns null when there is no 'me' team among the active field", () => {
  assert.equal(computeSurvival(1, [t("A", 100), t("B", 90)]), null);
});

test("survivalProbability: a clear leader almost always survives; the field is not the low", () => {
  const p = survivalProbability(140, [95, 96, 98, 100]);
  assert.ok(p > 0.98, `expected >0.98, got ${p}`);
});

test("survivalProbability: last team standing always survives (nobody below you)", () => {
  assert.equal(survivalProbability(80, []), 1);
});

test("survivalProbability: two identical teams each have ~50% of being the low", () => {
  const p = survivalProbability(100, [100]);
  assert.ok(Math.abs(p - 0.5) < 0.02, `expected ~0.5, got ${p}`);
});
