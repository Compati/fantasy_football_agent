import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlayerMatcher, matchPlayers } from "@/lib/ingest/news";

const players = [
  { sleeperId: "1", name: "Tyler Shough" },
  { sleeperId: "2", name: "Jaylen Waddle" },
  { sleeperId: "3", name: "A.J. Brown" },
  { sleeperId: "4", name: "Kenneth Walker" }, // one of two real-catalog namesakes
  { sleeperId: "5", name: "Kenneth Walker" },
];

test("matchPlayers finds a player named in a title", () => {
  const matcher = buildPlayerMatcher(players);
  const ids = matchPlayers("Tyler Shough is not rostered in enough leagues", matcher);
  assert.deepEqual(ids, ["1"]);
});

test("matchPlayers is punctuation/accent tolerant (shares normalizeName with the rest of the app)", () => {
  const matcher = buildPlayerMatcher(players);
  const ids = matchPlayers("AJ Brown left early with a knee issue", matcher);
  assert.deepEqual(ids, ["3"]);
});

test("matchPlayers only matches whole names, not substrings of unrelated words", () => {
  const matcher = buildPlayerMatcher(players);
  // "Waddleton" should not match "Waddle"
  const ids = matchPlayers("Coach Waddleton announced a new offense", matcher);
  assert.deepEqual(ids, []);
});

test("matchPlayers returns every sleeperId sharing an ambiguous name", () => {
  const matcher = buildPlayerMatcher(players);
  const ids = matchPlayers("Kenneth Walker exploded for two touchdowns", matcher);
  assert.deepEqual(ids.sort(), ["4", "5"]);
});

test("matchPlayers finds nothing when no tracked player is mentioned", () => {
  const matcher = buildPlayerMatcher(players);
  const ids = matchPlayers("Week 3 waiver wire roundup for every position", matcher);
  assert.deepEqual(ids, []);
});
