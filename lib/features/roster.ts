// Roster outlook: upcoming bye-week crunches and thin starting positions.
// Answers "which week am I short a startable body, and where is my roster thin
// right now?" using the NFL schedule (for byes) and the league's starting slots.
// Pure cores are unit-tested; the DB wrapper wires in the roster + schedule.

import { prisma } from "@/lib/db";
import { getNflState, getSchedule, type SleeperGame } from "@/lib/sleeper";
import { starterSlots } from "@/lib/ingest/sleeper-transform";
import { slotEligiblePositions } from "@/lib/features/eligibility";
import { optimizeLineup, type LineupPlayer } from "@/lib/features/startsit";

const LAST_REGULAR_WEEK = 18;

export interface RosterPlayer {
  name: string;
  position: string;
  nflTeam: string | null;
}

export interface ByeWeekOutlook {
  week: number;
  playersOnBye: { name: string; position: string }[];
  unfilledSlots: string[]; // starting slots that can't be filled that week
}

export interface ThinPosition {
  position: string;
  have: number; // rostered at this position
  dedicatedStarters: number; // slots that ONLY accept this position
}

export interface RosterOutlook {
  currentWeek: number;
  byes: ByeWeekOutlook[]; // future weeks with >=1 rostered player on bye
  nextByeCrunch: ByeWeekOutlook | null; // soonest future week that leaves a slot unfilled
  thinPositions: ThinPosition[]; // positions with no bench body behind the starters
}

// team -> its bye week, derived from the schedule (the week it plays no game).
export function byeWeekByTeam(games: SleeperGame[]): Map<string, number> {
  const played = new Map<string, Set<number>>();
  const teams = new Set<string>();
  for (const g of games) {
    teams.add(g.home);
    teams.add(g.away);
    for (const t of [g.home, g.away]) {
      const s = played.get(t) ?? new Set<number>();
      s.add(g.week);
      played.set(t, s);
    }
  }
  const maxWeek = games.reduce((m, g) => Math.max(m, g.week), 0) || LAST_REGULAR_WEEK;
  const byes = new Map<string, number>();
  for (const t of teams) {
    const weeks = played.get(t)!;
    for (let w = 1; w <= maxWeek; w++) {
      if (!weeks.has(w)) {
        byes.set(t, w);
        break; // first (and normally only) bye
      }
    }
  }
  return byes;
}

// Can the not-on-bye players still fill every starting slot? Uses the real
// optimizer with equal projections — we only care about fillability here, so
// any leftover null slot is a genuine structural hole for that week.
function unfilledSlotsFor(available: RosterPlayer[], slots: string[]): string[] {
  const players: LineupPlayer[] = available.map((p, i) => ({
    sleeperId: `${i}`,
    name: p.name,
    position: p.position,
    proj: 1,
    sources: 1,
  }));
  const { lineup } = optimizeLineup(players, slots);
  return lineup.filter((a) => a.player === null).map((a) => a.slot);
}

// Bye outlook for future weeks: who's off, and which slots that leaves unfilled.
export function computeByeOutlook(
  roster: RosterPlayer[],
  slots: string[],
  byeByTeam: Map<string, number>,
  currentWeek: number,
): ByeWeekOutlook[] {
  const out: ByeWeekOutlook[] = [];
  for (let w = currentWeek; w <= LAST_REGULAR_WEEK; w++) {
    const onBye = roster.filter((p) => p.nflTeam != null && byeByTeam.get(p.nflTeam) === w);
    if (onBye.length === 0) continue;
    const available = roster.filter((p) => !(p.nflTeam != null && byeByTeam.get(p.nflTeam) === w));
    out.push({
      week: w,
      playersOnBye: onBye.map((p) => ({ name: p.name, position: p.position })),
      unfilledSlots: unfilledSlotsFor(available, slots),
    });
  }
  return out;
}

// Positions with no bench body behind the dedicated starting slots. A slot is
// "dedicated" to a position when that position is the only thing it accepts, so
// FLEX/SUPER_FLEX don't inflate any single position's need.
export function computeThinPositions(roster: RosterPlayer[], slots: string[]): ThinPosition[] {
  const BASE = ["QB", "RB", "WR", "TE"];
  const dedicated = new Map<string, number>();
  for (const slot of slots) {
    const elig = slotEligiblePositions(slot);
    if (elig.length === 1 && BASE.includes(elig[0])) {
      dedicated.set(elig[0], (dedicated.get(elig[0]) ?? 0) + 1);
    }
  }
  const have = new Map<string, number>();
  for (const p of roster) have.set(p.position, (have.get(p.position) ?? 0) + 1);

  const thin: ThinPosition[] = [];
  for (const pos of BASE) {
    const need = dedicated.get(pos) ?? 0;
    if (need === 0) continue;
    const count = have.get(pos) ?? 0;
    if (count <= need) thin.push({ position: pos, have: count, dedicatedStarters: need });
  }
  return thin;
}

export async function rosterOutlook(teamId: string, week?: number): Promise<RosterOutlook> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { league: true, roster: true },
  });
  const state = await getNflState();
  const currentWeek = week ?? (state.week > 0 ? state.week : 1);
  const season = team.league.season;

  const slots = starterSlots((team.league.rosterPositions as string[]) ?? []);
  const roster: RosterPlayer[] = team.roster
    .filter((r) => r.slot !== "IR") // IR players aren't part of the active outlook
    .map((r) => ({ name: r.name, position: r.position, nflTeam: r.nflTeam }));

  const games = await getSchedule(season).catch(() => [] as SleeperGame[]);
  const byeByTeam = byeWeekByTeam(games);

  const byes = computeByeOutlook(roster, slots, byeByTeam, currentWeek);
  const nextByeCrunch = byes.find((b) => b.unfilledSlots.length > 0) ?? null;
  const thinPositions = computeThinPositions(roster, slots);

  return { currentWeek, byes, nextByeCrunch, thinPositions };
}
