// Sleeper client. Everything here is free, public, read-only — no auth. Docs:
// https://docs.sleeper.com/  (projections/stats endpoints are used by the app
// but undocumented, so treated as best-effort).
//
// Rate limit guidance from Sleeper: stay under ~1000 calls/min per IP. Our cron
// pulls are far below that.

import { getJson } from "@/lib/http";
import type { CanonicalPlayer, ProjectionRow } from "@/lib/types";

const API = "https://api.sleeper.app/v1"; // documented read API
const DATA = "https://api.sleeper.com"; // undocumented stats/projections host

// ---- Accounts / leagues ---------------------------------------------------

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
}

export async function getUser(username: string): Promise<SleeperUser> {
  return getJson<SleeperUser>(`${API}/user/${encodeURIComponent(username)}`);
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  scoring_settings: Record<string, number>;
  roster_positions: string[]; // e.g. ["QB","RB","RB","WR","WR","FLEX","BN",...]
  settings: Record<string, number>; // includes waiver_budget, waiver_type (2 = FAAB), etc.
  previous_league_id?: string | null; // last season's league ("0"/null if none)
}

export async function getUserLeagues(
  userId: string,
  season: number | string,
  sport = "nfl",
): Promise<SleeperLeague[]> {
  return getJson<SleeperLeague[]>(`${API}/user/${userId}/leagues/${sport}/${season}`);
}

export async function getLeague(leagueId: string): Promise<SleeperLeague> {
  return getJson<SleeperLeague>(`${API}/league/${leagueId}`);
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null; // sleeper player ids
  starters: string[] | null;
  settings: Record<string, number>; // includes waiver_budget_used, wins, etc.
}

export async function getRosters(leagueId: string): Promise<SleeperRoster[]> {
  return getJson<SleeperRoster[]>(`${API}/league/${leagueId}/rosters`);
}

export interface SleeperLeagueUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string };
}

export async function getLeagueUsers(leagueId: string): Promise<SleeperLeagueUser[]> {
  return getJson<SleeperLeagueUser[]>(`${API}/league/${leagueId}/users`);
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id: number | null;
  points: number;
  players: string[] | null;
  starters: string[] | null;
}

export async function getMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]> {
  return getJson<SleeperMatchup[]>(`${API}/league/${leagueId}/matchups/${week}`);
}

// Current NFL state (season, week) so callers don't hardcode the week.
export interface SleeperState {
  season: string;
  season_type: string;
  week: number;
  display_week: number;
}

// Transactions for one league "leg" (week): waivers (won + failed claims, with
// the FAAB bid), free-agent adds, trades.
export interface SleeperTransaction {
  transaction_id: string;
  type: string; // "waiver" | "free_agent" | "trade" | ...
  status: string; // "complete" | "failed"
  adds?: Record<string, number> | null; // player_id -> roster_id
  settings?: { waiver_bid?: number } | null;
}

// Actual weekly results for one position: team, opponent faced, PPR points.
export interface WeeklyStat {
  player_id: string;
  team: string | null;
  opponent: string | null;
  stats?: { pts_ppr?: number | null; gp?: number | null };
}

export async function getWeeklyStats(season: number, week: number, position: string): Promise<WeeklyStat[]> {
  return getJson<WeeklyStat[]>(`${DATA}/stats/nfl/${season}/${week}?season_type=regular&position[]=${position}`);
}

// Most-added players across all of Sleeper over the lookback window — a live
// demand signal for waiver competition.
export async function getTrendingAdds(lookbackHours = 48, limit = 50): Promise<{ player_id: string; count: number }[]> {
  return getJson(`${API}/players/nfl/trending/add?lookback_hours=${lookbackHours}&limit=${limit}`);
}

export async function getTransactions(leagueId: string, week: number): Promise<SleeperTransaction[]> {
  return getJson<SleeperTransaction[]>(`${API}/league/${leagueId}/transactions/${week}`);
}

