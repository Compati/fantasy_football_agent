// Waiver / free-agent engine. Ranks available players by consensus projection
// and market value, and gives a FAAB bid range priced off what this league
// actually pays (lib/features/faab.ts).

import { prisma } from "@/lib/db";
import { getNflState } from "@/lib/sleeper";
import { blendProjections } from "@/lib/projections/consensus";
import { injuryAdjustedProj } from "@/lib/features/injury";
import type { ProjectionRow } from "@/lib/types";
import { faabTier, faabRange, faabNeed, bidForNeed, type ClaimSample, type FaabRange, type FaabNeed } from "@/lib/features/faab";
import { ensureWaiverHistoryFresh } from "@/lib/ingest/waiver-history";
import { optimizeLineup } from "@/lib/features/startsit";
import { starterSlots } from "@/lib/ingest/sleeper-transform";
import { isEligible } from "@/lib/features/eligibility";

const STARTABLE = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

export interface FaabAdvice extends FaabRange {
  bid: number; // high end if he clearly starts for you, midpoint if marginal, else low
  need: FaabNeed;
}

// Winning claims across all of this user's leagues, tiered, as % of each
// league's starting budget — the calibration set for faabRange.
async function loadClaimSamples(userId: string): Promise<ClaimSample[]> {
  const leagues = await prisma.league.findMany({
    where: { connection: { userId }, faabBudget: { gt: 0 } },
    include: { waiverClaims: { where: { won: true } } },
  });
  const samples: ClaimSample[] = [];
  for (const lg of leagues) {
    const ids = lg.waiverClaims.map((c) => c.sleeperId);
    const values = new Map(
      (
        await prisma.tradeValue.findMany({
          where: { sleeperId: { in: ids }, isDynasty: false, ppr: lg.ppr, numQbs: lg.numQbs, numTeams: lg.numTeams },
          select: { sleeperId: true, value: true },
        })
      ).map((v) => [v.sleeperId, v.value]),
    );
    for (const c of lg.waiverClaims) {
      samples.push({
        leagueId: lg.id,
        tier: faabTier(c.position, c.projAtClaim ?? 0, values.get(c.sleeperId) ?? 0, lg.numQbs),
        pct: (100 * c.bid) / lg.faabBudget!,
      });
    }
  }
  return samples;
}

export interface WaiverTarget {
  sleeperId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  proj: number; // injury-adjusted: 0 if the player is ruled out this week
  sources: number;
  value: number; // trade value (0 if unknown)
  valueEstimated: boolean; // true = projection-derived estimate, not live market
  trend30: number;
  injuryStatus: string | null;
  faab: FaabAdvice | null; // null = league has no FAAB
}

export async function waiverTargets(
  teamId: string,
  opts: { week?: number; position?: string; limit?: number } = {},
): Promise<{ week: number; remainingBudget: number | null; targets: WaiverTarget[] }> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { roster: true, league: { include: { teams: { include: { roster: true } }, connection: true } } },
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

  // FAAB calibration: this league's (and the user's other leagues') claim history.
  const budget = league.faabBudget ?? 0;
  let samples: ClaimSample[] = [];
  if (budget > 0) {
    const userLeagues = await prisma.league.findMany({
      where: { connection: { userId: league.connection.userId }, platform: "sleeper" },
      select: { id: true },
    });
    await ensureWaiverHistoryFresh(userLeagues.map((l) => l.id)).catch(() => {});
    samples = await loadClaimSamples(league.connection.userId);
  }

  // Your optimal lineup this week, to tell "would start" pickups from depth.
  const myPlayers = await prisma.player.findMany({
    where: { sleeperId: { in: team.roster.map((r) => r.sleeperId).filter((x): x is string => !!x) } },
  });
  const myLineup = optimizeLineup(
    myPlayers.map((p) => ({
      sleeperId: p.sleeperId,
      name: p.name,
      position: p.position,
      proj: injuryAdjustedProj(consensus.get(p.sleeperId)?.points ?? 0, p.injuryStatus),
      sources: consensus.get(p.sleeperId)?.n ?? 0,
    })),
    starterSlots((league.rosterPositions as string[]) ?? []),
  ).lineup;
  // Weakest starter this player could replace (an empty eligible slot = 0).
  const weakestStarterFor = (position: string): number | null => {
    const eligible = myLineup.filter((a) => isEligible(a.slot, position));
    if (eligible.length === 0) return null;
    return Math.min(...eligible.map((a) => a.player?.proj ?? 0));
  };

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

  const faabAdvice = (position: string, proj: number, value: number): FaabAdvice | null => {
    if (budget <= 0) return null;
    const range = faabRange(faabTier(position, proj, value, league.numQbs), league.id, samples, budget, remainingBudget);
    const need = faabNeed(proj, weakestStarterFor(position));
    return { ...range, need, bid: bidForNeed(range, need) };
  };

  const targets: WaiverTarget[] = players
    .filter((p) => STARTABLE.has(p.position))
    .filter((p) => !opts.position || p.position === opts.position)
    .map((p) => {
      const c = consensus.get(p.sleeperId)!;
      const v = valueById.get(p.sleeperId);
      const trend30 = v?.trend30 ?? 0;
      // A ruled-out player can't help this week, so gate their projection to 0
      // (matches start/sit) — they sink out of the ranked targets.
      const proj = injuryAdjustedProj(c.points, p.injuryStatus);
      return {
        sleeperId: p.sleeperId,
        name: p.name,
        position: p.position,
        nflTeam: p.nflTeam,
        proj,
        sources: c.n,
        value: v?.value ?? 0,
        valueEstimated: v?.source === "derived",
        trend30,
        injuryStatus: p.injuryStatus,
        faab: faabAdvice(p.position, proj, v?.value ?? 0),
      };
    })
    .sort((a, b) => b.proj - a.proj || b.value - a.value)
    .slice(0, opts.limit ?? 30);

  return { week, remainingBudget, targets };
}
