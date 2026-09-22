import { test } from "node:test";
import assert from "node:assert/strict";
import {
  byeWeekByTeam,
  computeByeOutlook,
  computeThinPositions,
  type RosterPlayer,
} from "@/lib/features/roster";
import type { SleeperGame } from "@/lib/sleeper";

// Minimal 4-team, 3-week schedule where each team byes once.
// wk1: A-B, C-D ; wk2: A-C (B & D off) ; wk3: A-D, B-C  -> byes: A none in 1-3?,...
function g(week: number, home: string, away: string): SleeperGame {
  return { week, home, away, status: "scheduled" };
}

test("byeWeekByTeam finds the week each team plays no game", () => {
  const games = [
    g(1, "A", "B"),
    g(1, "C", "D"),
    g(2, "A", "C"), // B, D off in week 2
    g(3, "B", "D"), // A, C off in week 3
  ];
  const byes = byeWeekByTeam(games);
  assert.equal(byes.get("B"), 2);
  assert.equal(byes.get("D"), 2);
  assert.equal(byes.get("A"), 3);
  assert.equal(byes.get("C"), 3);
});

const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"];
const roster: RosterPlayer[] = [
  { name: "QB1", position: "QB", nflTeam: "A" },
  { name: "RB1", position: "RB", nflTeam: "B" },
  { name: "RB2", position: "RB", nflTeam: "B" },
  { name: "WR1", position: "WR", nflTeam: "C" },
  { name: "WR2", position: "WR", nflTeam: "C" },
  { name: "TE1", position: "TE", nflTeam: "D" },
  { name: "FLEXguy", position: "WR", nflTeam: "A" },
];

test("computeByeOutlook lists future byes and flags a slot it can't fill", () => {
  // Team B byes week 6: both RBs off -> only 2 RB-capable left (WRs/TE via FLEX),
  // but two dedicated RB slots can't be filled.
  const byeByTeam = new Map([["B", 6]]);
  const out = computeByeOutlook(roster, SLOTS, byeByTeam, 5);
  assert.equal(out.length, 1);
  assert.equal(out[0].week, 6);
  assert.deepEqual(out[0].playersOnBye.map((p) => p.name).sort(), ["RB1", "RB2"]);
  // Two RB slots, zero available RBs -> two RB slots unfilled.
  assert.deepEqual(out[0].unfilledSlots.sort(), ["RB", "RB"]);
});

test("computeByeOutlook ignores past weeks and byes that leave a fillable lineup", () => {
  const byeByTeam = new Map([["D", 7]]); // only TE1 off; TE slot then unfilled
  const out = computeByeOutlook(roster, SLOTS, byeByTeam, 5);
  assert.equal(out.length, 1);
  assert.equal(out[0].week, 7);
  assert.deepEqual(out[0].unfilledSlots, ["TE"]); // no other TE on the roster

  // A bye before the current week is not reported.
  assert.equal(computeByeOutlook(roster, SLOTS, byeByTeam, 8).length, 0);
});

test("computeThinPositions flags positions with no bench behind the dedicated slots", () => {
  const thin = computeThinPositions(roster, SLOTS);
  // QB: 1 dedicated slot, 1 rostered -> thin (no backup).
  // TE: 1 dedicated slot, 1 rostered -> thin.
  // RB: 2 dedicated slots, 2 rostered -> thin (no depth beyond starters).
  // WR: 2 dedicated slots, 3 rostered (incl FLEXguy) -> NOT thin.
  const byPos = new Map(thin.map((t) => [t.position, t]));
  assert.ok(byPos.has("QB"));
  assert.ok(byPos.has("TE"));
  assert.ok(byPos.has("RB"));
  assert.ok(!byPos.has("WR"));
  assert.equal(byPos.get("RB")!.dedicatedStarters, 2);
  assert.equal(byPos.get("RB")!.have, 2);
});
