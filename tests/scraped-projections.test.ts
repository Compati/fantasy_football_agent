import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCbsPage } from "@/lib/projections/cbs";
import { parseFftodayPage } from "@/lib/projections/fftoday";
import { toRows, type ScrapedProjection } from "@/lib/projections/scraped";

// Trimmed-down copies of the real markup (whitespace and stat cells reduced).
const td = (v: string) => `<td class="TableBase-bodyTd TableBase-bodyTd--number">\n  ${v}   </td>`;
const cbsPlayerRow = (short: string, long: string, pos: string, team: string, fpts: string) =>
  `<tr class="TableBase-bodyTr"><td class="TableBase-bodyTd"><span class="CellPlayerName--short"><span class=""><a href="/nfl/players/1/x/fantasy/" class="">${short}</a><span class="CellPlayerName-position">
    ${pos}</span><span class="CellPlayerName-team">
    ${team}</span></span></span><span class="CellPlayerName--long"><span class=""><a href="/nfl/players/1/x/fantasy/" class="">${long}</a><span class="CellPlayerName-position">
    ${pos}</span><span class="CellPlayerName-team">
    ${team}</span></span></span></td>${td("1")}${td("233.0")}${td(fpts)}${td(fpts)}</tr>`;

test("parseCbsPage reads the long name, team, and fpts (second-to-last cell)", () => {
  const html =
    "<table><tbody>" +
    cbsPlayerRow("J. Allen", "Josh Allen", "QB", "BUF", "23.1") +
    cbsPlayerRow("T. Etienne", "Travis Etienne Jr.", "RB", "JAC", "14.8") +
    "</tbody></table>";
  const rows = parseCbsPage(html, "QB");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: "Josh Allen", position: "QB", team: "BUF", points: 23.1 });
  assert.equal(rows[1].name, "Travis Etienne Jr.");
  assert.equal(rows[1].team, "JAX"); // CBS's legacy JAC normalized to Sleeper's abbrev
});

test("parseCbsPage rescores QBs to 4-pt passing TDs using the header's passing_td column", () => {
  const header = ["player", "gp", "passing_yds", "passing_td", "misc_fpts", "misc_fppg"]
    .map((c) => `<th><a href="?sortcol=${c}&amp;sortdir=descending">x</a></th>`)
    .join("");
  const row =
    `<tr class="TableBase-bodyTr"><td class="TableBase-bodyTd"><span class="CellPlayerName--long"><span class=""><a href="/x">Josh Allen</a>` +
    `<span class="CellPlayerName-position">QB</span><span class="CellPlayerName-team">BUF</span></span></span></td>` +
    `${td("1")}${td("233.0")}${td("2.0")}${td("28.4")}${td("28.4")}</tr>`;
  const [allen] = parseCbsPage(`<thead><tr>${header}</tr></thead><tbody>${row}</tbody>`, "QB");
  assert.equal(allen.points, 24.4); // 28.4 − 2 × 2.0 pass TD
});

test("parseFftodayPage reads player rows and last-cell FPts, skipping headers", () => {
  const cell = (v: string) => `<TD class="smallbody" ALIGN="center" BGCOLOR="#ffffff">${v}</TD>\n`;
  const row = (id: number, name: string, team: string, fpts: string) =>
    `<TR>\n<TD class="bodycontent" ALIGN="center">&nbsp;</TD>\n<TD class="smallbody" ALIGN="LEFT">&nbsp;<A HREF="/stats/players/${id}/${name.replace(/ /g, "_")}?LeagueID=107644">${name}</A>   </TD>\n` +
    cell(team) + cell("NYJ") + cell("19.0") + cell("95.0") + cell("1.0") + cell(fpts) + "</TR>\n";
  const html =
    `<TR><TD ALIGN='center' NOWRAP><B>FPts</B></TD></TR>\n` +
    row(18522, "Jahmyr Gibbs", "DET", "23.3") +
    row(1, "Ja&#039;Marr Chase", "CIN", "19.4");
  const rows = parseFftodayPage(html, "RB");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: "Jahmyr Gibbs", position: "RB", team: "DET", points: 23.3 });
  assert.equal(rows[1].name, "Ja'Marr Chase"); // entity decoded

  // QB page: Chg, Player, Team, Opp, Comp, Att, Yard, TD, INT, Att, Yard, TD, FPts.
  const qbRow =
    `<TR>\n<TD>&nbsp;</TD>\n<TD>&nbsp;<A HREF="/stats/players/16228/Josh_Allen?LeagueID=107644">Josh Allen</A></TD>\n` +
    ["BUF", "LAC", "22.0", "33.0", "257.0", "1.7", "0.3", "8.0", "38.0", "0.9", "28.9"].map(cell).join("") +
    "</TR>\n";
  const qb = parseFftodayPage(qbRow, "QB");
  assert.equal(qb[0].points, 25.5); // 28.9 − 2 × 1.7 pass TD (rushing TD 0.9 untouched)
});

test("toRows resolves, counts misses, and keeps the first row for a repeated player", () => {
  const scraped: ScrapedProjection[] = [
    { name: "A", position: "RB", team: "DET", points: 10.456 },
    { name: "Nobody", position: "RB", team: "DET", points: 5 },
    { name: "A dup", position: "RB", team: "DET", points: 3 },
  ];
  const res = toRows(scraped, (p) => (p.name.startsWith("A") ? "id-a" : null), "cbs", 2026, 3);
  assert.equal(res.fetched, 3);
  assert.equal(res.unresolved, 1);
  assert.deepEqual(res.rows, [{ sleeperId: "id-a", source: "cbs", season: 2026, week: 3, points: 10.46 }]);
});
