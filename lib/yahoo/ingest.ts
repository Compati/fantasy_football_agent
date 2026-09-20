// Yahoo league ingestion (read-only) via the direct REST client. Pulls the
// user's NFL leagues, settings, all teams, and rosters into the DB — the same
// shape Sleeper ingest produces, so the decision features work unchanged.

import { prisma } from "@/lib/db";
import type { Connection } from "@prisma/client";
import { refreshAccessToken } from "@/lib/yahoo/oauth";
import { ensureCatalogFresh, buildResolver } from "@/lib/players";
import { yahooGet, coll, merge } from "@/lib/yahoo/api";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Map Yahoo lineup-slot labels to our canonical vocabulary (lib/features/eligibility.ts).
const YAHOO_SLOT: Record<string, string> = {
  "W/R/T": "FLEX",
  "Q/W/R/T": "SUPER_FLEX",
  "W/R": "WRRB_FLEX",
  "W/T": "REC_FLEX",
  "IR": "IR",
  "IR+": "IR",
};
const mapSlot = (s: string) => YAHOO_SLOT[s] ?? s;

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

export interface YahooIngestSummary {
  connectionId: string;
  leagues: number;
  teams: number;
}

// ---- Parsers (defensive against Yahoo's nesting) --------------------------

interface YLeagueMeta {
  leagueKey: string;
  name: string;
  season: number;
  numTeams: number;
}

function parseMyLeagues(fc: any): YLeagueMeta[] {
  const out: YLeagueMeta[] = [];
  const users = coll(fc?.users);
  for (const u of users) {
    const userArr = u.user; // [ {guid...}, { games } ]
    const gamesNode = Array.isArray(userArr) ? userArr.find((x: any) => x?.games)?.games : undefined;
    for (const g of coll(gamesNode)) {
      const gameArr = g.game; // [ {game meta}, { leagues } ]
      const leaguesNode = Array.isArray(gameArr) ? gameArr.find((x: any) => x?.leagues)?.leagues : undefined;
      for (const l of coll(leaguesNode)) {
        const m = merge(l.league);
        if (!m.league_key) continue;
        out.push({
          leagueKey: String(m.league_key),
          name: String(m.name ?? "Yahoo League"),
          season: Number(m.season ?? new Date().getFullYear()),
          numTeams: Number(m.num_teams ?? 12),
        });
      }
    }
  }
  return out;
}

interface YSettings {
  ppr: number;
  numQbs: number;
  faabBudget: number | null;
  rosterPositions: string[]; // canonical, expanded (one entry per slot)
}

function parseSettings(fc: any): YSettings {
  const leagueArr = fc?.league; // [ {league meta}, { settings: [...] } ]
  const settingsNode = Array.isArray(leagueArr) ? leagueArr.find((x: any) => x?.settings)?.settings : undefined;
  const s = merge(settingsNode);

  // Roster positions: [ { roster_position: { position, count } } ] -> flat list.
  const positions: string[] = [];
  for (const rp of Array.isArray(s.roster_positions) ? s.roster_positions : coll(s.roster_positions)) {
    const p = rp.roster_position ?? rp;
    const pos = mapSlot(String(p.position));
    const count = Number(p.count ?? 1);
    for (let i = 0; i < count; i++) positions.push(pos);
  }
  const numQbs = positions.includes("SUPER_FLEX") ? 2 : 1;

  // PPR from the receptions stat modifier (Yahoo stat_id 11).
  let ppr = 0;
  const statsNode = s.stat_modifiers?.stats ?? s.stat_modifiers;
  for (const st of Array.isArray(statsNode) ? statsNode : coll(statsNode)) {
    const stat = st.stat ?? st;
    if (String(stat.stat_id) === "11") {
      const v = Number(stat.value);
      ppr = v >= 1 ? 1 : v >= 0.5 ? 0.5 : 0;
    }
  }

  const usesFaab = String(s.uses_faab ?? "0") === "1";
  return { ppr, numQbs, faabBudget: usesFaab ? 100 : null, rosterPositions: positions };
}

interface YTeam {
  teamKey: string;
  name: string;
  isMine: boolean;
  faabBalance: number | null;
}

