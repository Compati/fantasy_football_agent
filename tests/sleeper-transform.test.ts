import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLeagueSettings,
  starterSlots,
  rosterToSpots,
} from "@/lib/ingest/sleeper-transform";
import type { SleeperLeague, SleeperRoster } from "@/lib/sleeper";

function league(overrides: Partial<SleeperLeague>): SleeperLeague {
  return {
    league_id: "L1",
    name: "Test",
    season: "2026",
    total_rosters: 12,
    scoring_settings: { rec: 1 },
    roster_positions: ["QB", "RB", "RB", "WR", "WR", "FLEX", "BN", "BN"],
    settings: {},
    ...overrides,
  };
}

test("parseLeagueSettings: full PPR, redraft, standard QB", () => {
  const n = parseLeagueSettings(league({}));
  assert.equal(n.ppr, 1);
  assert.equal(n.numQbs, 1);
  assert.equal(n.numTeams, 12);
});

test("parseLeagueSettings: half PPR maps to 0.5, standard to 0", () => {
  assert.equal(parseLeagueSettings(league({ scoring_settings: { rec: 0.5 } })).ppr, 0.5);
  assert.equal(parseLeagueSettings(league({ scoring_settings: { rec: 0 } })).ppr, 0);
});

test("parseLeagueSettings: superflex -> numQbs 2, FAAB budget from settings", () => {
  const n = parseLeagueSettings(
    league({
      roster_positions: ["QB", "SUPER_FLEX", "RB", "BN"],
      settings: { waiver_budget: 100 },
      total_rosters: 10,
    }),
  );
  assert.equal(n.numQbs, 2);
  assert.equal(n.faabBudget, 100);
  assert.equal(n.numTeams, 10);
});

test("starterSlots drops BN/IR/TAXI", () => {
  const slots = starterSlots(["QB", "RB", "FLEX", "BN", "IR", "TAXI"]);
  assert.deepEqual(slots, ["QB", "RB", "FLEX"]);
});

test("rosterToSpots: starters aligned to slots, empty '0' skipped, bench filled", () => {
  const slots = ["QB", "RB", "FLEX"];
  const roster: SleeperRoster = {
    roster_id: 1,
    owner_id: "u1",
    starters: ["p_qb", "0", "p_flex"], // middle slot unfilled
    players: ["p_qb", "p_flex", "p_bench"],
    settings: {},
  };
  const detail = new Map([
    ["p_qb", { name: "QB Guy", position: "QB", nflTeam: "SF" }],
    ["p_flex", { name: "Flex Guy", position: "WR", nflTeam: "KC" }],
    ["p_bench", { name: "Bench Guy", position: "RB", nflTeam: "DAL" }],
  ]);

  const spots = rosterToSpots(roster, slots, detail);
  const starters = spots.filter((s) => s.starter);
  const bench = spots.filter((s) => !s.starter);

  assert.equal(starters.length, 2); // the "0" slot produced no spot
  assert.equal(starters[0].slot, "QB");
  assert.equal(starters[0].name, "QB Guy");
  assert.equal(starters[1].slot, "FLEX"); // aligned by original index (2)
  assert.equal(starters[1].name, "Flex Guy");

  assert.equal(bench.length, 1);
  assert.equal(bench[0].name, "Bench Guy");
  assert.equal(bench[0].slot, "BN");
});

test("rosterToSpots: unknown player falls back to id, not a crash", () => {
  const spots = rosterToSpots(
    { roster_id: 2, owner_id: "u", starters: ["mystery"], players: ["mystery"], settings: {} },
    ["QB"],
    new Map(),
  );
  assert.equal(spots.length, 1);
  assert.equal(spots[0].name, "mystery");
  assert.equal(spots[0].position, "?");
});
