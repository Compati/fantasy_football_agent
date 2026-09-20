// Weekly head-to-head: who you're playing, projected scores (consensus of each
// team's set starters), live actual points, and a rough win probability.
// Sleeper-only (uses matchup_id grouping); all of Alex's leagues are Sleeper.

import { prisma } from "@/lib/db";
import { getMatchups, getNflState } from "@/lib/sleeper";
import { blendProjections } from "@/lib/projections/consensus";
import type { ProjectionRow } from "@/lib/types";

export interface MatchupSide {
  teamName: string;
  projected: number;
  actual: number;
}

export interface MatchupResult {
  week: number;
  me: MatchupSide;
  opponent: MatchupSide | null; // null = bye week or no matchup data
  winProb: number | null; // probability I win (0-1), null if no projections
}

// Standard normal CDF (Abramowitz & Stegun 7.1.26).
function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// Combined std dev of the two teams' weekly fantasy scores (~27 each).
const MATCHUP_STDEV = 38;

export async function getMatchup(teamId: string, week?: number): Promise<MatchupResult> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { league: { include: { teams: true } } },
  });
  if (team.league.platform !== "sleeper") {
    throw new Error("Matchups are only supported for Sleeper leagues.");
  }
  const state = await getNflState();
  const w = week ?? (state.week > 0 ? state.week : 1);
  const season = team.league.season;

  const nameByRosterId = new Map(team.league.teams.map((t) => [t.externalId, t.name]));
  const rows = await getMatchups(team.league.externalId, w);
  const mine = rows.find((r) => String(r.roster_id) === team.externalId);

  if (!mine) {
    return {
      week: w,
      me: { teamName: team.name, projected: 0, actual: 0 },
      opponent: null,
      winProb: null,
    };
  }
  const opp =
    mine.matchup_id != null
      ? rows.find((r) => r.matchup_id === mine.matchup_id && r.roster_id !== mine.roster_id)
      : undefined;

  // Projected scores from each team's set starters.
  const starterIds = [
    ...(mine.starters ?? []),
    ...(opp?.starters ?? []),
  ].filter((id) => id && id !== "0");
  const projRows = await prisma.projection.findMany({
    where: { sleeperId: { in: starterIds }, season, week: w },
  });
  const consensus = blendProjections(projRows as unknown as ProjectionRow[]);
  const sumProj = (starters: string[] | null | undefined) =>
    Math.round(
      (starters ?? [])
        .filter((id) => id && id !== "0")
        .reduce((s, id) => s + (consensus.get(id)?.points ?? 0), 0) * 100,
    ) / 100;

  const meProjected = sumProj(mine.starters);
  const me: MatchupSide = { teamName: team.name, projected: meProjected, actual: mine.points ?? 0 };

  if (!opp) return { week: w, me, opponent: null, winProb: null };

  const oppProjected = sumProj(opp.starters);
  const opponent: MatchupSide = {
    teamName: nameByRosterId.get(String(opp.roster_id)) ?? `Roster ${opp.roster_id}`,
    projected: oppProjected,
    actual: opp.points ?? 0,
  };

  const winProb =
    meProjected > 0 && oppProjected > 0
      ? Math.round(normCdf((meProjected - oppProjected) / MATCHUP_STDEV) * 100) / 100
      : null;

  return { week: w, me, opponent, winProb };
}
