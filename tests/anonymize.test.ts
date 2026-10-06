import { test } from "node:test";
import assert from "node:assert/strict";
import { anonymize, buildAliases } from "@/lib/agent/anonymize";

const teams = [
  { leagueName: "B League", externalId: "10", name: "Gridiron Greg ", isMine: false },
  { leagueName: "B League", externalId: "2", name: "My Squad", isMine: true },
  { leagueName: "B League", externalId: "3", name: "Bijan Mustard", isMine: false },
  { leagueName: "A League", externalId: "1", name: "Bijan Mustard", isMine: false },
  { leagueName: "A League", externalId: "4", name: "My Squad", isMine: false },
];

test("buildAliases numbers other teams per league in roster-id order", () => {
  const a = buildAliases(teams);
  assert.equal(a.get("bijan mustard"), "Team 1"); // first alias (A League) wins
  assert.equal(a.get("gridiron greg"), "Team 2"); // roster 3 before roster 10
  assert.equal(a.has("my squad"), false); // never alias my own team name
});

test("anonymize replaces whole string values only, at any depth", () => {
  const a = buildAliases(teams);
  const out = anonymize(
    {
      league: "B League",
      me: { teamName: "My Squad", projected: 101.2 },
      opponent: { teamName: "Gridiron Greg " },
      ideas: [{ partner: "Bijan Mustard", give: ["Bijan Robinson (RB)"] }],
      note: "Bijan Mustard is on the block",
    },
    a,
  );
  assert.deepEqual(out, {
    league: "B League",
    me: { teamName: "My Squad", projected: 101.2 },
    opponent: { teamName: "Team 2" },
    ideas: [{ partner: "Team 1", give: ["Bijan Robinson (RB)"] }],
    note: "Bijan Mustard is on the block",
  });
});