// PLAN_WEEK=6 plans that week instead of Sleeper's live one. Sleeper only moves
// to the next week on Tuesday, so late in a week (Monday night) the live week
// is already decided and the useful question is the next one. Unset = live week.
export async function getNflState(): Promise<SleeperState> {
  const state = await getJson<SleeperState>(`${API}/state/nfl`);
  const planWeek = Number(process.env.PLAN_WEEK);
  return Number.isInteger(planWeek) && planWeek >= 1 && planWeek <= 18
    ? { ...state, week: planWeek, display_week: planWeek }
    : state;
}

// ---- Schedule / byes -------------------------------------------------------

// Regular-season schedule: one row per game. A team's bye week is the week it
// appears in no game. Lives on the api.sleeper.com host (not the /v1 API).
export interface SleeperGame {
  week: number;
  home: string;
  away: string;
  status: string;
  date?: string; // "YYYY-MM-DD"
}

// The schedule is fixed for a season, so memoize it per season for the process.
const scheduleCache = new Map<number, Promise<SleeperGame[]>>();

export function getSchedule(season: number): Promise<SleeperGame[]> {
  const cached = scheduleCache.get(season);
  if (cached) return cached;
  const p = getJson<SleeperGame[]>(`https://api.sleeper.com/schedule/nfl/regular/${season}`).catch(
    (e) => {
      scheduleCache.delete(season); // don't cache a failure
      throw e;
    },
  );
  scheduleCache.set(season, p);
  return p;
}

// ---- Player catalog -------------------------------------------------------

// The full catalog is ~5MB. It carries cross-ids (espn_id, yahoo_id) which make
// it the seed for our canonical Player table and the join hub for every other
// source. Callers should cache this (daily) rather than fetch per request.
interface SleeperCatalogEntry {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string | null;
  espn_id?: number | string | null;
  yahoo_id?: number | string | null;
  injury_status?: string | null;
}

export async function getPlayersCatalog(): Promise<Record<string, SleeperCatalogEntry>> {
  return getJson<Record<string, SleeperCatalogEntry>>(`${API}/players/nfl`, {
    timeoutMs: 60_000,
  });
}

// Normalize the raw catalog into CanonicalPlayer rows, keeping only real,
// fantasy-relevant players (must have a position and a name).
export function toCanonicalPlayers(
  catalog: Record<string, SleeperCatalogEntry>,
): CanonicalPlayer[] {
  const out: CanonicalPlayer[] = [];
  for (const [id, p] of Object.entries(catalog)) {
    const name = p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    if (!name || !p.position) continue;
    out.push({
      sleeperId: id,
      espnId: p.espn_id != null ? String(p.espn_id) : null,
      yahooId: p.yahoo_id != null ? String(p.yahoo_id) : null,
      name,
      position: p.position,
      team: p.team ?? null,
      injuryStatus: p.injury_status || null,
    });
  }
  return out;
}

// ---- Projections (undocumented, best-effort) ------------------------------

interface SleeperProjectionEntry {
  player_id: string;
  stats?: Record<string, number>;
}

// Fetch weekly projections. `pprKey` selects which precomputed points field to
// read: pts_ppr (full), pts_half_ppr, or pts_std. Returns rows tagged source
// "sleeper" that the caller resolves against the canonical catalog (the ids
// already ARE sleeper ids, so resolution is trivial).
export async function getProjections(
  season: number,
  week: number,
  ppr: number,
): Promise<ProjectionRow[]> {
  const pprKey = ppr >= 1 ? "pts_ppr" : ppr > 0 ? "pts_half_ppr" : "pts_std";
  const url = `${DATA}/projections/nfl/${season}/${week}?season_type=regular&order_by=${pprKey}`;
  const raw = await getJson<SleeperProjectionEntry[]>(url);
  const rows: ProjectionRow[] = [];
  for (const entry of raw) {
    const pts = entry.stats?.[pprKey];
    if (pts == null) continue;
    rows.push({
      sleeperId: entry.player_id,
      source: "sleeper",
      season,
      week,
      points: pts,
    });
  }
  return rows;
}
