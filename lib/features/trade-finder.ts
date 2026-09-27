// Trade finder: concrete, proposable trades between you and each other team in
// the league. Pure core (unit-tested) + a DB wrapper below.
//
// Candidates are every 1-for-1, 2-for-1 and 1-for-2 swap (no K/DEF). A trade
// qualifies when it is
//   - fair by market value: they get at least FAIR_MIN of what they give up,
//     and you don't overpay by more than FAIR_MAX;
//   - a real upgrade for you: your best-lineup total over the horizon (this
//     week + the next two, so byes and injuries count) rises by MIN_MY_GAIN;
//   - an upgrade for them too (their horizon lineup total rises by at least
//     MIN_THEIR_GAIN) — a trade that does nothing for them won't be accepted.
// Padded versions are dropped: if giving a subset of the same players for the
// same return does as well, the extra player is a pure giveaway. And only the
// best offer per return package is kept (biggest gain, then cheapest).
// Ranked by your gain; at most MAX_PER_PARTNER ideas per team.

import { prisma } from "@/lib/db";
import { getNflState, getProjections } from "@/lib/sleeper";
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

export const FAIR_MIN = 0.9; // giveValue >= 0.9 x getValue (they aren't fleeced)
export const FAIR_MAX = 1.25; // giveValue <= 1.25 x getValue (you don't overpay)
export const MIN_MY_GAIN = 1.5; // horizon points
export const MIN_THEIR_GAIN = 1; // horizon points
const MAX_PER_PARTNER = 2;
const TRADEABLE = new Set(["QB", "RB", "WR", "TE"]);

// Sum of the optimal lineup's projected points over every horizon week.
export function horizonTotal(players: TfPlayer[], slots: string[]): number {
  const weeks = Math.max(0, ...players.map((p) => p.projByWeek.length));
  let total = 0;
  for (let k = 0; k < weeks; k++) {
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

export function findTrades(me: TfTeam, others: TfTeam[], slots: string[], limit = 5): TradeIdea[] {
  const myBase = horizonTotal(me.players, slots);
  const myPool = me.players.filter((p) => TRADEABLE.has(p.position) && p.value > 0);
  const ideas: TradeIdea[] = [];

  for (const other of others) {
    if (other.players.length === 0) continue; // e.g. an eliminated guillotine team
    const theirBase = horizonTotal(other.players, slots);
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
          const myGain = horizonTotal(myAfter, slots) - myBase;
          if (myGain < MIN_MY_GAIN) continue;
          const theirAfter = [...other.players.filter((p) => !getIds.has(p.sleeperId)), ...give];
          const theirGain = horizonTotal(theirAfter, slots) - theirBase;
          if (theirGain < MIN_THEIR_GAIN) continue;
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

const HORIZON_WEEKS = 3;

// Trade ideas for one of the user's teams against every other team in its
// league. Horizon: this week's consensus (injury-adjusted) + Sleeper's
// projections for the next two weeks.
export async function tradeIdeasForTeam(teamId: string, limit = 5): Promise<{ ideas: TradeIdea[]; horizon: number[] }> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { league: { include: { teams: { include: { roster: true } } } } },
  });
  const league = team.league;
  const state = await getNflState();
  const week = state.week > 0 ? state.week : 1;
  const horizon = Array.from({ length: HORIZON_WEEKS }, (_, k) => week + k).filter((w) => w <= 18);

  const ids = [...new Set(league.teams.flatMap((t) => t.roster.map((r) => r.sleeperId).filter((x): x is string => !!x)))];
  const [players, values, projRows, ...future] = await Promise.all([
    prisma.player.findMany({ where: { sleeperId: { in: ids } } }),
    prisma.tradeValue.findMany({
      where: { sleeperId: { in: ids }, isDynasty: false, ppr: league.ppr, numQbs: league.numQbs, numTeams: league.numTeams },
    }),
    prisma.projection.findMany({ where: { sleeperId: { in: ids }, season: league.season, week } }),
    ...horizon.slice(1).map((w) => getProjections(league.season, w, league.ppr).catch(() => [] as ProjectionRow[])),
  ]);
  const byId = new Map(players.map((p) => [p.sleeperId, p]));
  const valueById = new Map(values.map((v) => [v.sleeperId, v.value]));
  const consensus = blendProjections(projRows as unknown as ProjectionRow[]);
  const futureMaps = future.map((rows) => new Map(rows.map((r) => [r.sleeperId, r.points])));

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
            ...futureMaps.map((m) => m.get(p.sleeperId) ?? 0),
          ],
        };
      }),
  });

  const slots = starterSlots((league.rosterPositions as string[]) ?? []);
  const me = toTeam(league.teams.find((t) => t.id === teamId)!);
  const others = league.teams.filter((t) => t.id !== teamId).map(toTeam);
  return { ideas: findTrades(me, others, slots, limit), horizon };
}
