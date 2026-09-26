// FAAB bid ranges calibrated on what each league actually pays. Pure + tested;
// the claim history comes from lib/ingest/waiver-history.ts.
//
// Every claim (won and lost) is tiered by player quality, and winning bids are
// expressed as % of the league's STARTING budget (how leagues price players,
// independent of what any one manager has left). For a waiver target:
//   low  = median winning bid in its tier  -> the going rate ("nice to have")
//   high = 80th-percentile winning bid     -> beats nearly every comparable claim
//                                             ("I need him in my lineup this week")
// p80 not p90: with samples this small the top decile is one-off overpays
// (hype rookies, handcuff panic), not what it takes to win a normal claim.
// A league with fewer than MIN_SAMPLES claims in a tier borrows pooled prices:
// every sample is first divided by its own league's spend factor (so a spendy
// league's bids don't inflate a frugal league's range), then the pooled
// percentiles are scaled back up by the target league's factor. No history at
// all -> conservative defaults.

export type FaabTier = "impact" | "starter" | "flex" | "depth" | "dst_k";

const TIER_ORDER: FaabTier[] = ["depth", "flex", "starter", "impact"];

// Pick the higher of a market-value tier (rest-of-season worth) and a
// projection tier (this week's usefulness). QBs in 1-QB leagues are shifted
// down: a 15-pt streaming QB is a bye fill there, not a difference maker.
export function faabTier(position: string, proj: number, value: number, numQbs: number): FaabTier {
  if (position === "DEF" || position === "K") return "dst_k";
  const byValue: FaabTier = value >= 2000 ? "impact" : value >= 800 ? "starter" : value >= 300 ? "flex" : "depth";
  const eff = position === "QB" && numQbs < 2 ? proj - 4 : proj;
  const byProj: FaabTier = eff >= 15 ? "impact" : eff >= 11 ? "starter" : eff >= 7 ? "flex" : "depth";
  return TIER_ORDER[Math.max(TIER_ORDER.indexOf(byValue), TIER_ORDER.indexOf(byProj))];
}

export interface ClaimSample {
  leagueId: string;
  tier: FaabTier;
  pct: number; // winning bid as % of the league's starting budget
}

// % of starting budget, used only when there is no history at all.
const DEFAULT_PCT: Record<FaabTier, { low: number; high: number }> = {
  impact: { low: 15, high: 35 },
  starter: { low: 4, high: 12 },
  flex: { low: 1, high: 5 },
  depth: { low: 0, high: 2 },
  dst_k: { low: 0, high: 1 },
};

export const MIN_SAMPLES = 3;
const HIGH_PERCENTILE = 0.8;

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

// How much a league pays vs the pool for the same tier (median ratio), so thin
// tiers can borrow pooled prices at the league's own price level. Clamped so a
// couple of odd bids can't swing it wildly.
export function leagueSpendFactor(leagueId: string, samples: ClaimSample[]): number {
  const pooledMedian = new Map<FaabTier, number>();
  for (const t of [...TIER_ORDER, "dst_k"] as FaabTier[]) {
    pooledMedian.set(t, percentile(samples.filter((s) => s.tier === t).map((s) => s.pct), 0.5));
  }
  const ratios = samples
    .filter((s) => s.leagueId === leagueId && (pooledMedian.get(s.tier) ?? 0) > 0)
    .map((s) => s.pct / pooledMedian.get(s.tier)!);
  if (ratios.length < MIN_SAMPLES) return 1;
  return Math.min(3, Math.max(1 / 3, percentile(ratios, 0.5)));
}

export interface FaabRange {
  tier: FaabTier;
  low: number; // dollars
  high: number; // dollars
  basis: "league" | "pooled" | "default";
  samples: number; // comparable winning claims behind the range
}

interface TierPrice {
  lowPct: number;
  highPct: number;
  basis: FaabRange["basis"];
  n: number;
}

// One tier's price in % of starting budget, before tier ordering is enforced.
function tierPrice(tier: FaabTier, leagueId: string, samples: ClaimSample[]): TierPrice {
  const own = samples.filter((s) => s.leagueId === leagueId && s.tier === tier).map((s) => s.pct);
  if (own.length >= MIN_SAMPLES) {
    return { lowPct: percentile(own, 0.5), highPct: percentile(own, HIGH_PERCENTILE), basis: "league", n: own.length };
  }
  const pooled = samples.filter((s) => s.tier === tier);
  if (pooled.length >= MIN_SAMPLES) {
    const factors = new Map<string, number>();
    const factorOf = (id: string) => {
      if (!factors.has(id)) factors.set(id, leagueSpendFactor(id, samples));
      return factors.get(id)!;
    };
    const normalized = pooled.map((x) => x.pct / factorOf(x.leagueId));
    const f = factorOf(leagueId);
    return {
      lowPct: percentile(normalized, 0.5) * f,
      highPct: percentile(normalized, HIGH_PERCENTILE) * f,
      basis: "pooled",
      n: pooled.length,
    };
  }
  return { lowPct: DEFAULT_PCT[tier].low, highPct: DEFAULT_PCT[tier].high, basis: "default", n: 0 };
}

export function faabRange(
  tier: FaabTier,
  leagueId: string,
  samples: ClaimSample[],
  startingBudget: number,
  remainingBudget: number | null,
): FaabRange {
  const own = tierPrice(tier, leagueId, samples);
  let { lowPct } = own;
  const { highPct } = own;
  // A better tier's going rate never sits below a worse tier's (thin samples can
  // invert them). Only the median is carried up: the high ends are noisy, and
  // carrying them would spread one tier's outliers (e.g. handcuff panic buys
  // at 20% of budget) into every tier above it.
  if (tier !== "dst_k") {
    for (const lower of TIER_ORDER.slice(0, TIER_ORDER.indexOf(tier))) {
      lowPct = Math.max(lowPct, tierPrice(lower, leagueId, samples).lowPct);
    }
  }

  const cap = remainingBudget ?? startingBudget;
  const low = Math.min(cap, Math.round((startingBudget * lowPct) / 100));
  const high = Math.min(cap, Math.max(low + 1, Math.round((startingBudget * highPct) / 100)));
  return { tier, low, high, basis: own.basis, samples: own.n };
}

// How badly you need him this week, from his projection vs the weakest starter
// he'd replace in your optimal lineup (null = no eligible slot at all).
export type FaabNeed = "starts" | "marginal" | "depth";
export const CLEAR_UPGRADE_PTS = 3;

export function faabNeed(proj: number, weakestStarter: number | null): FaabNeed {
  if (weakestStarter == null) return "depth";
  const upgrade = proj - weakestStarter;
  if (upgrade >= CLEAR_UPGRADE_PTS) return "starts";
  if (upgrade > 0) return "marginal";
  return "depth";
}

// starts -> high end, marginal -> midpoint, depth -> low end.
export function bidForNeed(range: { low: number; high: number }, need: FaabNeed): number {
  if (need === "starts") return range.high;
  if (need === "marginal") return Math.round((range.low + range.high) / 2);
  return range.low;
}
