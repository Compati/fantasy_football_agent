import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreTrade } from "@/lib/features/trade";

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
