// FFToday weekly projections (public HTML, no login), in FFToday's full-PPR
// preset scoring (LeagueID=107644):
//
//   https://www.fftoday.com/rankings/playerwkproj.php?Season=&GameWeek=&PosID=&LeagueID=107644&cur_page=
//
// Pages hold 50 rows; we walk cur_page until one comes back empty. Row layout:
// blank cell, player link, team, opponent, position-specific stats, FPts (last).
// No DEF page, so FFToday only contributes QB/RB/WR/TE/K. An unknown PosID
// silently serves the QB page, so the ids below were each checked by hand.
// QB lines are rescored to 4-pt passing TDs (pass TD is the 8th cell).

import { getText } from "@/lib/http";
import { cellText, normTeam, toFourPointPassTd, toRows, type ScrapedProjection, type ScrapedResolver, type ScrapedResult } from "@/lib/projections/scraped";

const PPR_LEAGUE_ID = 107644;
const MAX_PAGES = 4;
const QB_PASS_TD_CELL = 7;
const POSITIONS: { posId: number; position: string }[] = [
  { posId: 10, position: "QB" },
  { posId: 20, position: "RB" },
  { posId: 30, position: "WR" },
  { posId: 40, position: "TE" },
  { posId: 80, position: "K" },
];

// Pure parser for one page — split out for unit testing.
export function parseFftodayPage(html: string, position: string): ScrapedProjection[] {
  const out: ScrapedProjection[] = [];
  for (const m of html.matchAll(/<TR>([\s\S]*?)<\/TR>/gi)) {
    const row = m[1];
    const name = row.match(/HREF="\/stats\/players\/\d+\/[^"]*">([^<]+)<\/A>/i)?.[1];
    if (!name) continue;
    const cells = [...row.matchAll(/<TD[^>]*>([\s\S]*?)<\/TD>/gi)].map((c) => cellText(c[1]));
    if (cells.length < 5) continue;
    let points = Number(cells[cells.length - 1]);
    if (!Number.isFinite(points)) continue;
    if (position === "QB") {
      const passTd = Number(cells[QB_PASS_TD_CELL]);
      if (Number.isFinite(passTd)) points = toFourPointPassTd(points, passTd);
    }
    out.push({ name: cellText(name), position, team: normTeam(cells[2]), points });
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// FFToday 403s bursts of requests, so pages are fetched one at a time with a
// short gap, and a failed page is retried with growing waits (back-to-back
// weekly pulls can trip it for several seconds). ~9 pages per week.
const PAGE_GAP_MS = 600;
const RETRY_WAITS_MS = [4_000, 10_000];

async function fetchPage(url: string): Promise<string> {
  for (const wait of RETRY_WAITS_MS) {
    try {
      return await getText(url);
    } catch {
      await sleep(wait);
    }
  }
  return getText(url);
}

export async function getFftodayProjections(
  season: number,
  week: number,
  resolve: ScrapedResolver,
): Promise<ScrapedResult> {
  const all: ScrapedProjection[] = [];
  for (const { posId, position } of POSITIONS) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url =
        `https://www.fftoday.com/rankings/playerwkproj.php?Season=${season}&GameWeek=${week}` +
        `&PosID=${posId}&LeagueID=${PPR_LEAGUE_ID}&cur_page=${page}`;
      const rows = parseFftodayPage(await fetchPage(url), position);
      await sleep(PAGE_GAP_MS);
      if (rows.length === 0) break;
      all.push(...rows);
    }
  }
  return toRows(all, resolve, "fftoday", season, week);
}
