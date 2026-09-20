// Ingest weekly projections from every source into the Projection table. The
// consensus blend happens at read time (lib/projections/consensus.ts).
//
// All of Alex's leagues are full-PPR, so we ingest PPR points. A half/std league
// would want its own scoring dimension — noted for later.

import { prisma } from "@/lib/db";
import { getProjections, getNflState } from "@/lib/sleeper";
import { getEspnProjections } from "@/lib/projections/espn";
import { ensureCatalogFresh, normalizeName } from "@/lib/players";
import type { ProjectionRow } from "@/lib/types";

export interface ProjectionsIngestSummary {
  season: number;
  week: number;
  sleeper: number;
  espn: number;
  espnUnresolved: number;
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
    select: { sleeperId: true, espnId: true, name: true, position: true },
  });
  const validIds = new Set(players.map((p) => p.sleeperId));
  const espnToSleeper = new Map<string, string>();
  const namePos = new Map<string, string>();
  for (const p of players) {
    if (p.espnId) espnToSleeper.set(p.espnId, p.sleeperId);
    namePos.set(`${normalizeName(p.name)}|${p.position}`, p.sleeperId);
  }
  const namePosResolver = (name: string, position: string) =>
    namePos.get(`${normalizeName(name)}|${position}`) ?? null;

  const [sleeperRows, espnRes] = await Promise.all([
    getProjections(s, w, ppr).catch(() => [] as ProjectionRow[]),
    getEspnProjections(s, w, ppr, espnToSleeper, 600, namePosResolver).catch(() => ({
      rows: [] as ProjectionRow[],
      unresolvedEspnIds: 0,
      fetched: 0,
      matchedProjection: 0,
    })),
  ]);

  const sleeperN = await replaceSource("sleeper", s, w, sleeperRows, validIds);
  const espnN = await replaceSource("espn", s, w, espnRes.rows, validIds);

  return {
    season: s,
    week: w,
    sleeper: sleeperN,
    espn: espnN,
    espnUnresolved: espnRes.unresolvedEspnIds,
  };
}
