// Start/sit engine. Pure optimizer (unit-tested) + a DB-backed wrapper that
// pulls the team's consensus projections and compares the optimal lineup to the
// currently-set one.

import { prisma } from "@/lib/db";
import { getNflState } from "@/lib/sleeper";
import { blendProjections } from "@/lib/projections/consensus";
import { starterSlots } from "@/lib/ingest/sleeper-transform";
import { isEligible, slotRestrictiveness } from "@/lib/features/eligibility";
import { playerDetailMap } from "@/lib/players";
import type { ProjectionRow } from "@/lib/types";

// Designations that mean the player won't play — the optimizer must not start
// them. Questionable is a flag only (still projectable).
export const UNAVAILABLE_STATUS = new Set(["Out", "Doubtful", "IR", "PUP", "Sus", "NA", "DNR", "COV"]);

export interface LineupPlayer {
  sleeperId: string;
  name: string;
  position: string;
  proj: number; // consensus projection (0 if unavailable)
  sources: number; // how many projection sources backed it
  injuryStatus?: string | null;
}

export interface SlotAssignment {
  slot: string;
  player: LineupPlayer | null; // null = no eligible player available
}

// Greedy optimal assignment: fill the most restrictive slots first, each with
// the highest-projected still-available eligible player.
export function optimizeLineup(
  players: LineupPlayer[],
  slots: string[],
): { lineup: SlotAssignment[]; total: number; starterIds: Set<string> } {
  const order = slots
    .map((slot, idx) => ({ slot, idx }))
    .sort((a, b) => slotRestrictiveness(a.slot) - slotRestrictiveness(b.slot));

  const used = new Set<string>();
  const bySlotIndex = new Map<number, LineupPlayer>();

  for (const { slot, idx } of order) {
    let best: LineupPlayer | null = null;
    for (const p of players) {
      if (used.has(p.sleeperId)) continue;
      if (!isEligible(slot, p.position)) continue;
      if (!best || p.proj > best.proj) best = p;
    }
    if (best) {
      used.add(best.sleeperId);
      bySlotIndex.set(idx, best);
    }
  }

  const lineup: SlotAssignment[] = slots.map((slot, idx) => ({
    slot,
    player: bySlotIndex.get(idx) ?? null,
  }));
  const total = [...bySlotIndex.values()].reduce((s, p) => s + p.proj, 0);
  return { lineup, total, starterIds: used };
}

export interface StartSitResult {
  season: number;
  week: number;
  optimalTotal: number;
  currentTotal: number;
  delta: number; // points left on the bench (optimal - current)
  lineup: SlotAssignment[]; // recommended optimal lineup
  start: LineupPlayer[]; // move these into the lineup
  sit: LineupPlayer[]; // move these to the bench
  closeCalls: { starter: LineupPlayer; alternative: LineupPlayer; gap: number }[];
  injuryAlerts: { player: string; status: string; starting: boolean }[]; // rostered players with a designation
}

const CLOSE_CALL_GAP = 1.5;

export async function startSitForTeam(
  teamId: string,
  week?: number,
): Promise<StartSitResult> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { league: true, roster: true },
  });
  const state = await getNflState();
  const season = team.league.season;
  const w = week ?? (state.week > 0 ? state.week : 1);

  const slots = starterSlots((team.league.rosterPositions as string[]) ?? []);

  // Consensus projection for each rostered player that maps to a canonical id.
  const rostered = team.roster.filter((r) => r.sleeperId);
  const ids = rostered.map((r) => r.sleeperId as string);
  const [projRows, detail] = await Promise.all([
    prisma.projection.findMany({ where: { sleeperId: { in: ids }, season, week: w } }),
    playerDetailMap(ids),
  ]);
  const consensus = blendProjections(projRows as unknown as ProjectionRow[]);

  const players: LineupPlayer[] = rostered.map((r) => {
    const id = r.sleeperId as string;
    const c = consensus.get(id);
    const injuryStatus = detail.get(id)?.injuryStatus ?? null;
    const unavailable = !!injuryStatus && UNAVAILABLE_STATUS.has(injuryStatus);
    return {
      sleeperId: id,
      name: r.name,
      position: r.position,
      // A ruled-out player projects 0 so the optimizer benches them for an
      // available option (which then shows up as a start/sit swap).
      proj: unavailable ? 0 : c?.points ?? 0,
      sources: c?.n ?? 0,
      injuryStatus,
    };
  });
  const byId = new Map(players.map((p) => [p.sleeperId, p]));

  const { lineup, total: optimalTotal, starterIds: optimalIds } = optimizeLineup(players, slots);

  const currentStarterIds = new Set(
    team.roster.filter((r) => r.starter && r.sleeperId).map((r) => r.sleeperId as string),
  );
  const currentTotal = [...currentStarterIds].reduce((s, id) => s + (byId.get(id)?.proj ?? 0), 0);

  const start = [...optimalIds].filter((id) => !currentStarterIds.has(id)).map((id) => byId.get(id)!);
  const sit = [...currentStarterIds].filter((id) => !optimalIds.has(id)).map((id) => byId.get(id)!).filter(Boolean);

  // Close calls: a benched player within CLOSE_CALL_GAP of a chosen starter it
  // could replace (same eligibility on that slot).
  const benched = players.filter((p) => !optimalIds.has(p.sleeperId));
  const closeCalls: StartSitResult["closeCalls"] = [];
  for (const a of lineup) {
    if (!a.player) continue;
    for (const b of benched) {
      if (!isEligible(a.slot, b.position)) continue;
      const gap = a.player.proj - b.proj;
      if (gap >= 0 && gap < CLOSE_CALL_GAP) {
        closeCalls.push({ starter: a.player, alternative: b, gap: Math.round(gap * 100) / 100 });
      }
    }
  }

  const injuryAlerts = rostered
    .map((r) => {
      const status = detail.get(r.sleeperId as string)?.injuryStatus;
      return status ? { player: r.name, status, starting: r.starter } : null;
    })
    .filter((a): a is { player: string; status: string; starting: boolean } => a !== null)
    // Starters first, then by severity-ish (Out before Questionable).
    .sort((a, b) => Number(b.starting) - Number(a.starting));

  return {
    season,
    week: w,
    optimalTotal: Math.round(optimalTotal * 100) / 100,
    currentTotal: Math.round(currentTotal * 100) / 100,
    delta: Math.round((optimalTotal - currentTotal) * 100) / 100,
    lineup,
    start,
    sit,
    closeCalls,
    injuryAlerts,
  };
}
