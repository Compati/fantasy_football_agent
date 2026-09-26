import { test } from "node:test";
import assert from "node:assert/strict";
import { mae, pairwiseAccuracy, wouldWin } from "@/lib/backtest";

test("mae averages absolute errors", () => {
  assert.equal(mae([{ proj: 10, actual: 14 }, { proj: 10, actual: 8 }]), 3);
  assert.ok(Number.isNaN(mae([])));
});

test("pairwiseAccuracy counts correctly-ordered same-position pairs", () => {
  const r = pairwiseAccuracy([
    { position: "WR", proj: 15, actual: 20 },
    { position: "WR", proj: 12, actual: 10 }, // vs first: correct
    { position: "WR", proj: 11, actual: 25 }, // vs first: wrong; vs second: wrong
    { position: "RB", proj: 30, actual: 0 }, // different position: ignored
  ]);
  assert.deepEqual([r.correct, r.total], [1, 3]);
});

test("pairwiseAccuracy maxGap keeps only close calls", () => {
  const r = pairwiseAccuracy(
    [
      { position: "WR", proj: 15, actual: 20 },
      { position: "WR", proj: 14, actual: 10 },
      { position: "WR", proj: 5, actual: 1 },
    ],
    1.5,
  );
  assert.equal(r.total, 1);
});

test("wouldWin needs to beat every bid; ties lose", () => {
  assert.equal(wouldWin(14, [13, 13, 1]), true);
  assert.equal(wouldWin(13, [13, 1]), false);
  assert.equal(wouldWin(0, []), true);
});
