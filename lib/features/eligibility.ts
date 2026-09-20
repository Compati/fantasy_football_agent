// Which roster positions may fill which lineup slot. Fantasy slots are nested
// (a specific position ⊂ FLEX ⊂ SUPER_FLEX), which is what makes the greedy
// start/sit optimizer optimal.

const ELIGIBLE: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  WRRB: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  WRTE_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  IDP_FLEX: ["DL", "LB", "DB", "IDP"],
};

export function slotEligiblePositions(slot: string): string[] {
  return ELIGIBLE[slot] ?? [slot];
}

export function isEligible(slot: string, position: string): boolean {
  return slotEligiblePositions(slot).includes(position);
}

// Restrictiveness = how few positions a slot accepts. Assigning the most
// restrictive slots first is what keeps the greedy lineup optimal.
export function slotRestrictiveness(slot: string): number {
  return slotEligiblePositions(slot).length;
}
