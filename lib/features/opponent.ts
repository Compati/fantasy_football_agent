// Opponent context for start/sit: how friendly this week's matchup is, from two
// signals the projections don't carry directly —
//   1. Vegas implied team total (the market's expected points for the offense)
//   2. defense-vs-position: PPR points the opponent allows to that position
//
// The projection sources already account for matchups, so this is NOT applied
// to projections (that would double-count). It labels each player's matchup
// and breaks close start/sit calls. Pure functions here; DB wiring below them.

import { prisma } from "@/lib/db";

export const DVP_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

// Shrinkage weight in games: adjusted = (sum + K·avg) / (games + K). With
// 2 games played, the league average still carries half the weight.
const SHRINK_GAMES = 2;

export interface WeeklyPoints {
  week: number;
  opponent: string; // the defense faced
  position: string;
  points: number; // PPR points one player scored
}

export interface DvpRow {
  team: string;
  position: string;
  games: number;
  perGame: number;
  adjusted: number;
  rank: number; // 1 = most points allowed (best matchup)
}

export function computeDefenseVsPosition(rows: WeeklyPoints[]): DvpRow[] {
  // Sum per (defense, position, week) first so "per game" means per game faced.
  const perGameTotals = new Map<string, number>(); // def|pos|week -> points
  for (const r of rows) {
    const key = `${r.opponent}|${r.position}|${r.week}`;
    perGameTotals.set(key, (perGameTotals.get(key) ?? 0) + r.points);
  }
  const agg = new Map<string, { team: string; position: string; sum: number; games: number }>();
  for (const [key, pts] of perGameTotals) {
    const [team, position] = key.split("|");
    const k = `${team}|${position}`;
    const a = agg.get(k) ?? { team, position, sum: 0, games: 0 };
    a.sum += pts;
    a.games += 1;
    agg.set(k, a);
  }

  const out: DvpRow[] = [];
  for (const pos of new Set([...agg.values()].map((a) => a.position))) {
    const group = [...agg.values()].filter((a) => a.position === pos);
    const totalGames = group.reduce((s, a) => s + a.games, 0);
    const leagueAvg = group.reduce((s, a) => s + a.sum, 0) / totalGames;
    const rows = group.map((a) => ({
      team: a.team,
      position: pos,
      games: a.games,
      perGame: round2(a.sum / a.games),
      adjusted: round2((a.sum + SHRINK_GAMES * leagueAvg) / (a.games + SHRINK_GAMES)),
      rank: 0,
    }));
    rows.sort((x, y) => y.adjusted - x.adjusted);
    rows.forEach((r, i) => (r.rank = i + 1));
    out.push(...rows);
  }
  return out;
}

// Spread is quoted for the home team (negative = home favored).
export function impliedTotals(total: number, homeSpread: number): { home: number; away: number } {
  return { home: round2(total / 2 - homeSpread / 2), away: round2(total / 2 + homeSpread / 2) };
}

export type MatchupLabel = "great" | "good" | "neutral" | "hard" | "tough";

export interface PlayerMatchup {
  opponent: string | null; // null = bye / no game found
  isHome: boolean | null;
  impliedTotal: number | null; // the player's team; for DEF, the opponent's
  dvpRank: number | null; // 1..32, 1 = friendliest
  edge: number; // combined relative edge, e.g. +0.08 = ~8% friendlier than average
  label: MatchupLabel;
}

// Blend the two signals into one relative edge. Each is "how far above the
// league-average matchup", as a fraction; missing signals count as neutral.
export function matchupEdge(
  impliedTotal: number | null,
  avgImplied: number | null,
  dvpAdjusted: number | null,
  dvpAvg: number | null,
): number {
  const parts: number[] = [];
  if (impliedTotal != null && avgImplied) parts.push(impliedTotal / avgImplied - 1);
  if (dvpAdjusted != null && dvpAvg) parts.push(dvpAdjusted / dvpAvg - 1);
  if (parts.length === 0) return 0;
  return round2(parts.reduce((a, b) => a + b, 0) / parts.length);
}

export function matchupLabel(edge: number): MatchupLabel {
  if (edge >= 0.08) return "great";
  if (edge >= 0.03) return "good";
  if (edge <= -0.08) return "tough";
  if (edge <= -0.03) return "hard";
  return "neutral";
}

// A close call leans to the alternative only when its matchup is clearly
// better — a few percent of noise shouldn't flip a projection edge.
export const MATCHUP_LEAN_EDGE = 0.06;

export function closeCallLean(starterEdge: number, alternativeEdge: number): "starter" | "alternative" | null {
  const d = alternativeEdge - starterEdge;
  if (d >= MATCHUP_LEAN_EDGE) return "alternative";
  if (d <= -MATCHUP_LEAN_EDGE) return "starter";
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- DB-backed lookup -------------------------------------------------------

// Build a matchup for each (sleeperId, nflTeam, position) from the stored game
// lines + DvP table for one week. Players without a game (bye) get opponent null.
export async function matchupsFor(
  season: number,
  week: number,
  players: { sleeperId: string; nflTeam: string | null; position: string }[],
): Promise<Map<string, PlayerMatchup>> {
  const [lines, dvp] = await Promise.all([
    prisma.gameLine.findMany({ where: { season, week } }),
    prisma.defenseVsPosition.findMany({ where: { season } }),
  ]);
  const lineByTeam = new Map(lines.map((l) => [l.team, l]));
  const implied = lines.map((l) => l.impliedTotal).filter((x): x is number => x != null);
  const avgImplied = implied.length ? implied.reduce((a, b) => a + b, 0) / implied.length : null;
  const dvpByKey = new Map(dvp.map((d) => [`${d.team}|${d.position}`, d]));
  const dvpAvg = new Map<string, number>();
  for (const pos of DVP_POSITIONS) {
    const g = dvp.filter((d) => d.position === pos);
    if (g.length) dvpAvg.set(pos, g.reduce((s, d) => s + d.adjusted, 0) / g.length);
  }

  const out = new Map<string, PlayerMatchup>();
  for (const p of players) {
    const line = p.nflTeam ? lineByTeam.get(p.nflTeam) : undefined;
    if (!line) {
      out.set(p.sleeperId, { opponent: null, isHome: null, impliedTotal: null, dvpRank: null, edge: 0, label: "neutral" });
      continue;
    }
    const d = dvpByKey.get(`${line.opponent}|${p.position}`);
    let edge: number;
    let impliedTotal = line.impliedTotal;
    if (p.position === "DEF") {
      // A defense wants the opposing offense to score little: invert its implied total.
      impliedTotal = lineByTeam.get(line.opponent)?.impliedTotal ?? null;
      edge = -matchupEdge(impliedTotal, avgImplied, null, null);
    } else {
      edge = matchupEdge(line.impliedTotal, avgImplied, d?.adjusted ?? null, dvpAvg.get(p.position) ?? null);
    }
    out.set(p.sleeperId, {
      opponent: line.opponent,
      isHome: line.isHome,
      impliedTotal,
      dvpRank: d?.rank ?? null,
      edge,
      label: matchupLabel(edge),
    });
  }
  return out;
}
