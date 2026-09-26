// ESPN projections adapter (unofficial). ESPN's fantasy API exposes projected
// points through the `kona_player_info` view on the public league-defaults
// endpoint — no login required for the shared projection data.
//
//   https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}
//     /segments/0/leaguedefaults/{scoringId}?view=kona_player_info
//
// The player list and the stat filter are passed via the `x-fantasy-filter`
// header. Each player carries a `stats[]` array; the weekly projection is the
// entry with statSourceId===1 (projected) and scoringPeriodId===week.
//
// ESPN ids join back to our canonical players via the Sleeper catalog's
// espn_id, so this adapter takes an espnId -> sleeperId map and emits rows for
// the players it can resolve (reporting the rest to the caller).

import { getJson } from "@/lib/http";
import type { ProjectionRow } from "@/lib/types";
import { teamByNickname } from "@/lib/teams";

const HOST = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

// leaguedefaults scoring profiles: 1 = standard, 3 = PPR (the two we need).
function scoringId(ppr: number): number {
  return ppr >= 0.5 ? 3 : 1;
}

interface EspnStat {
  seasonId?: number;
  scoringPeriodId?: number;
  statSourceId?: number; // 0 = actual, 1 = projected
  statSplitTypeId?: number; // 0 = season, 1 = week
  appliedTotal?: number;
}
interface EspnPlayerWrap {
  id?: number;
  player?: {
    id?: number;
    fullName?: string;
    defaultPositionId?: number;
    stats?: EspnStat[];
  };
}

// ESPN's defaultPositionId -> our position abbrev (for the name+pos fallback).
const ESPN_POSITION: Record<number, string> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF" };
interface EspnResponse {
  players?: EspnPlayerWrap[];
}

export interface EspnProjectionResult {
  rows: ProjectionRow[];
  fetched: number; // players returned by ESPN
  matchedProjection: number; // players that had a usable weekly projection
  unresolvedEspnIds: number; // projections we couldn't map to a sleeperId
}

export async function getEspnProjections(
  season: number,
  week: number,
  ppr: number,
  espnIdToSleeperId: Map<string, string>,
  limit = 600,
  // Optional fallback: resolve by (name, position) when the ESPN id doesn't map
  // to a canonical player. Lifts 2-source consensus coverage substantially.
  namePosResolver?: (name: string, position: string) => string | null,
): Promise<EspnProjectionResult> {
  const filter = {
    players: {
      limit,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      filterStatsForSplitTypeIds: { value: [1] },
      filterStatsForSourceIds: { value: [0, 1] },
    },
  };
  const url = `${HOST}/seasons/${season}/segments/0/leaguedefaults/${scoringId(ppr)}?view=kona_player_info`;
  const data = await getJson<EspnResponse>(url, {
    headers: { "x-fantasy-filter": JSON.stringify(filter) },
  });

  const players = data.players ?? [];
  const rows: ProjectionRow[] = [];
  let matched = 0;
  let unresolved = 0;

  for (const wrap of players) {
    const p = wrap.player;
    const espnId = p?.id ?? wrap.id;
    if (espnId == null || !p?.stats) continue;

    const proj = p.stats.find(
      (s) =>
        s.statSourceId === 1 &&
        s.scoringPeriodId === week &&
        s.seasonId === season &&
        typeof s.appliedTotal === "number",
    );
    if (!proj || proj.appliedTotal == null) continue;
    matched++;

    let sleeperId = espnIdToSleeperId.get(String(espnId)) ?? null;
    // Defenses: "Seahawks D/ST" -> Sleeper's DEF id, which is the team abbrev.
    if (!sleeperId && p.defaultPositionId === 16 && p.fullName) {
      sleeperId = teamByNickname(p.fullName.replace(/\s*D\/ST$/i, ""))?.abbr ?? null;
    }
    if (!sleeperId && namePosResolver && p.fullName && p.defaultPositionId != null) {
      const pos = ESPN_POSITION[p.defaultPositionId];
      if (pos) sleeperId = namePosResolver(p.fullName, pos);
    }
    if (!sleeperId) {
      unresolved++;
      continue;
    }
    rows.push({
      sleeperId,
      source: "espn",
      season,
      week,
      points: Math.round(proj.appliedTotal * 100) / 100,
    });
  }

  return {
    rows,
    fetched: players.length,
    matchedProjection: matched,
    unresolvedEspnIds: unresolved,
  };
}
