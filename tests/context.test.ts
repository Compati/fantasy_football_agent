import { test } from "node:test";
import assert from "node:assert/strict";
import { benchOf, toBenchEntries, describeDvp } from "@/lib/agent/context";
import type { LineupPlayer } from "@/lib/features/startsit";

const lp = (sleeperId: string, position: string, proj: number, injuryStatus: string | null = null): LineupPlayer => ({
  sleeperId,
  name: sleeperId,
  position,
  proj,
  sources: 4,
  injuryStatus,
});

test("bench keeps each bench player's own projection (regression: was always 0)", () => {
  const starter = lp("starter", "WR", 15);
  const players = [starter, lp("tucker", "WR", 10.21), lp("coleman", "RB", 0, "Out")];
  const bench = toBenchEntries(benchOf(players, [{ slot: "WR", player: starter }]), new Map([["coleman", 509]]));
  assert.deepEqual(bench, [
    { player: "tucker", position: "WR", proj: 10.21, marketValue: 0, injuryStatus: null },
    { player: "coleman", position: "RB", proj: 0, marketValue: 509, injuryStatus: "Out" },
  ]);
});

test("describeDvp spells out that rank 1 = allows the most (easy matchup)", () => {
  assert.equal(describeDvp("DET", 1, "QB"), "DET allows the 1st-most PPR points to QBs (of 32; easy matchup)");
  assert.match(describeDvp("PIT", 32, "WR"), /32nd-most .*hard matchup/);
  assert.match(describeDvp("NYG", 12, "TE"), /12th-most .*average matchup/);
});
