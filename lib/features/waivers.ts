// Waiver / free-agent engine. Ranks available players by consensus projection
// and market value, and sizes a FAAB bid as a % of remaining budget.

import { prisma } from "@/lib/db";
import { getNflState } from "@/lib/sleeper";
import { blendProjections } from "@/lib/projections/consensus";
import type { ProjectionRow } from "@/lib/types";

const STARTABLE = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

export interface FaabSuggestion {
  pct: number; // suggested % of remaining budget
  dollars: number | null; // resolved amount if a budget is known
  rationale: string;
}

// Transparent, tier-based bid sizing off this week's projection, nudged by the
// 30-day market trend. Pure + unit-tested.
export function faabSuggestion(
  proj: number,
  trend30: number,
  remainingBudget: number | null,
): FaabSuggestion {
  let pct: number;
  let tier: string;
  if (proj >= 15) {
    pct = 45;
    tier = "immediate every-week starter";
  } else if (proj >= 12) {
    pct = 28;
    tier = "flex-worthy starter";
  } else if (proj >= 9) {
    pct = 14;
    tier = "streamer / bye-week fill";
  } else if (proj >= 6) {
    pct = 6;
    tier = "depth / upside stash";
  } else {
    pct = 2;
    tier = "speculative add";
  }
  // Nudge for market momentum: hot risers cost a bit more, faders a bit less.
  if (trend30 > 0) pct = Math.min(60, Math.round(pct * 1.15));
  else if (trend30 < 0) pct = Math.max(1, Math.round(pct * 0.9));

  const dollars = remainingBudget != null ? Math.max(1, Math.round((remainingBudget * pct) / 100)) : null;
  return { pct, dollars, rationale: tier };
}

export interface WaiverTarget {
  sleeperId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  proj: number;
  sources: number;
  value: number; // trade value (0 if unknown)
  valueEstimated: boolean; // true = projection-derived estimate, not live market
  trend30: number;
  faab: FaabSuggestion;
}

export async function waiverTargets(
  teamId: string,
  opts: { week?: number; position?: string; limit?: number } = {},
): Promise<{ week: number; remainingBudget: number | null; targets: WaiverTarget[] }> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { league: { include: { teams: { include: { roster: true } } } } },
  });
  const league = team.league;
  const state = await getNflState();
  const week = opts.week ?? (state.week > 0 ? state.week : 1);
  const season = league.season;

  // Everyone rostered anywhere in the league is unavailable.
  const rostered = new Set<string>();
  for (const t of league.teams) for (const r of t.roster) if (r.sleeperId) rostered.add(r.sleeperId);

  const remainingBudget =
    league.faabBudget != null ? league.faabBudget - (team.faabBudgetUsed ?? 0) : null;

  // Candidate pool: players with a projection this week who aren't rostered.
  const projRows = await prisma.projection.findMany({ where: { season, week } });
  const consensus = blendProjections(projRows as unknown as ProjectionRow[]);

  const candidateIds = [...consensus.keys()].filter((id) => !rostered.has(id));
  const [players, values] = await Promise.all([
    prisma.player.findMany({ where: { sleeperId: { in: candidateIds } } }),
    prisma.tradeValue.findMany({
      where: {
        sleeperId: { in: candidateIds },
        isDynasty: false,
        ppr: league.ppr,
        numQbs: league.numQbs,
        numTeams: league.numTeams,
      },
    }),
  ]);
  const valueById = new Map(values.map((v) => [v.sleeperId, v]));

  const targets: WaiverTarget[] = players
    .filter((p) => STARTABLE.has(p.position))
    .filter((p) => !opts.position || p.position === opts.position)
    .map((p) => {
      const c = consensus.get(p.sleeperId)!;
      const v = valueById.get(p.sleeperId);
      const trend30 = v?.trend30 ?? 0;
      return {
        sleeperId: p.sleeperId,
        name: p.name,
        position: p.position,
        nflTeam: p.nflTeam,
        proj: c.points,
        sources: c.n,
        value: v?.value ?? 0,
        valueEstimated: v?.source === "derived",
        trend30,
        faab: faabSuggestion(c.points, trend30, remainingBudget),
      };
    })
    .sort((a, b) => b.proj - a.proj || b.value - a.value)
    .slice(0, opts.limit ?? 30);

  return { week, remainingBudget, targets };
}
