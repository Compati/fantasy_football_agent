// Yahoo league ingestion (read-only). Uses the `yahoo-fantasy` wrapper with a
// valid access token to pull the user's NFL leagues, teams, and rosters.
//
// NOTE: This path requires a registered Yahoo app + a completed OAuth connect,
// so it is exercised for the first time once real credentials exist. The OAuth
// flow (lib/yahoo/oauth.ts) is standard; the response-shape extraction here is
// coded defensively and may need small tweaks against live data.

import YahooFantasy from "yahoo-fantasy";
import { prisma } from "@/lib/db";
import type { Connection } from "@prisma/client";
import { refreshAccessToken } from "@/lib/yahoo/oauth";
import { ensureCatalogFresh, buildResolver } from "@/lib/players";

// Return a non-expired access token, refreshing + persisting if needed.
async function getValidAccessToken(connection: Connection): Promise<string> {
  const soon = Date.now() + 60_000;
  if (connection.yahooAccessToken && connection.yahooExpiresAt && connection.yahooExpiresAt.getTime() > soon) {
    return connection.yahooAccessToken;
  }
  if (!connection.yahooRefreshToken) throw new Error("Yahoo connection is not authorized.");
  const tokens = await refreshAccessToken(connection.yahooRefreshToken);
  await prisma.connection.update({
    where: { id: connection.id },
    data: {
      yahooAccessToken: tokens.accessToken,
      yahooRefreshToken: tokens.refreshToken,
      yahooExpiresAt: tokens.expiresAt,
      yahooGuid: tokens.guid ?? connection.yahooGuid,
    },
  });
  return tokens.accessToken;
}

function makeClient(accessToken: string) {
  const yf = new YahooFantasy(
    process.env.YAHOO_CLIENT_ID ?? "",
    process.env.YAHOO_CLIENT_SECRET ?? "",
  );
  yf.setUserToken(accessToken);
  return yf;
}

export interface YahooIngestSummary {
  connectionId: string;
  leagues: number;
  teams: number;
}

// Best-effort ingest. Kept small and defensive; the exact nesting of Yahoo's
// responses is normalized where it lands. Season defaults to the current NFL
// game ("nfl").
export async function refreshYahooLeagues(connectionId: string): Promise<YahooIngestSummary> {
  const connection = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
  const accessToken = await getValidAccessToken(connection);
  const yf = makeClient(accessToken);
  await ensureCatalogFresh();
  const resolver = await buildResolver();

  // Leagues the user is in for the current NFL season.
  const gameLeagues: unknown = await yf.user.game_leagues("nfl");
  const leagues = extractLeagues(gameLeagues);

  let teamCount = 0;
  for (const lg of leagues) {
    const league = await prisma.league.upsert({
      where: { platform_externalId: { platform: "yahoo", externalId: lg.leagueKey } },
      update: {
        name: lg.name,
        season: lg.season,
        numTeams: lg.numTeams,
        rosterPositions: lg.rosterPositions,
        scoringSettings: {},
        connectionId,
      },
      create: {
        connectionId,
        platform: "yahoo",
        externalId: lg.leagueKey,
        name: lg.name,
        season: lg.season,
        ppr: lg.ppr,
        numTeams: lg.numTeams,
        numQbs: lg.numQbs,
        faabBudget: lg.faabBudget,
        rosterPositions: lg.rosterPositions,
        scoringSettings: {},
      },
    });

    const teams = extractTeams(await yf.league.teams(lg.leagueKey));
    for (const t of teams) {
      const team = await prisma.team.upsert({
        where: { leagueId_externalId: { leagueId: league.id, externalId: t.teamKey } },
        update: { name: t.name, isMine: t.isMine },
        create: { leagueId: league.id, externalId: t.teamKey, name: t.name, isMine: t.isMine },
      });

      const players = extractRoster(await yf.team.roster(t.teamKey));
      const spots = players.map((p) => ({
        teamId: team.id,
        sleeperId: resolver.byYahooId(p.yahooId) ?? resolver.byNamePos(p.name, p.position),
        name: p.name,
        position: p.position,
        nflTeam: p.nflTeam,
        slot: p.slot,
        starter: p.slot !== "BN" && p.slot !== "IR",
      }));
      await prisma.rosterSpot.deleteMany({ where: { teamId: team.id } });
      if (spots.length > 0) await prisma.rosterSpot.createMany({ data: spots });
      teamCount++;
    }
  }

  return { connectionId, leagues: leagues.length, teams: teamCount };
}

// ---- Defensive extractors (normalize Yahoo's nested shapes) ----------------

interface YLeague {
  leagueKey: string;
  name: string;
  season: number;
  numTeams: number;
  numQbs: number;
  ppr: number;
  faabBudget: number | null;
  rosterPositions: string[];
}

function extractLeagues(raw: unknown): YLeague[] {
  // yahoo-fantasy returns { games: [{ leagues: [...] }] } for game_leagues.
  const out: YLeague[] = [];
  const games = (raw as { games?: unknown[] })?.games ?? [];
  for (const g of games) {
    const lgs = (g as { leagues?: unknown[] })?.leagues ?? [];
    for (const l of lgs) {
      const lg = l as Record<string, unknown>;
      const positions = (lg.roster_positions as { position: string }[] | undefined)?.map((p) => p.position) ?? [];
      out.push({
        leagueKey: String(lg.league_key ?? ""),
        name: String(lg.name ?? "Yahoo League"),
        season: Number(lg.season ?? new Date().getFullYear()),
        numTeams: Number(lg.num_teams ?? 12),
        numQbs: positions.filter((p) => p === "QB" || p === "Q/W/R/T").length >= 2 ? 2 : 1,
        ppr: 0.5, // refined from stat modifiers once verified against live data
        faabBudget: lg.faab_balance != null ? Number(lg.faab_balance) : null,
        rosterPositions: positions,
      });
    }
  }
  return out;
}

interface YTeam { teamKey: string; name: string; isMine: boolean }

function extractTeams(raw: unknown): YTeam[] {
  const teams = (raw as { teams?: unknown[] })?.teams ?? [];
  return teams.map((t) => {
    const tm = t as Record<string, unknown>;
    return {
      teamKey: String(tm.team_key ?? ""),
      name: String(tm.name ?? "Team"),
      isMine: Boolean(tm.is_owned_by_current_login),
    };
  });
}

interface YPlayer { yahooId: string; name: string; position: string; nflTeam: string | null; slot: string }

function extractRoster(raw: unknown): YPlayer[] {
  const roster = (raw as { roster?: unknown[] })?.roster ?? [];
  return roster.map((p) => {
    const pl = p as Record<string, unknown>;
    const name = (pl.name as { full?: string } | undefined)?.full ?? String(pl.name ?? "");
    const selected = pl.selected_position as { position?: string } | undefined;
    return {
      yahooId: String(pl.player_id ?? ""),
      name,
      position: String(pl.display_position ?? pl.primary_position ?? "?"),
      nflTeam: (pl.editorial_team_abbr as string | undefined) ?? null,
      slot: selected?.position ?? "BN",
    };
  });
}
