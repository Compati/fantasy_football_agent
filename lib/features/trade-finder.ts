// Trade finder: concrete, proposable trades between you and each other team in
// the league. Pure core (unit-tested) + a DB wrapper below.
//
// Candidates are every 1-for-1, 2-for-1 and 1-for-2 swap (no K/DEF). A trade
// qualifies when it is
//   - fair by market value: they get at least FAIR_MIN of what they give up,
//     and you don't overpay by more than FAIR_MAX;
//   - a real upgrade for you: your best-lineup total over the horizon rises by
//     MIN_MY_GAIN_PER_WEEK x weeks (byes and injuries count);
//   - an upgrade for them too (MIN_THEIR_GAIN_PER_WEEK x weeks) — a trade that
//     does nothing for them won't be accepted.
// Two horizons are searched (see tradeIdeasForTeam): NEAR = this week + the
// next two, ROS = rest of season through the league's last week (playoffs
// included). Each idea also carries the other horizon's gains for comparison.
// Padded versions are dropped: if giving a subset of the same players for the
// same return does as well, the extra player is a pure giveaway. And only the
// best offer per return package is kept (biggest gain, then cheapest).
// Ranked by your gain; at most MAX_PER_PARTNER ideas per team.

import { prisma } from "@/lib/db";
import { getNflState, getProjections, getLeague } from "@/lib/sleeper";
import { blendProjections } from "@/lib/projections/consensus";
import { injuryAdjustedProj } from "@/lib/features/injury";
import { starterSlots } from "@/lib/ingest/sleeper-transform";
import { optimizeLineup, type LineupPlayer } from "@/lib/features/startsit";
import type { ProjectionRow } from "@/lib/types";

export interface TfPlayer {
  sleeperId: string;
  name: string;
  position: string;
  value: number; // market value (rest of season)
  projByWeek: number[]; // projection per horizon week (0 = bye/out)
}

export interface TfTeam {
  teamId: string;
  name: string;
  players: TfPlayer[];
}

export interface TradeIdea {
  partnerTeamId: string;
  partnerName: string;
  give: TfPlayer[];
  get: TfPlayer[];
  myGain: number; // horizon lineup points gained by you
  theirGain: number; // horizon lineup points gained by them
  giveValue: number;
  getValue: number;
}

export interface SwapGains {
  myGain: number;
  theirGain: number;
}

export const FAIR_MIN = 0.9; // giveValue >= 0.9 x getValue (they aren't fleeced)
export const FAIR_MAX = 1.25; // giveValue <= 1.25 x getValue (you don't overpay)
// Thresholds scale with the horizon: 3 weeks -> you +1.5, them +1.
export const MIN_MY_GAIN_PER_WEEK = 0.5;
export const MIN_THEIR_GAIN_PER_WEEK = 1 / 3;
const MAX_PER_PARTNER = 2;
const TRADEABLE = new Set(["QB", "RB", "WR", "TE"]);

// Sum of the optimal lineup's projected points over the first `weeks` horizon
// weeks (all of them by default).
export function horizonTotal(players: TfPlayer[], slots: string[], weeks?: number): number {
  const n = weeks ?? Math.max(0, ...players.map((p) => p.projByWeek.length));
  let total = 0;
  for (let k = 0; k < n; k++) {
    const asLineup: LineupPlayer[] = players.map((p) => ({
      sleeperId: p.sleeperId,
      name: p.name,
      position: p.position,
      proj: p.projByWeek[k] ?? 0,
      sources: 1,
    }));
    total += optimizeLineup(asLineup, slots).total;
  }
  return Math.round(total * 100) / 100;
}

const sumValue = (ps: TfPlayer[]) => ps.reduce((s, p) => s + p.value, 0);

function combos(ps: TfPlayer[], size: 1 | 2): TfPlayer[][] {
  if (size === 1) return ps.map((p) => [p]);
  const out: TfPlayer[][] = [];
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) out.push([ps[i], ps[j]]);
  return out;
}

// Both sides' lineup gain from a swap over the first `weeks` horizon weeks.
export function swapGains(
  me: TfTeam,
  other: TfTeam,
  give: TfPlayer[],
  get: TfPlayer[],
  slots: string[],
  weeks: number,
): SwapGains {
  const giveIds = new Set(give.map((p) => p.sleeperId));
  const getIds = new Set(get.map((p) => p.sleeperId));
  const myAfter = [...me.players.filter((p) => !giveIds.has(p.sleeperId)), ...get];
  const theirAfter = [...other.players.filter((p) => !getIds.has(p.sleeperId)), ...give];
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    myGain: r(horizonTotal(myAfter, slots, weeks) - horizonTotal(me.players, slots, weeks)),
    theirGain: r(horizonTotal(theirAfter, slots, weeks) - horizonTotal(other.players, slots, weeks)),
  };
}

