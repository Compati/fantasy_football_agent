// Assemble everything the advisor needs about one of my teams into a compact,
// structured context object. This is the grounding the LLM reasons over — it
// never sees raw APIs, only these vetted numbers.

import { prisma } from "@/lib/db";
import { startSitForTeam } from "@/lib/features/startsit";
import { waiverTargets } from "@/lib/features/waivers";
import { getSurvival } from "@/lib/features/survival";
import { rosterOutlook } from "@/lib/features/roster";
import { newsForPlayers } from "@/lib/features/news";
import { propsForPlayers } from "@/lib/features/props";

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
    recommendedLineup: { slot: string; player: string; proj: number; sources: number; opponent?: string | null; matchup?: string; impliedTotal?: number | null; oppVsPosition?: string | null }[];
    shouldStart: { player: string; proj: number }[];
    shouldSit: { player: string; proj: number }[];
    closeCalls: { starter: string; alternative: string; gap: number }[];
  };
  injuries: { player: string; status: string; starting: boolean }[];
  // Present only for Guillotine (play-the-field) leagues — no head-to-head; the
  // single lowest weekly total is eliminated.
  survival?: {
    format: "guillotine";
    numActive: number;
    myProjected: number;
    myRank: number; // 1 = safest
    eliminationLine: number;
    cushion: number; // points above safety (negative = you're on the block)
    onTheBlock: string;
    survivalProb: number | null;
  };
  // marketValue = rest-of-season trade value (0 = none/unknown): the basis for
  // drop decisions, since a player hurt THIS week projects 0 but may be valuable.
  bench: { player: string; position: string; proj: number; marketValue: number; injuryStatus: string | null }[];
  outlook: {
    thinPositions: { position: string; have: number; dedicatedStarters: number }[];
    upcomingByes: { week: number; players: string[]; unfilledSlots: string[] }[];
    nextByeCrunchWeek: number | null; // soonest week a bye leaves a slot unfilled
  };
  waiverTargets: {
    player: string;
    position: string;
    proj: number;
    marketValue: number;
    trend: number;
    injuryStatus: string | null;
    // Priced off this league's real winning bids: low = going rate, high = beats
    // nearly any comparable claim. suggestedBid = high if he clearly starts for
    // you, midpoint if a marginal upgrade, low if depth (see need).
    faabRange: string | null;
    suggestedBid: string | null;
    need: "starts" | "marginal" | "depth" | null;
    hotAdd: boolean; // top trending add across Sleeper -> likely a committed bidder
    contestedShare: number | null; // how often comparable claims here drew a competing bid
  }[];
  // Community context (Phase 4): YouTube items mentioning a rostered or
  // waiver-relevant player, most recent first. Empty until the refresh-news
  // cron has run.
  news: {
    source: "youtube";
    players: string[];
    title: string;
    summary: string | null;
    publishedAt: string;
  }[];
  // Sportsbook player props (Phase 5), a market cross-check alongside the
  // consensus projection — not a replacement for it. Empty until
  // ODDS_API_KEY is set and the refresh-props cron has run.
  props: {
    player: string;
    passYdsLine: number | null;
    rushYdsLine: number | null;
    recYdsLine: number | null;
    anytimeTdProb: number | null; // 0-1
  }[];
  dataAvailable: string[];
}

