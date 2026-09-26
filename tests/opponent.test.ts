import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeDefenseVsPosition,
  impliedTotals,
  matchupEdge,
  matchupLabel,
  closeCallLean,
} from "@/lib/features/opponent";
import { parseGameLines } from "@/lib/odds";

test("computeDefenseVsPosition sums per game faced, shrinks toward the average, ranks most-allowed first", () => {
  const rows = [
    // DET allowed two WRs 20 + 10 in week 1 (one game = 30) and 30 in week 2.
    { week: 1, opponent: "DET", position: "WR", points: 20 },
    { week: 1, opponent: "DET", position: "WR", points: 10 },
    { week: 2, opponent: "DET", position: "WR", points: 30 },
    // PIT allowed 10 per game.
    { week: 1, opponent: "PIT", position: "WR", points: 10 },
    { week: 2, opponent: "PIT", position: "WR", points: 10 },
  ];
  const [det, pit] = computeDefenseVsPosition(rows);
  assert.equal(det.team, "DET");
  assert.equal(det.games, 2);
  assert.equal(det.perGame, 30);
  // league avg per game = 80 / 4 = 20; adjusted = (60 + 2·20) / (2 + 2) = 25
  assert.equal(det.adjusted, 25);
  assert.equal(det.rank, 1);
  assert.equal(pit.adjusted, 15); // (20 + 40) / 4
  assert.equal(pit.rank, 2);
});

test("impliedTotals splits the total by the home spread", () => {
  // Home favored by 7 in a 50.5 total -> 28.75 vs 21.75
  assert.deepEqual(impliedTotals(50.5, -7), { home: 28.75, away: 21.75 });
  assert.deepEqual(impliedTotals(44, 3), { home: 20.5, away: 23.5 });
});

test("matchupEdge averages the available signals; missing ones are neutral", () => {
  assert.equal(matchupEdge(27.5, 22, 25, 20), 0.25); // (+25% + +25%) / 2
  assert.equal(matchupEdge(null, 22, 18, 20), -0.1); // DvP only
  assert.equal(matchupEdge(null, null, null, null), 0);
});

test("matchupLabel buckets and closeCallLean only flips on a clear gap", () => {
  assert.equal(matchupLabel(0.1), "great");
  assert.equal(matchupLabel(0.04), "good");
  assert.equal(matchupLabel(0), "neutral");
  assert.equal(matchupLabel(-0.05), "hard");
  assert.equal(matchupLabel(-0.2), "tough");
  assert.equal(closeCallLean(-0.05, 0.05), "alternative");
  assert.equal(closeCallLean(0.1, 0.0), "starter");
  assert.equal(closeCallLean(0.02, 0.05), null);
});

test("parseGameLines prefers DraftKings and falls back per market", () => {
  const lines = parseGameLines([
    {
      commence_time: "2026-09-27T17:00:00Z",
      home_team: "Buffalo Bills",
      away_team: "Los Angeles Chargers",
      bookmakers: [
        { key: "fanduel", markets: [{ key: "totals", outcomes: [{ name: "Over", point: 51 }] }] },
        { key: "draftkings", markets: [{ key: "spreads", outcomes: [{ name: "Buffalo Bills", point: -7 }, { name: "Los Angeles Chargers", point: 7 }] }] },
      ],
    },
  ]);
  assert.equal(lines[0].homeSpread, -7);
  assert.equal(lines[0].total, 51); // DraftKings had no total -> FanDuel's
  assert.equal(lines[0].homeTeam, "Buffalo Bills");
});
