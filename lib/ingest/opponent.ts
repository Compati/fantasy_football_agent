// Ingest the opponent-context tables used by start/sit (lib/features/opponent.ts):
//   - GameLine: this week's opponents from Sleeper's schedule (free), plus
//     spread/total/implied team total from The Odds API when a key is set
//     (one call for the whole slate, 2 credits: spreads + totals).
//   - DefenseVsPosition: PPR points allowed per game by position, season to
//     date, from Sleeper's weekly stats (free).

import { prisma } from "@/lib/db";
import { getSchedule, getWeeklyStats } from "@/lib/sleeper";
import { oddsApiConfigured, fetchGameLines } from "@/lib/odds";
import { teamAbbr } from "@/lib/teams";
import { computeDefenseVsPosition, impliedTotals, DVP_POSITIONS, type WeeklyPoints } from "@/lib/features/opponent";

// Re-pull when older than this (the league page calls ensureOpponentDataFresh).
const STALE_MS = 12 * 60 * 60 * 1000;

export async function refreshDefenseVsPosition(season: number, week: number): Promise<number> {
  const throughWeek = week - 1;
  if (throughWeek < 1) return 0;
  const rows: WeeklyPoints[] = [];
  for (let w = 1; w <= throughWeek; w++) {
    for (const position of DVP_POSITIONS) {
      const data = await getWeeklyStats(season, w, position);
      for (const r of data) {
        const pts = r.stats?.pts_ppr;
        if (r.opponent && pts != null) rows.push({ week: w, opponent: r.opponent, position, points: pts });
      }
    }
  }
  const dvp = computeDefenseVsPosition(rows);
  await prisma.$transaction([
    prisma.defenseVsPosition.deleteMany({ where: { season } }),
    prisma.defenseVsPosition.createMany({ data: dvp.map((d) => ({ ...d, season, throughWeek })) }),
  ]);
  return dvp.length;
}

export async function refreshGameLines(season: number, week: number): Promise<{ games: number; withLines: number }> {
  // Sleeper keeps cancelled/rescheduled games in the schedule, so a team can appear twice in a week.
  const games = (await getSchedule(season)).filter((g) => g.week === week && g.status !== "canceled");
  const lines = oddsApiConfigured() ? await fetchGameLines().catch(() => []) : [];
  const lineByPair = new Map(
    lines.map((l) => [`${teamAbbr(l.homeTeam)}|${teamAbbr(l.awayTeam)}`, l]),
  );

  const data = [];
  let withLines = 0;
  for (const g of games) {
    const line = lineByPair.get(`${g.home}|${g.away}`);
    const implied = line?.total != null && line.homeSpread != null ? impliedTotals(line.total, line.homeSpread) : null;
    if (implied) withLines++;
    const commenceTime = line?.commenceTime ?? new Date(`${g.date}T17:00:00Z`);
    data.push(
      { season, week, team: g.home, opponent: g.away, isHome: true, spread: line?.homeSpread ?? null, total: line?.total ?? null, impliedTotal: implied?.home ?? null, commenceTime },
      { season, week, team: g.away, opponent: g.home, isHome: false, spread: line?.homeSpread != null ? -line.homeSpread : null, total: line?.total ?? null, impliedTotal: implied?.away ?? null, commenceTime },
    );
  }
  await prisma.$transaction([
    prisma.gameLine.deleteMany({ where: { season, week } }),
    prisma.gameLine.createMany({ data }),
  ]);
  return { games: games.length, withLines };
}

// Refresh whichever table is missing or older than STALE_MS for this week.
export async function ensureOpponentDataFresh(season: number, week: number): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const [line, dvp] = await Promise.all([
    prisma.gameLine.findFirst({ where: { season, week }, orderBy: { updatedAt: "desc" } }),
    prisma.defenseVsPosition.findFirst({ where: { season }, orderBy: { updatedAt: "desc" } }),
  ]);
  const jobs: Promise<unknown>[] = [];
  if (!line || line.updatedAt < cutoff) jobs.push(refreshGameLines(season, week));
  if (week > 1 && (!dvp || dvp.throughWeek < week - 1 || dvp.updatedAt < cutoff)) {
    jobs.push(refreshDefenseVsPosition(season, week));
  }
  await Promise.all(jobs);
}
