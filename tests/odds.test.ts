import { test } from "node:test";
import assert from "node:assert/strict";
import { impliedProbability, parseEventOdds, type RawEventOdds } from "@/lib/odds";
import { resolveTeam, teamAbbr, canonicalTeamName } from "@/lib/teams";

test("impliedProbability converts favorite (negative) American odds", () => {
  // -155 favorite: 155/255
  assert.ok(Math.abs(impliedProbability(-155) - 0.6078) < 0.001);
});

test("impliedProbability converts underdog (positive) American odds", () => {
  // +145 underdog: 100/245
  assert.ok(Math.abs(impliedProbability(145) - 0.4082) < 0.001);
});

test("resolveTeam matches abbreviation, full name, and known alias", () => {
  assert.equal(resolveTeam("SF")?.name, "San Francisco 49ers");
  assert.equal(resolveTeam("San Francisco 49ers")?.abbr, "SF");
  assert.equal(resolveTeam("Oakland Raiders")?.abbr, "LV"); // relocated franchise alias
  assert.equal(resolveTeam("not a team"), null);
});

test("teamAbbr and canonicalTeamName fall back sanely", () => {
  assert.equal(teamAbbr("Kansas City Chiefs"), "KC");
  assert.equal(teamAbbr("not a team"), null);
  assert.equal(canonicalTeamName("kc"), "Kansas City Chiefs");
  assert.equal(canonicalTeamName("not a team"), "not a team");
});

test("parseEventOdds prefers DraftKings and folds Over/Under into one line per player", () => {
  const data: RawEventOdds = {
    bookmakers: [
      {
        key: "fanduel",
        markets: [
          {
            key: "player_pass_yds",
            outcomes: [
              { name: "Over", description: "Jordan Love", price: -114, point: 226.5 },
              { name: "Under", description: "Jordan Love", price: -114, point: 226.5 },
            ],
          },
        ],
      },
      {
        key: "draftkings",
        markets: [
          {
            key: "player_pass_yds",
            outcomes: [
              { name: "Over", description: "Jordan Love", price: -113, point: 228.5 },
              { name: "Under", description: "Jordan Love", price: -111, point: 228.5 },
            ],
          },
          {
            key: "player_anytime_td",
            outcomes: [{ name: "Yes", description: "Bijan Robinson", price: -155 }],
          },
        ],
      },
    ],
  };
  const lines = parseEventOdds(data, ["player_pass_yds", "player_anytime_td"]);
  assert.equal(lines.length, 2);

  const pass = lines.find((l) => l.market === "player_pass_yds")!;
  assert.equal(pass.bookmaker, "draftkings"); // not fanduel, despite being listed first
  assert.equal(pass.playerName, "Jordan Love");
  assert.equal(pass.line, 228.5);
  assert.equal(pass.overPrice, -113);
  assert.equal(pass.underPrice, -111);

  const td = lines.find((l) => l.market === "player_anytime_td")!;
  assert.equal(td.playerName, "Bijan Robinson");
  assert.equal(td.yesPrice, -155);
  assert.equal(td.line, null);
});

test("parseEventOdds falls back to the first bookmaker when the preferred one is absent", () => {
  const data: RawEventOdds = {
    bookmakers: [
      {
        key: "betmgm",
        markets: [
          {
            key: "player_rush_yds",
            outcomes: [{ name: "Over", description: "Bijan Robinson", price: -110, point: 77.5 }],
          },
        ],
      },
    ],
  };
  const lines = parseEventOdds(data, ["player_rush_yds"]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].bookmaker, "betmgm");
});

test("parseEventOdds returns nothing for an event with no bookmakers", () => {
  assert.deepEqual(parseEventOdds({ bookmakers: [] }, ["player_pass_yds"]), []);
});