export function findTrades(
  me: TfTeam,
  others: TfTeam[],
  slots: string[],
  limit = 5,
  weeks = Math.max(0, ...me.players.map((p) => p.projByWeek.length)),
): TradeIdea[] {
  const minMine = MIN_MY_GAIN_PER_WEEK * weeks;
  const minTheirs = MIN_THEIR_GAIN_PER_WEEK * weeks;
  const myBase = horizonTotal(me.players, slots, weeks);
  const myPool = me.players.filter((p) => TRADEABLE.has(p.position) && p.value > 0);
  const ideas: TradeIdea[] = [];

  for (const other of others) {
    if (other.players.length === 0) continue; // e.g. an eliminated guillotine team
    const theirBase = horizonTotal(other.players, slots, weeks);
    const theirPool = other.players.filter((p) => TRADEABLE.has(p.position) && p.value > 0);
    const found: TradeIdea[] = [];
    for (const [giveN, getN] of [[1, 1], [2, 1], [1, 2]] as const) {
      for (const give of combos(myPool, giveN)) {
        const giveValue = sumValue(give);
        for (const get of combos(theirPool, getN)) {
          const getValue = sumValue(get);
          // Cheap fairness filter before any lineup math.
          if (giveValue < FAIR_MIN * getValue || giveValue > FAIR_MAX * getValue) continue;
          const giveIds = new Set(give.map((p) => p.sleeperId));
          const getIds = new Set(get.map((p) => p.sleeperId));
          const myAfter = [...me.players.filter((p) => !giveIds.has(p.sleeperId)), ...get];
          const myGain = horizonTotal(myAfter, slots, weeks) - myBase;
          if (myGain < minMine) continue;
          const theirAfter = [...other.players.filter((p) => !getIds.has(p.sleeperId)), ...give];
          const theirGain = horizonTotal(theirAfter, slots, weeks) - theirBase;
          if (theirGain < minTheirs - 1e-9) continue;
          found.push({
            partnerTeamId: other.teamId,
            partnerName: other.name,
            give,
            get,
            myGain: Math.round(myGain * 100) / 100,
            theirGain: Math.round(theirGain * 100) / 100,
            giveValue,
            getValue,
          });
        }
      }
    }
    const key = (ps: TfPlayer[]) => ps.map((x) => x.sleeperId).sort().join(",");
    const lean = found.filter(
      (idea) =>
        !found.some(
          (o) =>
            o !== idea &&
            key(o.get) === key(idea.get) &&
            o.give.length < idea.give.length &&
            o.give.every((g) => idea.give.some((x) => x.sleeperId === g.sleeperId)) &&
            o.myGain >= idea.myGain - 0.01,
        ),
    );
    lean.sort((a, b) => b.myGain - a.myGain || a.giveValue - b.giveValue);
    // One offer per return package: the best gain, cheapest on ties.
    const seenGet = new Set<string>();
    const best = lean.filter((idea) => !seenGet.has(key(idea.get)) && seenGet.add(key(idea.get)));
    ideas.push(...best.slice(0, MAX_PER_PARTNER));
  }
  return ideas.sort((a, b) => b.myGain - a.myGain).slice(0, limit);
}

// ---- DB-backed wrapper -------------------------------------------------------

const NEAR_WEEKS = 3;
const DEFAULT_SEASON_END = 17; // fantasy seasons almost never score week 18

// Last fantasy week: the playoff final for H2H leagues (one week per round),
// else week 17.
export function seasonEndWeek(playoffWeekStart: number | undefined, playoffTeams: number | undefined): number {
  if (!playoffWeekStart || !playoffTeams) return DEFAULT_SEASON_END;
  const rounds = Math.ceil(Math.log2(playoffTeams));
  return Math.min(18, playoffWeekStart + rounds - 1);
}

