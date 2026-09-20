import { test } from "node:test";
import assert from "node:assert/strict";
import { optimizeLineup, type LineupPlayer } from "@/lib/features/startsit";

function p(sleeperId: string, position: string, proj: number): LineupPlayer {
  return { sleeperId, position, proj, name: sleeperId, sources: 1 };
}

test("optimizeLineup respects eligibility: QB can't fill FLEX, fills SUPER_FLEX", () => {
  const players = [
    p("QB1", "QB", 20),
    p("QB2", "QB", 18),
    p("RB1", "RB", 15),
    p("WR1", "WR", 14),
    p("WR2", "WR", 10),
    p("TE1", "TE", 8),
  ];
  const slots = ["QB", "RB", "WR", "FLEX", "SUPER_FLEX"];
  const { lineup, total, starterIds } = optimizeLineup(players, slots);

  const bySlot = new Map(lineup.map((a) => [a.slot, a.player?.sleeperId]));
  assert.equal(bySlot.get("QB"), "QB1");
  assert.equal(bySlot.get("RB"), "RB1");
  assert.equal(bySlot.get("WR"), "WR1");
  assert.equal(bySlot.get("FLEX"), "WR2"); // best remaining RB/WR/TE (not QB2)
  assert.equal(bySlot.get("SUPER_FLEX"), "QB2"); // QB2 slots into superflex
  assert.equal(total, 77); // 20+15+14+10+18
  assert.ok(!starterIds.has("TE1")); // TE benched
});

test("optimizeLineup: superflex is filled by the best leftover even if it's a QB", () => {
  // Only one specific QB slot; the second QB is more valuable than any flex-type,
  // so the greedy (restrictive-first) order must still place it in SUPER_FLEX.
  const players = [p("QB1", "QB", 25), p("QB2", "QB", 22), p("RB1", "RB", 12)];
  const { lineup } = optimizeLineup(players, ["QB", "SUPER_FLEX"]);
  const bySlot = new Map(lineup.map((a) => [a.slot, a.player?.sleeperId]));
  assert.equal(bySlot.get("QB"), "QB1");
  assert.equal(bySlot.get("SUPER_FLEX"), "QB2");
});

test("optimizeLineup: leaves a slot empty when no eligible player remains", () => {
  const { lineup } = optimizeLineup([p("WR1", "WR", 10)], ["WR", "QB"]);
  const qb = lineup.find((a) => a.slot === "QB");
  assert.equal(qb?.player, null);
});
