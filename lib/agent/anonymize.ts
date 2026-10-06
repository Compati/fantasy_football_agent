// Demo mode (DEMO_ANON=1): hide other managers' team names. Tool results are
// rewritten before the model sees them, so the real names never reach the
// model, the terminal printout or the answer. My own team name and the league
// names stay — they're mine to show.

export const demoAnonEnabled = () => process.env.DEMO_ANON === "1";

export interface AliasTeam {
  leagueName: string;
  externalId: string;
  name: string;
  isMine: boolean;
}

const key = (name: string) => name.trim().toLowerCase();

// "Team 1…N" per league, in roster-id order so a team keeps its alias from one
// run to the next. A name used in two leagues keeps the first alias it gets.
export function buildAliases(teams: AliasTeam[]): Map<string, string> {
  const mine = new Set(teams.filter((t) => t.isMine).map((t) => key(t.name)));
  const byLeague = new Map<string, AliasTeam[]>();
  for (const t of teams) {
    if (t.isMine) continue;
    byLeague.set(t.leagueName, [...(byLeague.get(t.leagueName) ?? []), t]);
  }
  const aliases = new Map<string, string>();
  for (const leagueName of [...byLeague.keys()].sort()) {
    const others = byLeague
      .get(leagueName)!
      .sort((a, b) => a.externalId.localeCompare(b.externalId, undefined, { numeric: true }));
    others.forEach((t, i) => {
      const k = key(t.name);
      if (k && !mine.has(k) && !aliases.has(k)) aliases.set(k, `Team ${i + 1}`);
    });
  }
  return aliases;
}

// Replace every string VALUE that is exactly a team name. Whole values only —
// a substring replace could mangle a player name that contains a team's name.
export function anonymize<T>(value: T, aliases: Map<string, string>): T {
  if (aliases.size === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return aliases.get(key(v)) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}
