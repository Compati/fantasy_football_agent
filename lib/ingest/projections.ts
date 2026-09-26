// Ingest weekly projections from every source into the Projection table. The
// consensus blend happens at read time (lib/projections/consensus.ts).
//
// All of Alex's leagues are full-PPR, so we ingest PPR points. A half/std league
// would want its own scoring dimension — noted for later.

import { prisma } from "@/lib/db";
import { getProjections, getNflState } from "@/lib/sleeper";
import { getEspnProjections } from "@/lib/projections/espn";
import { getCbsProjections } from "@/lib/projections/cbs";
import { getFftodayProjections } from "@/lib/projections/fftoday";
import type { ScrapedProjection, ScrapedResult } from "@/lib/projections/scraped";
import { scaleToReference } from "@/lib/projections/consensus";
import { ensureCatalogFresh, normalizeName } from "@/lib/players";
import type { ProjectionRow } from "@/lib/types";

export interface ProjectionsIngestSummary {
  season: number;
  week: number;
  sleeper: number;
  espn: number;
  espnUnresolved: number;
  cbs: number;
  cbsUnresolved: number;
  fftoday: number;
  fftodayUnresolved: number;
}

async function replaceSource(
  source: string,
  season: number,
  week: number,
  rows: ProjectionRow[],
  validIds: Set<string>,
) {
  const clean = rows.filter((r) => validIds.has(r.sleeperId));
  await prisma.projection.deleteMany({ where: { source, season, week } });
  if (clean.length > 0) {
    await prisma.projection.createMany({
      data: clean.map((r) => ({
        sleeperId: r.sleeperId,
        source,
        season,
        week,
        points: r.points,
      })),
    });
  }
  return clean.length;
}

export async function refreshProjections(
  season?: number,
  week?: number,
  ppr = 1,
): Promise<ProjectionsIngestSummary> {
  await ensureCatalogFresh();
  const state = season && week ? null : await getNflState();
  const s = season ?? Number(state!.season);
  const w = week ?? (state!.week > 0 ? state!.week : 1);

  // Only keep projections for players we actually have (FK safety).
  const players = await prisma.player.findMany({
    select: { sleeperId: true, espnId: true, name: true, position: true, nflTeam: true },
  });
  const validIds = new Set(players.map((p) => p.sleeperId));
  const espnToSleeper = new Map<string, string>();
  const namePos = new Map<string, string>();
  const namePosTeam = new Map<string, string>();
  for (const p of players) {
    if (p.espnId) espnToSleeper.set(p.espnId, p.sleeperId);
    namePos.set(`${normalizeName(p.name)}|${p.position}`, p.sleeperId);
    if (p.nflTeam) namePosTeam.set(`${normalizeName(p.name)}|${p.position}|${p.nflTeam}`, p.sleeperId);
  }
  const namePosResolver = (name: string, position: string) =>
    namePos.get(`${normalizeName(name)}|${position}`) ?? null;
  // Scraped sources (no ids): team disambiguates duplicate names; fall back to
  // name+pos for players whose catalog team is stale. DEF ids are team abbrevs.
  const scrapedResolver = (p: ScrapedProjection) => {
    if (p.position === "DEF") return p.team && validIds.has(p.team) ? p.team : null;
    const key = `${normalizeName(p.name)}|${p.position}`;
    return (p.team && namePosTeam.get(`${key}|${p.team}`)) || namePos.get(key) || null;
  };
  const emptyScraped: ScrapedResult = { rows: [], fetched: 0, unresolved: 0 };

  const [sleeperRows, espnRes, cbsRes, fftRes] = await Promise.all([
    getProjections(s, w, ppr).catch(() => [] as ProjectionRow[]),
    getEspnProjections(s, w, ppr, espnToSleeper, 600, namePosResolver).catch(() => ({
      rows: [] as ProjectionRow[],
      unresolvedEspnIds: 0,
      fetched: 0,
      matchedProjection: 0,
    })),
    getCbsProjections(s, w, scrapedResolver).catch(() => emptyScraped),
    getFftodayProjections(s, w, scrapedResolver).catch(() => emptyScraped),
  ]);

  const sleeperN = await replaceSource("sleeper", s, w, sleeperRows, validIds);
  // ESPN's D/ST scoring runs well below Sleeper's; keep its ranking, use Sleeper's scale.
  const defIds = new Set(players.filter((p) => p.position === "DEF").map((p) => p.sleeperId));
  const espnRows = scaleToReference(espnRes.rows, sleeperRows, defIds);
  const espnN = await replaceSource("espn", s, w, espnRows, validIds);
  // A scrape that failed or came back empty (site down, markup changed, week not
  // published yet) keeps the previous rows rather than wiping that source.
  const cbsN = cbsRes.rows.length ? await replaceSource("cbs", s, w, cbsRes.rows, validIds) : 0;
  const fftN = fftRes.rows.length ? await replaceSource("fftoday", s, w, fftRes.rows, validIds) : 0;

  return {
    season: s,
    week: w,
    sleeper: sleeperN,
    espn: espnN,
    espnUnresolved: espnRes.unresolvedEspnIds,
    cbs: cbsN,
    cbsUnresolved: cbsRes.unresolved,
    fftoday: fftN,
    fftodayUnresolved: fftRes.unresolved,
  };
}
