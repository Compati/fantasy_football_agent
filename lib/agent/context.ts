// Assemble everything the advisor needs about one of my teams into a compact,
// structured context object. This is the grounding the LLM reasons over — it
// never sees raw APIs, only these vetted numbers.

import { prisma } from "@/lib/db";
import { startSitForTeam } from "@/lib/features/startsit";
import { waiverTargets } from "@/lib/features/waivers";

export interface LeagueContext {
  league: {
    name: string;
    platform: string;
    week: number;
    format: string; // e.g. "15-team PPR Superflex"
    faabRemaining: number | null;
  };
  team: { name: string; record: string | null };
  startSit: {
    optimalPoints: number;
    currentPoints: number;
    pointsLeftOnBench: number;
    recommendedLineup: { slot: string; player: string; proj: number; sources: number }[];
    shouldStart: { player: string; proj: number }[];
    shouldSit: { player: string; proj: number }[];
    closeCalls: { starter: string; alternative: string; gap: number }[];
  };
  injuries: { player: string; status: string; starting: boolean }[];
  bench: { player: string; position: string; proj: number }[];
  waiverTargets: {
    player: string;
    position: string;
    proj: number;
    marketValue: number;
    trend: number;
    suggestedFaab: string;
  }[];
  dataAvailable: string[];
}

export async function buildLeagueContext(teamId: string): Promise<LeagueContext> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { league: true, roster: true },
  });
  const [ss, wv] = await Promise.all([startSitForTeam(teamId), waiverTargets(teamId, { limit: 12 })]);

  const fmt = team.league.ppr === 1 ? "PPR" : team.league.ppr === 0.5 ? "Half-PPR" : "Standard";
  const sf = team.league.numQbs === 2 ? " Superflex" : "";

  const startIds = new Set(ss.lineup.map((a) => a.player?.sleeperId).filter(Boolean));
  const bench = ss.lineup.length
    ? team.roster
        .filter((r) => r.sleeperId && !startIds.has(r.sleeperId))
        .map((r) => {
          const p = ss.lineup.find((a) => a.player?.sleeperId === r.sleeperId)?.player;
          return { player: r.name, position: r.position, proj: p?.proj ?? 0 };
        })
    : [];

  return {
    league: {
      name: team.league.name,
      platform: team.league.platform,
      week: ss.week,
      format: `${team.league.numTeams}-team ${fmt}${sf}`,
      faabRemaining: wv.remainingBudget,
    },
    team: {
      name: team.name,
      record: team.wins != null && team.losses != null ? `${team.wins}-${team.losses}` : null,
    },
    startSit: {
      optimalPoints: ss.optimalTotal,
      currentPoints: ss.currentTotal,
      pointsLeftOnBench: ss.delta,
      recommendedLineup: ss.lineup
        .filter((a) => a.player)
        .map((a) => ({ slot: a.slot, player: a.player!.name, proj: a.player!.proj, sources: a.player!.sources })),
      shouldStart: ss.start.map((p) => ({ player: p.name, proj: p.proj })),
      shouldSit: ss.sit.map((p) => ({ player: p.name, proj: p.proj })),
      closeCalls: ss.closeCalls.slice(0, 5).map((c) => ({ starter: c.starter.name, alternative: c.alternative.name, gap: c.gap })),
    },
    injuries: ss.injuryAlerts,
    bench: bench.filter((b) => !ss.lineup.some((a) => a.player?.name === b.player)),
    waiverTargets: wv.targets.map((t) => ({
      player: t.name,
      position: t.position,
      proj: t.proj,
      marketValue: t.value,
      trend: t.trend30,
      suggestedFaab: t.faab.dollars != null ? `$${t.faab.dollars}` : `${t.faab.pct}%`,
    })),
    dataAvailable: [
      "consensus projections (Sleeper + ESPN)",
      "FantasyCalc market values",
      "current rosters for all teams in the league",
    ],
  };
}
