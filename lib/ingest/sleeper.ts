// Sleeper ingestion: connect an account (by username, no auth) and pull its
// leagues, teams, and rosters into the DB.

import { prisma } from "@/lib/db";
import {
  getUser,
  getUserLeagues,
  getRosters,
  getLeagueUsers,
  getNflState,
  getLeague,
  type SleeperLeague,
} from "@/lib/sleeper";
import { ensureCatalogFresh, playerDetailMap } from "@/lib/players";
import { parseLeagueSettings, starterSlots, rosterToSpots } from "@/lib/ingest/sleeper-transform";

export interface SleeperIngestSummary {
  connectionId: string;
  username: string;
  season: number;
  leagues: number;
  teams: number;
}

export async function connectSleeper(
  userId: string,
  username: string,
  season?: number,
): Promise<SleeperIngestSummary> {
  const user = await getUser(username.trim());
  if (!user?.user_id) throw new Error(`Sleeper user "${username}" not found.`);

  const connection = await prisma.connection.upsert({
    where: { userId_platform: { userId, platform: "sleeper" } },
    update: { sleeperUsername: user.username, sleeperUserId: user.user_id },
    create: {
      userId,
      platform: "sleeper",
      sleeperUsername: user.username,
      sleeperUserId: user.user_id,
    },
  });

  return refreshSleeperLeagues(connection.id, season);
}

export async function refreshSleeperLeagues(
  connectionId: string,
  season?: number,
): Promise<SleeperIngestSummary> {
  const connection = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
  if (!connection.sleeperUserId) throw new Error("Connection has no Sleeper user id.");

  const resolvedSeason = season ?? Number((await getNflState()).season);
  await ensureCatalogFresh();

  const leagues = await getUserLeagues(connection.sleeperUserId, resolvedSeason);
  let teamCount = 0;

  for (const lg of leagues) {
    teamCount += await syncLeague(connection, lg, resolvedSeason);
  }

  return {
    connectionId,
    username: connection.sleeperUsername ?? "",
    season: resolvedSeason,
    leagues: leagues.length,
    teams: teamCount,
  };
}

type SleeperConnection = { id: string; sleeperUserId: string | null };

// Upsert one Sleeper league plus every team + roster in it. Returns team count.
async function syncLeague(
  connection: SleeperConnection,
  lg: SleeperLeague,
  resolvedSeason: number,
): Promise<number> {
  const connectionId = connection.id;
  let teamCount = 0;
  const norm = parseLeagueSettings(lg);
  const league = await prisma.league.upsert({
    where: { platform_externalId: { platform: "sleeper", externalId: lg.league_id } },
    update: {
      name: lg.name,
      season: resolvedSeason,
      ppr: norm.ppr,
      numTeams: norm.numTeams,
      numQbs: norm.numQbs,
      faabBudget: norm.faabBudget,
      rosterPositions: norm.rosterPositions,
      scoringSettings: lg.scoring_settings ?? {},
      connectionId,
    },
    create: {
      connectionId,
      platform: "sleeper",
      externalId: lg.league_id,
      name: lg.name,
      season: resolvedSeason,
      ppr: norm.ppr,
      numTeams: norm.numTeams,
      numQbs: norm.numQbs,
      faabBudget: norm.faabBudget,
      rosterPositions: norm.rosterPositions,
      scoringSettings: lg.scoring_settings ?? {},
    },
  });

  const [rosters, users] = await Promise.all([
    getRosters(lg.league_id),
    getLeagueUsers(lg.league_id),
  ]);
  const userById = new Map(users.map((u) => [u.user_id, u]));

  // One detail lookup for every player across all rosters in this league.
  const allIds = [...new Set(rosters.flatMap((r) => r.players ?? []))];
  const detail = await playerDetailMap(allIds);
  const slots = starterSlots(norm.rosterPositions);

  for (const roster of rosters) {
    const owner = roster.owner_id ? userById.get(roster.owner_id) : undefined;
    const teamName =
      owner?.metadata?.team_name || owner?.display_name || `Roster ${roster.roster_id}`;
    const isMine = roster.owner_id === connection.sleeperUserId;

    const team = await prisma.team.upsert({
      where: { leagueId_externalId: { leagueId: league.id, externalId: String(roster.roster_id) } },
      update: {
        name: teamName,
        ownerName: owner?.display_name ?? null,
        isMine,
        faabBudgetUsed: roster.settings?.waiver_budget_used ?? null,
        wins: roster.settings?.wins ?? null,
        losses: roster.settings?.losses ?? null,
      },
      create: {
        leagueId: league.id,
        externalId: String(roster.roster_id),
        name: teamName,
        ownerName: owner?.display_name ?? null,
        isMine,
        faabBudgetUsed: roster.settings?.waiver_budget_used ?? null,
        wins: roster.settings?.wins ?? null,
        losses: roster.settings?.losses ?? null,
      },
    });

    const spots = rosterToSpots(roster, slots, detail);
    await prisma.rosterSpot.deleteMany({ where: { teamId: team.id } });
    if (spots.length > 0) {
      await prisma.rosterSpot.createMany({
        data: spots.map((s) => ({ teamId: team.id, ...s })),
      });
    }
    teamCount++;
  }
  return teamCount;
}

// Re-pull a single league's rosters (adds/drops/lineup changes made in Sleeper)
// if our copy is older than maxAgeMs. The league page calls this so moves show
// up without clicking "Refresh leagues" or waiting on the daily cron. Returns
// whether a refresh ran.
export async function refreshSleeperLeagueIfStale(leagueId: string, maxAgeMs: number): Promise<boolean> {
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId },
    include: { connection: true },
  });
  if (league.platform !== "sleeper") return false;
  if (Date.now() - league.updatedAt.getTime() <= maxAgeMs) return false;
  await ensureCatalogFresh();
  const lg = await getLeague(league.externalId);
  await syncLeague(league.connection, lg, league.season);
  return true;
}
