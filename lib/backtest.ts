// Pure scoring helpers for scripts/backtest.ts — how well projections, the
// matchup tiebreaker, and FAAB ranges would have done against real results.

export function mae(pairs: { proj: number; actual: number }[]): number {
  if (pairs.length === 0) return NaN;
  return pairs.reduce((s, p) => s + Math.abs(p.proj - p.actual), 0) / pairs.length;
}

// Start/sit is a ranking decision: of every pair of same-position players, how
// often did the higher projection actually score more? Exact ties in either
// projection or result are skipped. maxGap limits to close calls.
export function pairwiseAccuracy(
  players: { position: string; proj: number; actual: number }[],
  maxGap = Infinity,
): { correct: number; total: number; rate: number } {
  let correct = 0;
  let total = 0;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      if (a.position !== b.position) continue;
      const gap = Math.abs(a.proj - b.proj);
      if (gap === 0 || gap >= maxGap || a.actual === b.actual) continue;
      total++;
      if (a.proj > b.proj === a.actual > b.actual) correct++;
    }
  }
  return { correct, total, rate: total ? correct / total : NaN };
}

// FAAB: a bid wins a past claim only if it beats every bid placed on that
// player that week (ties lose — waiver priority is unknown).
export function wouldWin(bid: number, allBids: number[]): boolean {
  return allBids.every((b) => bid > b);
}
