import { test } from "node:test";
import assert from "node:assert/strict";
import { bracketStatus, playoffOdds, teamStrengths, type PlayoffTeam, type RemainingGame } from "@/lib/features/playoffs";

function team(id: string, wins: number, losses: number, pointsFor: number, isMine = false): PlayoffTeam {
  return { id, name: `Team ${id}`, isMine, wins, losses, ties: 0, pointsFor };
}

// 4 teams, 2 playoff spots, 2 weeks left. Everyone has played 6 games.
const teams = [
  team("1", 6, 0, 800), // far ahead
  team("2", 4, 2, 720, true), // me
  team("3", 2, 4, 640),
  team("4", 0, 6, 560), // hopeless
];
const games: RemainingGame[] = [
  { week: 7, a: "1", b: "4" },
  { week: 7, a: "2", b: "3" },
  { week: 8, a: "1", b: "3" },
  { week: 8, a: "2", b: "4" },
];

test("playoffOdds: leader is near-certain, last place near-impossible, spots sum to the cut", () => {
  const { odds } = playoffOdds(teams, games, 2, { forceWeek: 7 });
  assert.ok(odds.get("1")! > 0.98);
  assert.ok(odds.get("4")! < 0.01);
  const total = [...odds.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 2) < 1e-9, `top-2 odds must sum to 2, got ${total}`);
});

test("playoffOdds: winning this week beats losing it, and is deterministic", () => {
  const a = playoffOdds(teams, games, 2, { forceWeek: 7 });
  const b = playoffOdds(teams, games, 2, { forceWeek: 7 });
  assert.equal(a.odds.get("2"), b.odds.get("2")); // seeded
  assert.ok(a.ifWin != null && a.ifLoss != null);
  assert.ok(a.ifWin! > a.odds.get("2")!);
  assert.ok(a.ifLoss! < a.odds.get("2")!);
});

test("playoffOdds: no game for me in the forced week -> no conditional odds", () => {
  const r = playoffOdds(teams, games, 2, { forceWeek: 9 });
  assert.equal(r.ifWin, null);
  assert.equal(r.ifLoss, null);
});

test("playoffOdds: no games left means the current standings decide it", () => {
  const { odds } = playoffOdds(teams, [], 2);
  assert.equal(odds.get("1"), 1);
  assert.equal(odds.get("2"), 1);
  assert.equal(odds.get("3"), 0);
});

test("teamStrengths shrinks small samples toward the league mean", () => {
  const s = teamStrengths([team("a", 1, 0, 200), team("b", 0, 1, 80)]);
  const mean = 140;
  assert.ok(s.get("a")! < 200 && s.get("a")! > mean);
  assert.ok(s.get("b")! > 80 && s.get("b")! < mean);
});

test("bracketStatus: alive in round 1, eliminated, champion, and not in bracket", () => {
  const r1 = [
    { r: 1, m: 1, t1: 3, t2: 6, w: null, l: null },
    { r: 1, m: 2, t1: 4, t2: 5, w: null, l: null },
    { r: 2, m: 3, t1: null, t2: null, w: null, l: null },
    { r: 2, m: 4, t1: null, t2: null, w: null, l: null, p: 3 }, // 3rd-place game ignored
  ];
  assert.deepEqual(bracketStatus(r1, "3"), { status: "alive", round: 1, rounds: 2, opponentRosterId: "6" });
  assert.equal(bracketStatus(r1, "9").status, "not_in_bracket");

  const done = [
    { r: 1, m: 1, t1: 3, t2: 6, w: 3, l: 6 },
    { r: 1, m: 2, t1: 4, t2: 5, w: 5, l: 4 },
    { r: 2, m: 3, t1: 3, t2: 5, w: 5, l: 3 },
  ];
  assert.equal(bracketStatus(done, "5").status, "champion");
  assert.deepEqual(bracketStatus(done, "3"), { status: "eliminated", round: 2, rounds: 2, opponentRosterId: "5" });
  assert.equal(bracketStatus(done, "6").status, "eliminated");

  // Won round 1; the next round isn't filled in yet -> alive, heading into round 2.
  const advancing = [
    { r: 1, m: 1, t1: 3, t2: 6, w: 3, l: 6 },
    { r: 2, m: 2, t1: null, t2: null, w: null, l: null },
  ];
  assert.deepEqual(bracketStatus(advancing, "3"), { status: "alive", round: 2, rounds: 2, opponentRosterId: null });
});
