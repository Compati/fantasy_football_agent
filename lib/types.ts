// Shared domain types for the fantasy agent. Kept framework-free so the
// ingestion clients and the probe script can import them without pulling in
// Next.js or Prisma.

export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DEF" | string;

// A projection source. Adding a new source = a new adapter that emits rows with
// its own tag; nothing downstream needs to change (see lib/projections).
export type ProjectionSource = "sleeper" | "espn" | "cbs" | "fantasypros";

// Canonical player identity. Seeded from the Sleeper player catalog, which
// conveniently carries the ESPN and Yahoo ids too — so every other source joins
// back to this one:
//   - FantasyCalc rows carry `player.sleeperId`  -> sleeperId
//   - ESPN projections carry the ESPN player id  -> espnId
//   - Yahoo rosters carry the Yahoo player id     -> yahooId
export interface CanonicalPlayer {
  sleeperId: string;
  espnId: string | null;
  yahooId: string | null;
  name: string;
  position: Position;
  team: string | null; // NFL team abbrev, e.g. "SF"
  injuryStatus: string | null; // "Questionable" | "Doubtful" | "Out" | "IR" | ...
}

// One projection reading for a player in a given week from a given source.
export interface ProjectionRow {
  sleeperId: string; // canonical join key (resolved by the caller)
  source: ProjectionSource;
  season: number;
  week: number;
  points: number; // fantasy points in the relevant scoring format
}

// A FantasyCalc trade value / market ranking for a player.
export interface TradeValueRow {
  sleeperId: string | null;
  name: string;
  position: Position;
  value: number; // format-specific value (redraft or dynasty per query)
  redraftValue: number;
  overallRank: number;
  positionRank: number;
  trend30Day: number;
  tier: number | null;
}

// Common scoring knobs that most sources need to be told about so their numbers
// match a given league.
export interface ScoringContext {
  ppr: number; // 0 = standard, 0.5 = half, 1 = full
  numQbs: number; // 1 = standard, 2 = superflex
  numTeams: number;
}

export const DEFAULT_SCORING: ScoringContext = { ppr: 1, numQbs: 1, numTeams: 12 };