function parseTeams(fc: any): YTeam[] {
  const leagueArr = fc?.league;
  const teamsNode = Array.isArray(leagueArr) ? leagueArr.find((x: any) => x?.teams)?.teams : undefined;
  return coll(teamsNode).map((t: any) => {
    const m = merge(t.team);
    return {
      teamKey: String(m.team_key ?? ""),
      name: String(m.name ?? "Team"),
      isMine: String(m.is_owned_by_current_login ?? "0") === "1",
      faabBalance: m.faab_balance != null ? Number(m.faab_balance) : null,
    };
  });
}

interface YRosterPlayer {
  yahooId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  slot: string;
}

function parseRoster(fc: any): YRosterPlayer[] {
  const teamArr = fc?.team; // [ [team meta], { roster: {...} } ]
  const rosterNode = Array.isArray(teamArr) ? teamArr.find((x: any) => x?.roster)?.roster : undefined;
  // roster is an object; the players collection sits under a "0" key.
  const playersNode = rosterNode?.["0"]?.players ?? rosterNode?.players;
  return coll(playersNode).map((p: any) => {
    const arr = p.player; // [ [meta objs], { selected_position } ]
    const meta = merge(Array.isArray(arr) ? arr[0] : arr);
    const selNode = Array.isArray(arr) ? arr.find((x: any) => x?.selected_position)?.selected_position : undefined;
    const sel = merge(selNode);
    const nameObj = meta.name;
    const name = typeof nameObj === "object" ? String(nameObj.full ?? "") : String(nameObj ?? "");
    const pos = String(meta.display_position ?? meta.primary_position ?? "?").split(",")[0];
    return {
      yahooId: String(meta.player_id ?? ""),
      name,
      position: pos,
      nflTeam: (meta.editorial_team_abbr as string) ?? null,
      slot: mapSlot(String(sel.position ?? "BN")),
    };
  });
}

// ---- Orchestration --------------------------------------------------------

export async function refreshYahooLeagues(connectionId: string): Promise<YahooIngestSummary> {
  const connection = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
  const token = await getValidAccessToken(connection);
  await ensureCatalogFresh();
  const resolver = await buildResolver();

  const leagues = parseMyLeagues(await yahooGet(token, "/users;use_login=1/games;game_keys=nfl/leagues"));
  let teamCount = 0;

  for (const lg of leagues) {
    const settings = parseSettings(await yahooGet(token, `/league/${lg.leagueKey}/settings`));
    const league = await prisma.league.upsert({
      where: { platform_externalId: { platform: "yahoo", externalId: lg.leagueKey } },
      update: {
        name: lg.name,
        season: lg.season,
        ppr: settings.ppr,
        numTeams: lg.numTeams,
        numQbs: settings.numQbs,
        faabBudget: settings.faabBudget,
        rosterPositions: settings.rosterPositions,
        scoringSettings: {},
        connectionId,
      },
      create: {
        connectionId,
        platform: "yahoo",
        externalId: lg.leagueKey,
        name: lg.name,
        season: lg.season,
        ppr: settings.ppr,
        numTeams: lg.numTeams,
        numQbs: settings.numQbs,
        faabBudget: settings.faabBudget,
        rosterPositions: settings.rosterPositions,
        scoringSettings: {},
      },
    });

    const teams = parseTeams(await yahooGet(token, `/league/${lg.leagueKey}/teams`));
    for (const t of teams) {
      const team = await prisma.team.upsert({
        where: { leagueId_externalId: { leagueId: league.id, externalId: t.teamKey } },
        update: {
          name: t.name,
          isMine: t.isMine,
          faabBudgetUsed: t.faabBalance != null && settings.faabBudget != null ? settings.faabBudget - t.faabBalance : null,
        },
        create: {
          leagueId: league.id,
          externalId: t.teamKey,
          name: t.name,
          isMine: t.isMine,
          faabBudgetUsed: t.faabBalance != null && settings.faabBudget != null ? settings.faabBudget - t.faabBalance : null,
        },
      });

      const players = parseRoster(await yahooGet(token, `/team/${t.teamKey}/roster`));
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
