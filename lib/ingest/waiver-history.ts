// Pull a league's waiver claims (won + failed, with FAAB bids) from Sleeper so
// FAAB suggestions can be priced off what the league actually pays
// (lib/features/faab.ts). Covers the current season plus every past FAAB
// season reachable through Sleeper's previous_league_id chain. Each claim is
// stamped with the player's Sleeper PPR projection for that week and the mean
// for the two weeks after (catches pickups made for a new role).
//
// Past seasons are immutable, so they're fetched once; only the current season
// is re-pulled when stale.

import { prisma } from "@/lib/db";
import { getTransactions, getProjections, getNflState, getLeague } from "@/lib/sleeper";

const STALE_MS = 12 * 60 * 60 * 1000;
const FAAB_WAIVER_TYPE = 2;
const REGULAR_SEASON_WEEKS = 18;

// Projections per (season, week) are shared across leagues within one refresh.
const projCache = new Map<string, Promise<Map<string, number>>>();
function projectionsFor(season: number, week: number, ppr: number): Promise<Map<string, number>> {
  const key = `${season}|${week}|${ppr}`;
  if (!projCache.has(key)) {
    projCache.set(
      key,
      getProjections(season, week, ppr)
        .then((rows) => new Map(rows.map((r) => [r.sleeperId, r.points])))
        .catch(() => new Map()),
    );
  }
  return projCache.get(key)!;
}

// Claims for one Sleeper league-season, ready to insert.
async function seasonClaims(
  leagueId: string,
  sleeperLeagueId: string,
  season: number,
  budget: number,
  lastWeek: number,
  ppr: number,
) {
  const claims = [];
  for (let week = 1; week <= lastWeek; week++) {
    const txs = (await getTransactions(sleeperLeagueId, week)).filter((t) => t.type === "waiver" && t.adds);
    if (txs.length === 0) continue;
    const [now, next1, next2] = await Promise.all([
      projectionsFor(season, week, ppr),
      projectionsFor(season, week + 1, ppr),
      projectionsFor(season, week + 2, ppr),
    ]);
    for (const t of txs) {
      const sleeperId = Object.keys(t.adds!)[0];
      if (!sleeperId) continue;
      const ahead = [next1.get(sleeperId), next2.get(sleeperId)].filter((x): x is number => x != null);
      claims.push({
        leagueId,
        transactionId: t.transaction_id,
        season,
        week,
        budget,
        sleeperId,
        bid: t.settings?.waiver_bid ?? 0,
        won: t.status === "complete",
        projAtClaim: now.get(sleeperId) ?? null,
        projAhead: ahead.length ? ahead.reduce((a, b) => a + b, 0) / ahead.length : null,
      });
    }
  }
  return claims;
}

async function withPositions<T extends { sleeperId: string }>(claims: T[]) {
  const positions = new Map(
    (
      await prisma.player.findMany({
        where: { sleeperId: { in: [...new Set(claims.map((c) => c.sleeperId))] } },
        select: { sleeperId: true, position: true },
      })
    ).map((p) => [p.sleeperId, p.position]),
  );
  return claims.map((c) => ({ ...c, position: positions.get(c.sleeperId) ?? "?" }));
}

// Re-pull the current season's claims (always) and any past FAAB season not
// yet stored. Returns the number of claims written.
export async function refreshWaiverHistory(leagueId: string): Promise<number> {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  if (league.platform !== "sleeper") return 0;
  const state = await getNflState();
  const lastWeek = Number(state.season) === league.season ? Math.max(1, state.week) : REGULAR_SEASON_WEEKS;

  let written = 0;
  if (league.faabBudget) {
    const current = await withPositions(
      await seasonClaims(leagueId, league.externalId, league.season, league.faabBudget, lastWeek, league.ppr),
    );
    await prisma.$transaction([
      prisma.waiverClaim.deleteMany({ where: { leagueId, season: league.season } }),
      prisma.waiverClaim.createMany({ data: current }),
    ]);
    written += current.length;
  }

  // Walk back through previous seasons of this league.
  const stored = new Set(
    (await prisma.waiverClaim.findMany({ where: { leagueId }, select: { season: true }, distinct: ["season"] })).map(
      (r) => r.season,
    ),
  );
  let prevId = (await getLeague(league.externalId)).previous_league_id;
  while (prevId && prevId !== "0") {
    const prev = await getLeague(prevId);
    const season = Number(prev.season);
    const budget = prev.settings?.waiver_budget;
    // Skip seasons already stored and non-FAAB seasons (rolling waivers bid $0).
    if (!stored.has(season) && prev.settings?.waiver_type === FAAB_WAIVER_TYPE && budget) {
      const past = await withPositions(
        await seasonClaims(leagueId, prevId, season, budget, REGULAR_SEASON_WEEKS, league.ppr),
      );
      if (past.length) await prisma.waiverClaim.createMany({ data: past });
      written += past.length;
    }
    prevId = prev.previous_league_id;
  }
  return written;
}

// Refresh any of these leagues whose current-season history is missing or
// older than STALE_MS.
export async function ensureWaiverHistoryFresh(leagueIds: string[]): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  await Promise.all(
    leagueIds.map(async (id) => {
      const latest = await prisma.waiverClaim.findFirst({ where: { leagueId: id }, orderBy: { updatedAt: "desc" } });
      if (!latest || latest.updatedAt < cutoff) await refreshWaiverHistory(id);
    }),
  );
}
