// Playoff picture for a head-to-head league: where you sit in the standings,
// the cut line, your chance of making the playoffs, and how much THIS week's
// result matters ("win and you're ~95% in; lose and you're ~40%"). Once the
// playoffs start it reports whether you're still alive in the bracket.
//
// Odds come from a Monte Carlo of the rest of the regular season: every
// remaining game (Sleeper publishes the whole schedule) is played with each
// team's weekly score ~ Normal(strength, TEAM_STDEV). Strength = points per
// game so far, shrunk toward the league average (a few games say little).
// Seeding = wins, then points for (Sleeper's default). The random stream is
// seeded, so the same standings always give the same numbers.
//
// Sleeper-only. Guillotine (play-the-field) leagues have no playoffs → not
// applicable (their survival view is lib/features/survival).

import { prisma } from "@/lib/db";
import {
  getLeague,
  getMatchups,
  getNflState,
  getRosters,
  getWinnersBracket,
  type SleeperBracketGame,
} from "@/lib/sleeper";
import { TEAM_STDEV } from "@/lib/features/survival";
import { getMatchup } from "@/lib/features/matchup";

export interface PlayoffTeam {
  id: string; // roster_id
  name: string;
  isMine: boolean;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export interface RemainingGame {
  week: number;
  a: string;
  b: string;
}

export interface PlayoffOdds {
  odds: Map<string, number>; // team id -> P(finish in the top `spots`)
  // My odds if I win / lose my game in `forceWeek`; null if I have no such game.
  ifWin: number | null;
  ifLoss: number | null;
}

// Small, fast, seedable PRNG (mulberry32) so results are reproducible.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng: () => number): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Average points per game, pulled toward the league mean by `k` phantom games.
export function teamStrengths(teams: PlayoffTeam[], k = 3): Map<string, number> {
  const games = (t: PlayoffTeam) => t.wins + t.losses + t.ties;
  const totalGames = teams.reduce((s, t) => s + games(t), 0);
  const leagueMean = totalGames > 0 ? teams.reduce((s, t) => s + t.pointsFor, 0) / totalGames : 100;
  return new Map(
    teams.map((t) => {
      const g = games(t);
      return [t.id, (t.pointsFor + k * leagueMean) / (g + k)] as const;
    }),
  );
}

interface SimOptions {
  sims?: number;
  seed?: number;
  sigma?: number;
}

// Probability each team finishes in the top `spots` of the final regular-season
// standings. `force` makes my game in that week end in my win/loss (the scores
// are swapped when the draw disagrees, so points-for stays consistent).
function simulate(
  teams: PlayoffTeam[],
  games: RemainingGame[],
  spots: number,
  opts: SimOptions & { force?: { week: number; iWin: boolean } } = {},
): { make: Map<string, number>; mine: number | null } {
  const { sims = 10000, seed = 1, sigma = TEAM_STDEV, force } = opts;
  const rng = makeRng(seed);
  const strength = teamStrengths(teams);
  const idx = new Map(teams.map((t, i) => [t.id, i]));
  const mu = teams.map((t) => strength.get(t.id) ?? 100);
  const me = teams.findIndex((t) => t.isMine);
  const made = new Array<number>(teams.length).fill(0);
  const cut = Math.min(spots, teams.length);

  for (let s = 0; s < sims; s++) {
    const wins = teams.map((t) => t.wins + t.ties / 2);
    const pf = teams.map((t) => t.pointsFor);
    for (const g of games) {
      const i = idx.get(g.a);
      const j = idx.get(g.b);
      if (i == null || j == null) continue;
      let si = mu[i] + sigma * normal(rng);
      let sj = mu[j] + sigma * normal(rng);
      if (force && g.week === force.week && (i === me || j === me)) {
        const iWon = i === me ? si > sj : sj > si;
        // Swap the two draws so the forced side wins; both stay plausible scores.
        if (iWon !== force.iWin) [si, sj] = [sj, si];
      }
      pf[i] += si;
      pf[j] += sj;
      if (si > sj) wins[i] += 1;
      else wins[j] += 1;
    }
    const order = teams.map((_, i) => i).sort((x, y) => wins[y] - wins[x] || pf[y] - pf[x]);
    for (let r = 0; r < cut; r++) made[order[r]]++;
  }
  return {
    make: new Map(teams.map((t, i) => [t.id, made[i] / sims])),
    mine: me >= 0 ? made[me] / sims : null,
  };
}

// Pure core: odds for everyone, plus my odds conditional on this week's result.
export function playoffOdds(
  teams: PlayoffTeam[],
  games: RemainingGame[],
  spots: number,
  opts: SimOptions & { forceWeek?: number } = {},
): PlayoffOdds {
  const base = simulate(teams, games, spots, opts);
  let ifWin: number | null = null;
  let ifLoss: number | null = null;
  const me = teams.find((t) => t.isMine);
  const week = opts.forceWeek;
  if (me && week != null && games.some((g) => g.week === week && (g.a === me.id || g.b === me.id))) {
    ifWin = simulate(teams, games, spots, { ...opts, force: { week, iWin: true } }).mine;
    ifLoss = simulate(teams, games, spots, { ...opts, force: { week, iWin: false } }).mine;
  }
  return { odds: base.make, ifWin, ifLoss };
}

// ---- Bracket (once the playoffs have started) -------------------------------

export interface BracketStatus {
  status: "alive" | "eliminated" | "champion" | "not_in_bracket";
  round: number | null; // round I'm in / was knocked out in
  rounds: number; // total rounds
  opponentRosterId: string | null; // this round's opponent, if known
}

// Where is `myRosterId` in the winners bracket? Placement games (`p`) are ignored.
export function bracketStatus(bracket: SleeperBracketGame[], myRosterId: string): BracketStatus {
  const games = bracket.filter((g) => g.p == null);
  const rounds = games.reduce((m, g) => Math.max(m, g.r), 0);
  const me = Number(myRosterId);
  const mine = games.filter((g) => g.t1 === me || g.t2 === me).sort((a, b) => a.r - b.r);
  if (mine.length === 0) return { status: "not_in_bracket", round: null, rounds, opponentRosterId: null };

  const last = mine[mine.length - 1];
  const opp = last.t1 === me ? last.t2 : last.t1;
  const opponentRosterId = opp != null ? String(opp) : null;
  if (last.l === me) return { status: "eliminated", round: last.r, rounds, opponentRosterId };
  if (last.w === me) {
    // Won that game. Champion if it was the final; otherwise the next round's
    // slot is filled in only once Sleeper advances the bracket.
    return last.r >= rounds
      ? { status: "champion", round: last.r, rounds, opponentRosterId }
      : { status: "alive", round: last.r + 1, rounds, opponentRosterId: null };
  }
  return { status: "alive", round: last.r, rounds, opponentRosterId };
}

// ---- DB/Sleeper wrapper ------------------------------------------------------

export interface PlayoffPicture {
  applicable: true;
  week: number;
  phase: "regular_season" | "playoffs" | "season_over";
  playoffTeams: number;
  playoffWeekStart: number;
  weeksLeftInRegularSeason: number;
  me: { team: string; record: string; pointsFor: number; seed: number };
  // Regular season: current seed vs. the cut line.
  winsAboveCut: number | null; // my wins − wins of the first team OUT (negative = behind)
  makePlayoffsProb: number | null; // 0..1; null once the regular season is over
  ifWinThisWeek: number | null;
  ifLoseThisWeek: number | null;
  thisWeekSwing: number | null; // ifWin − ifLoss: how much this game matters
  status: "locked_in" | "in_the_hunt" | "long_shot" | "out" | "made_playoffs" | "missed_playoffs";
  standings: { seed: number; team: string; record: string; pointsFor: number; makePlayoffsProb: number | null; isMine: boolean }[];
  // Playoff phase only.
  bracket?: { status: BracketStatus["status"]; round: number | null; rounds: number; opponent: string | null; winProbThisWeek: number | null };
}

export interface NotApplicable {
  applicable: false;
  reason: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function statusFor(prob: number): PlayoffPicture["status"] {
  if (prob >= 0.995) return "locked_in";
  if (prob <= 0.005) return "out";
  return prob < 0.15 ? "long_shot" : "in_the_hunt";
}

export async function getPlayoffPicture(teamId: string): Promise<PlayoffPicture | NotApplicable> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { league: { include: { teams: true } } },
  });
  if (team.league.platform !== "sleeper") {
    return { applicable: false, reason: "Playoff odds are only supported for Sleeper leagues." };
  }
  const leagueId = team.league.externalId;
  const [league, rosters, state] = await Promise.all([getLeague(leagueId), getRosters(leagueId), getNflState()]);
  const week = state.week > 0 ? state.week : 1;
  const spots = league.settings.playoff_teams;
  const playoffStart = league.settings.playoff_week_start;
  // Play-the-field leagues (Guillotine) have no pairings → no playoffs.
  const thisWeek = await getMatchups(leagueId, week).catch(() => []);
  if (thisWeek.length > 0 && !thisWeek.some((m) => m.matchup_id != null && thisWeek.filter((x) => x.matchup_id === m.matchup_id).length > 1)) {
    return { applicable: false, reason: "This is a play-the-field (Guillotine) league: no playoffs. Use get_matchup for survival odds." };
  }

  if (!spots || !playoffStart) {
    return { applicable: false, reason: "This league has no playoff settings (playoff_teams / playoff_week_start)." };
  }

  const names = new Map(team.league.teams.map((t) => [t.externalId, t.name]));
  const ptsTeams: PlayoffTeam[] = rosters.map((r) => ({
    id: String(r.roster_id),
    name: names.get(String(r.roster_id)) ?? `Roster ${r.roster_id}`,
    isMine: String(r.roster_id) === team.externalId,
    wins: r.settings.wins ?? 0,
    losses: r.settings.losses ?? 0,
    ties: r.settings.ties ?? 0,
    pointsFor: (r.settings.fpts ?? 0) + (r.settings.fpts_decimal ?? 0) / 100,
  }));
  const mine = ptsTeams.find((t) => t.isMine);
  if (!mine) return { applicable: false, reason: "Your team wasn't found in this league's rosters." };

  const regularEnd = playoffStart - 1;
  const played = mine.wins + mine.losses + mine.ties;
  const weeksLeft = Math.max(0, regularEnd - played);
  const rec = (t: PlayoffTeam) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`;
  const seeded = [...ptsTeams].sort(
    (a, b) => b.wins + b.ties / 2 - (a.wins + a.ties / 2) || b.pointsFor - a.pointsFor,
  );
  const seedOf = (t: PlayoffTeam) => seeded.findIndex((x) => x.id === t.id) + 1;
  const half = (t: PlayoffTeam) => t.wins + t.ties / 2;
  const firstOut = seeded[spots] ?? null;

  // Remaining regular-season schedule, from Sleeper's pre-published pairings.
  const games: RemainingGame[] = [];
  if (weeksLeft > 0) {
    const weeks = Array.from({ length: weeksLeft }, (_, k) => played + 1 + k);
    const rows = await Promise.all(weeks.map((w) => getMatchups(leagueId, w).catch(() => [])));
    rows.forEach((ms, k) => {
      const byId = new Map<number, string[]>();
      for (const m of ms) if (m.matchup_id != null) byId.set(m.matchup_id, [...(byId.get(m.matchup_id) ?? []), String(m.roster_id)]);
      for (const pair of byId.values()) if (pair.length === 2) games.push({ week: weeks[k], a: pair[0], b: pair[1] });
    });
  }

  const standingsBase = seeded.map((t, i) => ({
    seed: i + 1,
    team: t.name,
    record: rec(t),
    pointsFor: Math.round(t.pointsFor * 10) / 10,
    isMine: t.isMine,
  }));
  const meBase = { team: mine.name, record: rec(mine), pointsFor: Math.round(mine.pointsFor * 10) / 10, seed: seedOf(mine) };
  const common = {
    applicable: true as const,
    week,
    playoffTeams: spots,
    playoffWeekStart: playoffStart,
    weeksLeftInRegularSeason: weeksLeft,
    me: meBase,
    winsAboveCut: firstOut ? half(mine) - half(firstOut) : null,
  };

  // Regular season still running: simulate the rest.
  if (weeksLeft > 0) {
    const sim = playoffOdds(ptsTeams, games, spots, { forceWeek: played + 1 });
    const prob = sim.odds.get(mine.id) ?? 0;
    return {
      ...common,
      phase: "regular_season",
      makePlayoffsProb: r3(prob),
      ifWinThisWeek: sim.ifWin != null ? r3(sim.ifWin) : null,
      ifLoseThisWeek: sim.ifLoss != null ? r3(sim.ifLoss) : null,
      thisWeekSwing: sim.ifWin != null && sim.ifLoss != null ? r3(sim.ifWin - sim.ifLoss) : null,
      status: statusFor(prob),
      standings: standingsBase.map((s, i) => ({ ...s, makePlayoffsProb: r3(sim.odds.get(seeded[i].id) ?? 0) })),
    };
  }

  // Regular season over: seeds are final.
  const inPlayoffs = seedOf(mine) <= spots;
  if (week < playoffStart) {
    // Between the last regular-season week and the first playoff week.
    return {
      ...common,
      phase: "regular_season",
      makePlayoffsProb: null,
      ifWinThisWeek: null,
      ifLoseThisWeek: null,
      thisWeekSwing: null,
      status: inPlayoffs ? "made_playoffs" : "missed_playoffs",
      standings: standingsBase.map((s) => ({ ...s, makePlayoffsProb: null })),
    };
  }

  const bracket = await getWinnersBracket(leagueId).catch(() => [] as SleeperBracketGame[]);
  const bs = bracketStatus(bracket, mine.id);
  const alive = bs.status === "alive" || bs.status === "champion";
  const inBracket = bs.status !== "not_in_bracket";
  const wm = alive && bs.status === "alive" ? await getMatchup(team.id).catch(() => null) : null;
  return {
    ...common,
    phase: inBracket || inPlayoffs ? "playoffs" : "season_over",
    makePlayoffsProb: null,
    ifWinThisWeek: null,
    ifLoseThisWeek: null,
    thisWeekSwing: null,
    status: inPlayoffs ? "made_playoffs" : "missed_playoffs",
    standings: standingsBase.map((s) => ({ ...s, makePlayoffsProb: null })),
    bracket: {
      status: bs.status,
      round: bs.round,
      rounds: bs.rounds,
      opponent: bs.opponentRosterId ? (names.get(bs.opponentRosterId) ?? `Roster ${bs.opponentRosterId}`) : null,
      winProbThisWeek: wm?.winProb ?? null,
    },
  };
}