// Future-week Sleeper projections change slowly and are large, so cache them
// in-process for a few hours (the ROS view needs up to ~15 weeks).
const PROJ_TTL_MS = 6 * 60 * 60 * 1000;
const projCache = new Map<string, { at: number; rows: Promise<Map<string, number>> }>();
function cachedProjections(season: number, week: number, ppr: number): Promise<Map<string, number>> {
  const key = `${season}|${week}|${ppr}`;
  const hit = projCache.get(key);
  if (hit && Date.now() - hit.at < PROJ_TTL_MS) return hit.rows;
  const rows = getProjections(season, week, ppr)
    .then((rs) => new Map(rs.map((r) => [r.sleeperId, r.points])))
    .catch(() => {
      projCache.delete(key); // don't cache a failure
      return new Map<string, number>();
    });
  projCache.set(key, { at: Date.now(), rows });
  return rows;
}

export interface HorizonIdeas {
  weeks: number[]; // the NFL weeks this horizon covers
  // Each idea is found + ranked on this horizon; `other` = the same swap's
  // gains on the opposite horizon, for the near-vs-long-term comparison.
  ideas: (TradeIdea & { other: SwapGains })[];
}

export interface TradeIdeasResult {
  near: HorizonIdeas;
  ros: HorizonIdeas;
}

// Trade ideas for one of the user's teams against every other team in its
// league, on two horizons. Projections: this week's consensus (injury-
// adjusted), then Sleeper's weekly projections for every later week.
export async function tradeIdeasForTeam(teamId: string, limit = 5): Promise<TradeIdeasResult> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { league: { include: { teams: { include: { roster: true } } } } },
  });
  const league = team.league;
  const state = await getNflState();
  const week = state.week > 0 ? state.week : 1;
  const settings =
    league.platform === "sleeper" ? (await getLeague(league.externalId).catch(() => null))?.settings : undefined;
  const endWeek = Math.max(week, seasonEndWeek(settings?.playoff_week_start, settings?.playoff_teams));
  const rosWeeks = Array.from({ length: endWeek - week + 1 }, (_, k) => week + k);

  const ids = [
    ...new Set(league.teams.flatMap((t) => t.roster.map((r) => r.sleeperId).filter((x): x is string => !!x))),
  ];
  const [players, values, projRows, ...future] = await Promise.all([
    prisma.player.findMany({ where: { sleeperId: { in: ids } } }),
    prisma.tradeValue.findMany({
      where: { sleeperId: { in: ids }, isDynasty: false, ppr: league.ppr, numQbs: league.numQbs, numTeams: league.numTeams },
    }),
    prisma.projection.findMany({ where: { sleeperId: { in: ids }, season: league.season, week } }),
    ...rosWeeks.slice(1).map((w) => cachedProjections(league.season, w, league.ppr)),
  ]);
  const byId = new Map(players.map((p) => [p.sleeperId, p]));
  const valueById = new Map(values.map((v) => [v.sleeperId, v.value]));
  const consensus = blendProjections(projRows as unknown as ProjectionRow[]);

  const toTeam = (t: (typeof league.teams)[number]): TfTeam => ({
    teamId: t.id,
    name: t.name,
    players: t.roster
      .filter((r) => r.sleeperId && byId.has(r.sleeperId))
      .map((r) => {
        const p = byId.get(r.sleeperId!)!;
        return {
          sleeperId: p.sleeperId,
          name: p.name,
          position: p.position,
          value: valueById.get(p.sleeperId) ?? 0,
          projByWeek: [
            injuryAdjustedProj(consensus.get(p.sleeperId)?.points ?? 0, p.injuryStatus),
            ...future.map((m) => m.get(p.sleeperId) ?? 0),
          ],
        };
      }),
  });

  const slots = starterSlots((league.rosterPositions as string[]) ?? []);
  const me = toTeam(league.teams.find((t) => t.id === teamId)!);
  const others = league.teams.filter((t) => t.id !== teamId).map(toTeam);
  const partnerOf = new Map(others.map((o) => [o.teamId, o]));
  const nearN = Math.min(NEAR_WEEKS, rosWeeks.length);
  const rosN = rosWeeks.length;

  const annotate = (ideas: TradeIdea[], otherWeeks: number) =>
    ideas.map((i) => ({ ...i, other: swapGains(me, partnerOf.get(i.partnerTeamId)!, i.give, i.get, slots, otherWeeks) }));

  return {
    near: { weeks: rosWeeks.slice(0, nearN), ideas: annotate(findTrades(me, others, slots, limit, nearN), rosN) },
    ros: { weeks: rosWeeks, ideas: annotate(findTrades(me, others, slots, limit, rosN), nearN) },
  };
}
