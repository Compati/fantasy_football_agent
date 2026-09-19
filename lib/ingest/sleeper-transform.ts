// Pure transforms from Sleeper's API shapes into our normalized rows. No DB, no
// network — unit-tested directly (tests/sleeper-transform.test.ts).

import type { SleeperLeague, SleeperRoster } from "@/lib/sleeper";
import type { PlayerDetail } from "@/lib/players";

const BENCH_SLOTS = new Set(["BN", "TAXI", "IR"]);
const EMPTY_STARTER = new Set(["0", "", null as unknown as string]);

export interface NormalizedLeague {
  ppr: number;
  numTeams: number;
  numQbs: number;
  faabBudget: number | null;
  rosterPositions: string[];
}

export function parseLeagueSettings(league: SleeperLeague): NormalizedLeague {
  const rec = league.scoring_settings?.rec ?? 0;
  const ppr = rec >= 1 ? 1 : rec >= 0.5 ? 0.5 : 0;
  const positions = league.roster_positions ?? [];
  // Superflex (a QB-eligible flex) makes QBs roughly twice as valuable — this is
  // FantasyCalc's numQbs=2 case.
  const numQbs = positions.includes("SUPER_FLEX") ? 2 : 1;
  // waiver_type 2 == FAAB; budget lives in settings.waiver_budget.
  const faab = league.settings?.waiver_budget;
  return {
    ppr,
    numTeams: league.total_rosters ?? positions.length ?? 12,
    numQbs,
    faabBudget: typeof faab === "number" ? faab : null,
    rosterPositions: positions,
  };
}

// The ordered starting-lineup slots (roster_positions minus bench/IR/taxi).
export function starterSlots(rosterPositions: string[]): string[] {
  return rosterPositions.filter((p) => !BENCH_SLOTS.has(p));
}

export interface NormalizedSpot {
  sleeperId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  slot: string;
  starter: boolean;
}

// Build roster spots. `starters` aligns positionally to the starting slots;
// everyone else on `players` is bench. Details come from the canonical map.
export function rosterToSpots(
  roster: SleeperRoster,
  slots: string[],
  detail: Map<string, PlayerDetail>,
): NormalizedSpot[] {
  const spots: NormalizedSpot[] = [];
  const starters = roster.starters ?? [];
  const startersSet = new Set(starters.filter((id) => !EMPTY_STARTER.has(id)));

  starters.forEach((id, i) => {
    if (EMPTY_STARTER.has(id)) return; // unfilled slot
    const d = detail.get(id);
    spots.push({
      sleeperId: id,
      name: d?.name ?? id,
      position: d?.position ?? "?",
      nflTeam: d?.nflTeam ?? null,
      slot: slots[i] ?? "FLEX",
      starter: true,
    });
  });

  for (const id of roster.players ?? []) {
    if (startersSet.has(id)) continue;
    const d = detail.get(id);
    spots.push({
      sleeperId: id,
      name: d?.name ?? id,
      position: d?.position ?? "?",
      nflTeam: d?.nflTeam ?? null,
      slot: "BN",
      starter: false,
    });
  }
  return spots;
}