export async function buildLeagueContext(teamId: string): Promise<LeagueContext> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { league: true, roster: true },
  });
  const [ss, wv, survival, outlook] = await Promise.all([
    startSitForTeam(teamId),
    waiverTargets(teamId, { limit: 12 }),
    getSurvival(teamId).catch(() => null),
    rosterOutlook(teamId).catch(() => null),
  ]);

  const contextIds = [
    ...team.roster.map((r) => r.sleeperId).filter((id): id is string => !!id),
    ...wv.targets.map((t) => t.sleeperId),
  ];
  const [news, props] = await Promise.all([
    newsForPlayers(contextIds, 8).catch(() => []),
    propsForPlayers(contextIds, team.league.season, ss.week).catch(() => []),
  ]);

  const fmt = team.league.ppr === 1 ? "PPR" : team.league.ppr === 0.5 ? "Half-PPR" : "Standard";
  const sf = team.league.numQbs === 2 ? " Superflex" : "";

  const startIds = new Set(ss.lineup.map((a) => a.player?.sleeperId).filter(Boolean));
  const benchPlayers = ss.players.filter((p) => !startIds.has(p.sleeperId));
  const benchValues = new Map(
    (
      await prisma.tradeValue.findMany({
        where: {
          sleeperId: { in: benchPlayers.map((p) => p.sleeperId) },
          isDynasty: false,
          ppr: team.league.ppr,
          numQbs: team.league.numQbs,
          numTeams: team.league.numTeams,
        },
        select: { sleeperId: true, value: true },
      })
    ).map((v) => [v.sleeperId, v.value]),
  );
  const bench = benchPlayers.map((p) => ({
    player: p.name,
    position: p.position,
    proj: p.proj,
    marketValue: benchValues.get(p.sleeperId) ?? 0,
    injuryStatus: p.injuryStatus ?? null,
  }));

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
        .map((a) => {
          const m = a.player!.matchup;
          return {
            slot: a.slot,
            player: a.player!.name,
            proj: a.player!.proj,
            sources: a.player!.sources,
            opponent: m?.opponent ?? null,
            matchup: m?.label,
            impliedTotal: m?.impliedTotal ?? null,
            // Spelled out: a bare "rank 1" was misread as "top defense" (it means
            // the opponent allows the MOST points, i.e. the easiest matchup).
            oppVsPosition: m?.opponent && m.dvpRank != null ? describeDvp(m.opponent, m.dvpRank, a.player!.position) : null,
          };
        }),
      shouldStart: ss.start.map((p) => ({ player: p.name, proj: p.proj })),
      shouldSit: ss.sit.map((p) => ({ player: p.name, proj: p.proj })),
      closeCalls: ss.closeCalls.slice(0, 5).map((c) => ({
        starter: c.starter.name,
        alternative: c.alternative.name,
        gap: c.gap,
      })),
    },
    injuries: ss.injuryAlerts,
    ...(survival
      ? {
          survival: {
            format: "guillotine" as const,
            numActive: survival.numActive,
            myProjected: survival.myProjected,
            myRank: survival.myRank,
            eliminationLine: survival.eliminationLine,
            cushion: survival.cushion,
            onTheBlock: survival.onTheBlock,
            survivalProb: survival.survivalProb,
          },
        }
      : {}),
    outlook: {
      thinPositions: outlook?.thinPositions ?? [],
      upcomingByes: (outlook?.byes ?? []).slice(0, 4).map((b) => ({
        week: b.week,
        players: b.playersOnBye.map((p) => `${p.name} (${p.position})`),
        unfilledSlots: b.unfilledSlots,
      })),
      nextByeCrunchWeek: outlook?.nextByeCrunch?.week ?? null,
    },
    bench,
    waiverTargets: wv.targets.map((t) => ({
      player: t.name,
      position: t.position,
      proj: t.proj,
      marketValue: t.value,
      trend: t.trend30,
      injuryStatus: t.injuryStatus,
      faabRange: t.faab ? `$${t.faab.low}-$${t.faab.high}` : null,
      suggestedBid: t.faab ? `$${t.faab.bid}` : null,
      need: t.faab?.need ?? null,
      hotAdd: t.faab?.hot ?? false,
      contestedShare: t.faab?.contestedShare != null ? Math.round(t.faab.contestedShare * 100) / 100 : null,
    })),
    news: news.map((n) => ({
      source: n.source,
      players: n.players,
      title: n.title,
      summary: n.summary,
      publishedAt: n.publishedAt.toISOString(),
    })),
    props: props.map((p) => ({
      player: p.name,
      passYdsLine: p.passYdsLine,
      rushYdsLine: p.rushYdsLine,
      recYdsLine: p.recYdsLine,
      anytimeTdProb: p.anytimeTdProb != null ? Math.round(p.anytimeTdProb * 100) / 100 : null,
    })),
    dataAvailable: [
      "consensus projections (Sleeper + ESPN)",
      "FantasyCalc market values",
      "current rosters for all teams in the league",
      ...(news.length > 0 ? ["YouTube community context"] : []),
      ...(props.length > 0 ? ["sportsbook player props"] : []),
    ],
  };
}

// "DET allows the 1st-most PPR points to QBs (of 32; easiest matchup)"
function describeDvp(opponent: string, rank: number, position: string): string {
  const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
  const ease = rank <= 6 ? "easy matchup" : rank >= 27 ? "hard matchup" : "average matchup";
  return `${opponent} allows the ${ord(rank)}-most PPR points to ${position}s (of 32; ${ease})`;
}
