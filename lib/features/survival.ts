// Guillotine survival view. In a Guillotine league there's no head-to-head —
// everyone plays the field and the single lowest scorer each week is eliminated.
// The matchup banner (which needs a paired opponent) correctly hides there, so
// this fills the gap: where you rank on projected points, the elimination line
// you have to stay above, and your probability of surviving the week.
//
// Sleeper-only (uses the matchups endpoint, unpaired = play-the-field).

import { prisma } from "@/lib/db";
import { getMatchups, getNflState } from "@/lib/sleeper";
import { blendProjections } from "@/lib/projections/consensus";
import type { ProjectionRow } from "@/lib/types";

export interface SurvivalTeam {
  teamName: string;
  isMine: boolean;
  projected: number;
  actual: number;
}

export interface SurvivalResult {
  week: number;
  numActive: number; // teams still alive this week (have set starters)
  myProjected: number;
  myActual: number;
  myRank: number; // 1 = highest projected (safest), numActive = on the block
  eliminationLine: number; // lowest projected total among active teams (the block)
  cushion: number; // points above safety: >0 if you're clear, <0 if you're the one on the block
  onTheBlock: string; // team currently projected last
  survivalProb: number | null; // P(I'm not the week's low score), 0..1
  standings: SurvivalTeam[]; // sorted safest (highest proj) -> most at risk
}

// Standard normal CDF (Abramowitz & Stegun 7.1.26), matching lib/features/matchup.
function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function normPdf(z: number): number {
  return 0.3989423 * Math.exp((-z * z) / 2);
}

// Per-team weekly fantasy-score std dev. Matchup uses ~38 for the *combined*
// spread of two teams (√2·27); a single team's is ~27.
export const TEAM_STDEV = 27;

// P(I post the strict low score) = ∫ f_me(x) · ∏_j P(X_j > x) dx, integrated
// numerically over my score's plausible range. Survival = 1 − that.
export function survivalProbability(
  myProj: number,
  otherProjs: number[],
  sigma = TEAM_STDEV,
): number {
  if (otherProjs.length === 0) return 1; // last team standing — nobody below you
  const lo = myProj - 4 * sigma;
  const hi = myProj + 4 * sigma;
  const steps = 240;
  const dx = (hi - lo) / steps;
  let pLowest = 0;
  for (let i = 0; i <= steps; i++) {
    const x = lo + i * dx;
    const fMe = normPdf((x - myProj) / sigma) / sigma;
    let prodAbove = 1;
    for (const mu of otherProjs) prodAbove *= 1 - normCdf((x - mu) / sigma);
    const weight = i === 0 || i === steps ? 0.5 : 1; // trapezoidal
    pLowest += weight * fMe * prodAbove * dx;
  }
  return Math.min(1, Math.max(0, 1 - pLowest));
}

// Pure core: rank teams, find the elimination line, compute survival odds.
// `teams` must already carry each side's projected/actual totals.
export function computeSurvival(
  week: number,
  teams: SurvivalTeam[],
): SurvivalResult | null {
  const active = teams.filter((t) => t.projected > 0);
  const me = active.find((t) => t.isMine);
  if (!me || active.length === 0) return null;

  const standings = [...active].sort((a, b) => b.projected - a.projected);
  const myRank = standings.findIndex((t) => t.isMine) + 1;
  const last = standings[standings.length - 1];
  const eliminationLine = last.projected;
  const others = active.filter((t) => !t.isMine).map((t) => t.projected);

  // Cushion = points above the safety threshold. If you're clear, that's your
  // margin over the lowest projected team (the block). If you're the one on the
  // block, it's the (negative) deficit up to the team just above you — how much
  // you need to climb to hand elimination to someone else.
  const iAmLast = last.isMine;
  const secondLowest = standings.length >= 2 ? standings[standings.length - 2].projected : me.projected;
  const cushion = iAmLast ? me.projected - secondLowest : me.projected - eliminationLine;

  return {
    week,
    numActive: active.length,
    myProjected: me.projected,
    myActual: me.actual,
    myRank,
    eliminationLine,
    cushion: Math.round(cushion * 100) / 100,
    onTheBlock: iAmLast ? me.teamName : last.teamName,
    survivalProb: Math.round(survivalProbability(me.projected, others) * 1000) / 1000,
    standings,
  };
}

// DB wrapper. Returns null when the league isn't a play-the-field (Guillotine)
// format — i.e. any two rosters share a matchup_id (head-to-head) — or when
// there's no matchup data yet.
export async function getSurvival(teamId: string, week?: number): Promise<SurvivalResult | null> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { league: { include: { teams: true } } },
  });
  if (team.league.platform !== "sleeper") return null;

  const state = await getNflState();
  const w = week ?? (state.week > 0 ? state.week : 1);
  const season = team.league.season;

  const rows = await getMatchups(team.league.externalId, w);
  if (rows.length === 0) return null;

  // Head-to-head detection: if any matchup_id pairs two rosters, this is a
  // normal H2H league and the survival view doesn't apply.
  const byMatchupId = new Map<number, number>();
  for (const r of rows) {
    if (r.matchup_id != null) byMatchupId.set(r.matchup_id, (byMatchupId.get(r.matchup_id) ?? 0) + 1);
  }
  const isHeadToHead = [...byMatchupId.values()].some((n) => n >= 2);
  if (isHeadToHead) return null;

  const nameByRosterId = new Map(team.league.teams.map((t) => [t.externalId, t.name]));

  // One consensus projection lookup for every set starter across the field.
  const allStarterIds = rows.flatMap((r) => (r.starters ?? []).filter((id) => id && id !== "0"));
  const projRows = await prisma.projection.findMany({
    where: { sleeperId: { in: allStarterIds }, season, week: w },
  });
  const consensus = blendProjections(projRows as unknown as ProjectionRow[]);
  const sumProj = (starters: string[] | null | undefined) =>
    Math.round(
      (starters ?? [])
        .filter((id) => id && id !== "0")
        .reduce((s, id) => s + (consensus.get(id)?.points ?? 0), 0) * 100,
    ) / 100;

  const teams: SurvivalTeam[] = rows.map((r) => ({
    teamName: nameByRosterId.get(String(r.roster_id)) ?? `Roster ${r.roster_id}`,
    isMine: String(r.roster_id) === team.externalId,
    projected: sumProj(r.starters),
    actual: r.points ?? 0,
  }));

  return computeSurvival(w, teams);
}
