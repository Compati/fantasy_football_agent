// Blend multiple projection sources into one consensus number per player. This
// is the value start/sit and waivers actually use — no single feed is
// authoritative, so we combine them and drop obvious outliers.

import type { ProjectionRow } from "@/lib/types";

export interface Consensus {
  sleeperId: string;
  points: number; // blended projection
  n: number; // number of sources
  sources: string[];
  spread: number; // max - min across sources (disagreement signal)
}

function trimmedMean(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length <= 2) {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  // Drop one min and one max, average the rest.
  const sorted = [...values].sort((a, b) => a - b);
  const kept = sorted.slice(1, -1);
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

// Group rows by player, then blend. Rows are assumed to be for one season/week.
export function blendProjections(rows: ProjectionRow[]): Map<string, Consensus> {
  const byPlayer = new Map<string, ProjectionRow[]>();
  for (const r of rows) {
    const arr = byPlayer.get(r.sleeperId);
    if (arr) arr.push(r);
    else byPlayer.set(r.sleeperId, [r]);
  }

  const out = new Map<string, Consensus>();
  for (const [sleeperId, group] of byPlayer) {
    const values = group.map((g) => g.points);
    const points = Math.round(trimmedMean(values) * 100) / 100;
    out.set(sleeperId, {
      sleeperId,
      points,
      n: group.length,
      sources: group.map((g) => g.source),
      spread: Math.round((Math.max(...values) - Math.min(...values)) * 100) / 100,
    });
  }
  return out;
}

// Rescale one source's rows for a set of players onto a reference source's
// scale, using the median ratio over players both sources project. Used for
// DEF, where each site's scoring differs (ESPN's D/ST runs ~0.8x Sleeper's)
// but its *ranking* is still a useful second opinion. Needs a handful of
// overlapping players to trust the ratio; otherwise returns rows unchanged.
export function scaleToReference(
  rows: ProjectionRow[],
  reference: ProjectionRow[],
  ids: Set<string>,
  minOverlap = 8,
): ProjectionRow[] {
  const ref = new Map(reference.map((r) => [r.sleeperId, r.points]));
  const ratios: number[] = [];
  for (const r of rows) {
    const base = ref.get(r.sleeperId);
    if (ids.has(r.sleeperId) && base && base > 0 && r.points > 0) ratios.push(base / r.points);
  }
  if (ratios.length < minOverlap) return rows;
  ratios.sort((a, b) => a - b);
  const factor = ratios[Math.floor(ratios.length / 2)];
  return rows.map((r) =>
    ids.has(r.sleeperId) ? { ...r, points: Math.round(r.points * factor * 100) / 100 } : r,
  );
}
