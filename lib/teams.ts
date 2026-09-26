// Canonical NFL team names + abbreviations, with a normalizer used to match
// teams across data feeds (The Odds API uses full names; Sleeper's Player
// table uses abbreviations). Adapted from pickem/lib/teams.ts (separate repo,
// so the logic is copied rather than cross-imported — same pattern as
// lib/nflweek.ts). Abbreviations verified to match Sleeper's own catalog
// (JAX not JAC, LAR not LA, WAS not WSH, LV not OAK).

export interface NflTeam {
  name: string; // canonical full name
  abbr: string;
}

export const NFL_TEAMS: NflTeam[] = [
  { name: "Arizona Cardinals", abbr: "ARI" },
  { name: "Atlanta Falcons", abbr: "ATL" },
  { name: "Baltimore Ravens", abbr: "BAL" },
  { name: "Buffalo Bills", abbr: "BUF" },
  { name: "Carolina Panthers", abbr: "CAR" },
  { name: "Chicago Bears", abbr: "CHI" },
  { name: "Cincinnati Bengals", abbr: "CIN" },
  { name: "Cleveland Browns", abbr: "CLE" },
  { name: "Dallas Cowboys", abbr: "DAL" },
  { name: "Denver Broncos", abbr: "DEN" },
  { name: "Detroit Lions", abbr: "DET" },
  { name: "Green Bay Packers", abbr: "GB" },
  { name: "Houston Texans", abbr: "HOU" },
  { name: "Indianapolis Colts", abbr: "IND" },
  { name: "Jacksonville Jaguars", abbr: "JAX" },
  { name: "Kansas City Chiefs", abbr: "KC" },
  { name: "Las Vegas Raiders", abbr: "LV" },
  { name: "Los Angeles Chargers", abbr: "LAC" },
  { name: "Los Angeles Rams", abbr: "LAR" },
  { name: "Miami Dolphins", abbr: "MIA" },
  { name: "Minnesota Vikings", abbr: "MIN" },
  { name: "New England Patriots", abbr: "NE" },
  { name: "New Orleans Saints", abbr: "NO" },
  { name: "New York Giants", abbr: "NYG" },
  { name: "New York Jets", abbr: "NYJ" },
  { name: "Philadelphia Eagles", abbr: "PHI" },
  { name: "Pittsburgh Steelers", abbr: "PIT" },
  { name: "San Francisco 49ers", abbr: "SF" },
  { name: "Seattle Seahawks", abbr: "SEA" },
  { name: "Tampa Bay Buccaneers", abbr: "TB" },
  { name: "Tennessee Titans", abbr: "TEN" },
  { name: "Washington Commanders", abbr: "WAS" },
];

const ALIASES: Record<string, string> = {
  "la rams": "los angeles rams",
  "la chargers": "los angeles chargers",
  "washington football team": "washington commanders",
  "washington redskins": "washington commanders",
  "oakland raiders": "las vegas raiders",
  "san diego chargers": "los angeles chargers",
  "st louis rams": "los angeles rams",
  // Legacy abbreviations some feeds (CBS) still use.
  jac: "jacksonville jaguars",
  wsh: "washington commanders",
};

function normalizeKey(raw: string): string {
  let s = raw.toLowerCase().trim().replace(/[.]/g, "").replace(/\s+/g, " ");
  if (ALIASES[s]) s = ALIASES[s];
  return s;
}

const BY_KEY = new Map<string, NflTeam>();
for (const t of NFL_TEAMS) {
  BY_KEY.set(normalizeKey(t.name), t);
  BY_KEY.set(t.abbr.toLowerCase(), t);
}
for (const [alias, canonical] of Object.entries(ALIASES)) {
  const team = BY_KEY.get(normalizeKey(canonical));
  if (team) BY_KEY.set(alias, team);
}

export function resolveTeam(raw: string | null | undefined): NflTeam | null {
  if (!raw) return null;
  return BY_KEY.get(normalizeKey(raw)) ?? null;
}

export function teamAbbr(raw: string): string | null {
  return resolveTeam(raw)?.abbr ?? null;
}

// Canonical full name (falls back to the raw input if unrecognized).
export function canonicalTeamName(raw: string): string {
  return resolveTeam(raw)?.name ?? raw;
}
