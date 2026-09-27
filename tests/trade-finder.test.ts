import { test } from "node:test";
import assert from "node:assert/strict";
import { findTrades, horizonTotal, type TfPlayer, type TfTeam } from "@/lib/features/trade-finder";

const p = (id: string, position: string, value: number, proj: number[]): TfPlayer => ({
  sleeperId: id,
  name: id,
  position,
  value,
  projByWeek: proj,
});

const SLOTS = ["RB", "WR"];

test("horizonTotal sums the optimal lineup across weeks (byes count as 0)", () => {
  const players = [p("rb1", "RB", 100, [10, 0, 10]), p("rb2", "RB", 50, [5, 5, 5]), p("wr1", "WR", 100, [8, 8, 8])];
  // wk1 10+8, wk2 5+8 (rb1 on bye), wk3 10+8
  assert.equal(horizonTotal(players, SLOTS), 49);
});

test("findTrades finds a fair win-win swap of surplus for need", () => {
  // Me: two good RBs, a weak WR. Them: two good WRs, a weak RB.
  const me: TfTeam = {
    teamId: "me",
    name: "Me",
    players: [p("myRb1", "RB", 1000, [15, 15, 15]), p("myRb2", "RB", 900, [14, 14, 14]), p("myWr", "WR", 100, [4, 4, 4])],
  };
  const them: TfTeam = {
    teamId: "t",
    name: "Them",
    players: [p("thWr1", "WR", 1000, [15, 15, 15]), p("thWr2", "WR", 900, [14, 14, 14]), p("thRb", "RB", 100, [4, 4, 4])],
  };
  const [best] = findTrades(me, [them], SLOTS);
  assert.ok(best, "expected a trade idea");
  assert.deepEqual(best.give.map((x) => x.sleeperId), ["myRb2"]);
  // Their WR1 ($1000) for my RB2 ($900) is still fair (0.9x) and gains me the most.
  assert.deepEqual(best.get.map((x) => x.sleeperId), ["thWr1"]);
  assert.equal(best.myGain, 33); // WR slot 4 -> 15, x3 weeks
  assert.equal(best.theirGain, 27); // RB 4 -> 14 but WR 15 -> 14: +9, x3 weeks
});

test("findTrades rejects lopsided-value swaps and ones that hurt the partner", () => {
  const me: TfTeam = {
    teamId: "me",
    name: "Me",
    players: [p("myRb1", "RB", 1000, [15, 15, 15]), p("myScrub", "RB", 50, [2, 2, 2]), p("myWr", "WR", 100, [4, 4, 4])],
  };
  const them: TfTeam = {
    teamId: "t",
    name: "Them",
    players: [p("thWr1", "WR", 1000, [15, 15, 15]), p("thRb", "RB", 900, [14, 14, 14])],
  };
  // Scrub-for-star fails fairness; myRb1-for-thWr1 upgrades my WR slot but
  // leaves me an RB hole and them no gain in net -> nothing qualifies both ways.
  const ideas = findTrades(me, [them], SLOTS);
  for (const i of ideas) {
    assert.ok(i.giveValue >= 0.9 * i.getValue && i.giveValue <= 1.25 * i.getValue);
    assert.ok(i.theirGain >= 0);
  }
  assert.ok(!ideas.some((i) => i.give.some((x) => x.sleeperId === "myScrub") && i.get.some((x) => x.sleeperId === "thWr1")));
});

test("findTrades drops padded versions of the same deal", () => {
  const me: TfTeam = {
    teamId: "me",
    name: "Me",
    players: [
      p("myRb1", "RB", 1000, [15, 15, 15]),
      p("myRb2", "RB", 900, [14, 14, 14]),
      p("myPad", "TE", 100, [0, 0, 0]), // adds nothing to either lineup
      p("myWr", "WR", 100, [4, 4, 4]),
    ],
  };
  const them: TfTeam = {
    teamId: "t",
    name: "Them",
    players: [p("thWr1", "WR", 1000, [15, 15, 15]), p("thWr2", "WR", 900, [14, 14, 14]), p("thRb", "RB", 100, [4, 4, 4])],
  };
  const ideas = findTrades(me, [them], SLOTS, 10);
  assert.ok(!ideas.some((i) => i.give.some((x) => x.sleeperId === "myPad")));
});
