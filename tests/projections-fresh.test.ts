import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ensureProjectionsFresh,
  projectionStatus,
  ProjectionsUnavailableError,
  MIN_PROJECTION_ROWS,
  PROJECTION_STALE_MS,
  type FreshnessDeps,
} from "@/lib/ingest/projections";

const NOW = Date.UTC(2026, 10, 13, 12);
const recent = new Date(NOW - 60 * 60 * 1000);
const old = new Date(NOW - PROJECTION_STALE_MS - 1000);

test("projectionStatus: empty / thin weeks are missing, old ones stale, recent ok", () => {
  assert.equal(projectionStatus(0, null, NOW), "missing");
  assert.equal(projectionStatus(MIN_PROJECTION_ROWS - 1, recent, NOW), "missing");
  assert.equal(projectionStatus(500, old, NOW), "stale");
  assert.equal(projectionStatus(500, recent, NOW), "ok");
});

// A fake store: `refresh` loads `loadedRows` rows (or throws).
function fake(initial: { rows: number; newest: Date | null }, opts: { loadedRows?: number; fail?: string } = {}) {
  let state = { ...initial };
  let refreshes = 0;
  const deps: FreshnessDeps = {
    stats: async () => state,
    refresh: async () => {
      refreshes++;
      if (opts.fail) throw new Error(opts.fail);
      state = { rows: opts.loadedRows ?? 800, newest: new Date(NOW) };
    },
    now: () => NOW,
  };
  return { deps, refreshes: () => refreshes };
}

test("fresh data: no refresh", async () => {
  const f = fake({ rows: 800, newest: recent });
  await ensureProjectionsFresh(2026, 101, f.deps);
  assert.equal(f.refreshes(), 0);
});

test("empty week: refreshes, then succeeds", async () => {
  const f = fake({ rows: 0, newest: null });
  await ensureProjectionsFresh(2026, 102, f.deps);
  assert.equal(f.refreshes(), 1);
});

test("empty week and the refresh yields nothing: throws 'not loaded', never zeros", async () => {
  const f = fake({ rows: 0, newest: null }, { loadedRows: 0 });
  await assert.rejects(ensureProjectionsFresh(2026, 103, f.deps), (e: Error) => {
    assert.ok(e instanceof ProjectionsUnavailableError);
    assert.match(e.message, /Week 103 projections are not loaded/);
    return true;
  });
});

test("empty week and the refresh throws: reports the cause", async () => {
  const f = fake({ rows: 0, newest: null }, { fail: "FFToday 403" });
  await assert.rejects(ensureProjectionsFresh(2026, 104, f.deps), /FFToday 403/);
});

test("stale week and the refresh fails: carries on with the old rows", async () => {
  const f = fake({ rows: 800, newest: old }, { fail: "site down" });
  await ensureProjectionsFresh(2026, 105, f.deps);
  assert.equal(f.refreshes(), 1);
});

test("after a failed refresh, the next call doesn't re-scrape (cooldown)", async () => {
  const f = fake({ rows: 800, newest: old }, { fail: "site down" });
  await ensureProjectionsFresh(2026, 106, f.deps);
  await ensureProjectionsFresh(2026, 106, f.deps);
  assert.equal(f.refreshes(), 1);
});

test("parallel callers share one refresh", async () => {
  const f = fake({ rows: 0, newest: null });
  await Promise.all([1, 2, 3].map(() => ensureProjectionsFresh(2026, 107, f.deps)));
  assert.equal(f.refreshes(), 1);
});
