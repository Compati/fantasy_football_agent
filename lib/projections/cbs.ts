// CBS Sports weekly projections (public HTML, no login). One page per position:
//
//   https://www.cbssports.com/fantasy/football/stats/{POS}/{season}/{week}/projections/ppr/
//
// Each body row renders the player twice (short "J. Allen" + long "Josh Allen"
// spans) followed by stat cells; the last two cells are fpts and fppg (equal
// for a single week). QB lines are rescored to 4-pt passing TDs.
//
// DST is deliberately skipped: CBS's defense scoring runs ~1.5x Sleeper's, which
// would inflate the DEF consensus rather than sharpen it.

import { getText } from "@/lib/http";
import { cellText, normTeam, toFourPointPassTd, toRows, type ScrapedProjection, type ScrapedResolver, type ScrapedResult } from "@/lib/projections/scraped";

const POSITIONS: { page: string; position: string }[] = [
  { page: "QB", position: "QB" },
  { page: "RB", position: "RB" },
  { page: "WR", position: "WR" },
  { page: "TE", position: "TE" },
  { page: "K", position: "K" },
];

// Pure parser for one position page — split out for unit testing.
export function parseCbsPage(html: string, position: string): ScrapedProjection[] {
  const out: ScrapedProjection[] = [];
  // Header sort links list the columns in cell order ("player", "gp", ...).
  const columns = [...html.matchAll(/sortcol=(\w+)/g)].map((m) => m[1]);
  const passTdCol = columns.indexOf("passing_td");
  const chunks = html.split(/<tr class="TableBase-bodyTr[^"]*">/).slice(1);
  for (const chunk of chunks) {
    const row = chunk.split("</tr>")[0];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 3) continue;
    let points = Number(cellText(cells[cells.length - 2]));
    if (!Number.isFinite(points)) continue;
    if (position === "QB" && passTdCol >= 0) {
      const passTd = Number(cellText(cells[passTdCol] ?? ""));
      if (Number.isFinite(passTd)) points = toFourPointPassTd(points, passTd);
    }

    const long = row.match(/CellPlayerName--long">([\s\S]*?)<\/span><\/span><\/span>/)?.[1] ?? row;
    const name = long.match(/<a [^>]*>([^<]+)<\/a>/)?.[1];
    if (!name) continue;
    const team = normTeam(long.match(/CellPlayerName-team">\s*([A-Z]{2,3})/)?.[1]);
    out.push({ name: cellText(name), position, team, points });
  }
  return out;
}

export async function getCbsProjections(
  season: number,
  week: number,
  resolve: ScrapedResolver,
): Promise<ScrapedResult> {
  const pages = await Promise.all(
    POSITIONS.map(async ({ page, position }) => {
      const url = `https://www.cbssports.com/fantasy/football/stats/${page}/${season}/${week}/projections/ppr/`;
      return parseCbsPage(await getText(url), position);
    }),
  );
  return toRows(pages.flat(), resolve, "cbs", season, week);
}
