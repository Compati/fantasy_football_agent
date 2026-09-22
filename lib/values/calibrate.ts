// Calibrates a projection -> trade-value mapping against FantasyCalc's own
// scale, so players outside FantasyCalc's ~200-deep ranked set still get a
// value on the same axis. Redraft value vs weekly projection is roughly a
// power law within a position (value ≈ a·projᵇ), and fitting per position lets
// positional scarcity fall out of the market data itself (a 15-pt RB is worth
// more than a 15-pt QB in a 1QB league, etc.). Pure + unit-tested.

export interface ValueModel {
  a: number; // intercept of ln(value) = a + b·ln(proj)
  b: number; // slope (elasticity)
  n: number; // fitted points
}

export interface CalibrationPoint {
  position: string;
  proj: number;
  value: number;
}

const MIN_PROJ = 1; // ignore near-zero projections (unstable in log space)
const MIN_FIT_POINTS = 4; // below this, a per-position fit isn't trustworthy

// Ordinary least squares of ln(value) on ln(proj). Returns null if there aren't
// enough usable points or the projections carry no spread.
export function fitPowerLaw(points: { proj: number; value: number }[]): ValueModel | null {
  const usable = points.filter((p) => p.proj >= MIN_PROJ && p.value > 0);
  if (usable.length < MIN_FIT_POINTS) return null;

  const xs = usable.map((p) => Math.log(p.proj));
  const ys = usable.map((p) => Math.log(p.value));
  const n = usable.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - meanX) ** 2;
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
  }
  if (sxx === 0) return null; // all projections identical — no gradient to fit
  const b = sxy / sxx;
  const a = meanY - b * meanX;
  return { a, b, n };
}

// Apply a fitted model. Values are clamped to a sane floor so a deep player is
// worth a little, never zero, and never negative.
export function predictValue(model: ValueModel, proj: number): number {
  if (proj < MIN_PROJ) return 1;
  const v = Math.exp(model.a + model.b * Math.log(proj));
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.round(v));
}

// Fit one model per position plus a global fallback (for positions with too few
// FantasyCalc-covered players to fit on their own — e.g. a thin TE market).
export function fitValueModels(points: CalibrationPoint[]): {
  byPosition: Map<string, ValueModel>;
  global: ValueModel | null;
} {
  const byPos = new Map<string, { proj: number; value: number }[]>();
  for (const p of points) {
    const arr = byPos.get(p.position) ?? [];
    arr.push({ proj: p.proj, value: p.value });
    byPos.set(p.position, arr);
  }
  const byPosition = new Map<string, ValueModel>();
  for (const [pos, arr] of byPos) {
    const m = fitPowerLaw(arr);
    if (m) byPosition.set(pos, m);
  }
  const global = fitPowerLaw(points.map((p) => ({ proj: p.proj, value: p.value })));
  return { byPosition, global };
}

// Best available model for a position: its own fit, else the global fallback.
export function modelFor(
  models: { byPosition: Map<string, ValueModel>; global: ValueModel | null },
  position: string,
): ValueModel | null {
  return models.byPosition.get(position) ?? models.global;
}
