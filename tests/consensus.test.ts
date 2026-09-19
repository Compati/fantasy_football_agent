import { test } from "node:test";
import assert from "node:assert/strict";
import { blendProjections } from "@/lib/projections/consensus";
import type { ProjectionRow } from "@/lib/types";

function row(sleeperId: string, source: ProjectionRow["source"], points: number): ProjectionRow {
  return { sleeperId, source, season: 2026, week: 2, points };
}

test("single source: consensus equals that value, n=1", () => {
  const c = blendProjections([row("a", "sleeper", 12.5)]).get("a")!;
  assert.equal(c.points, 12.5);
  assert.equal(c.n, 1);
  assert.equal(c.spread, 0);
});

test("two sources: average, spread = difference", () => {
  const c = blendProjections([row("a", "sleeper", 10), row("a", "espn", 14)]).get("a")!;
  assert.equal(c.points, 12);
  assert.equal(c.n, 2);
  assert.equal(c.spread, 4);
  assert.deepEqual(c.sources.sort(), ["espn", "sleeper"]);
});

test("three+ sources: trimmed mean drops the min and max", () => {
  // values 5, 10, 30 -> drop 5 and 30 -> mean of {10} = 10
  const c = blendProjections([
    row("a", "sleeper", 5),
    row("a", "espn", 10),
    row("a", "cbs", 30),
  ]).get("a")!;
  assert.equal(c.points, 10);
  assert.equal(c.spread, 25);
  assert.equal(c.n, 3);
});

test("separate players are grouped independently", () => {
  const m = blendProjections([row("a", "sleeper", 8), row("b", "sleeper", 20)]);
  assert.equal(m.get("a")!.points, 8);
  assert.equal(m.get("b")!.points, 20);
  assert.equal(m.size, 2);
});
