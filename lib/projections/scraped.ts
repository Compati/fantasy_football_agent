// Shared plumbing for the HTML-scraped projection sources (CBS, FFToday).
// Neither carries a Sleeper/ESPN id, so each page row is a (name, position,
// team, points) tuple that the ingest resolves to a canonical sleeperId.

import type { ProjectionRow, ProjectionSource } from "@/lib/types";
import { teamAbbr } from "@/lib/teams";

export interface ScrapedProjection {
  name: string; // display name as the site prints it
  position: string; // our abbrev: QB/RB/WR/TE/K/DEF
  team: string | null; // Sleeper-style abbrev (JAX, WAS...) when known
  points: number;
}

export type ScrapedResolver = (p: ScrapedProjection) => string | null;

export interface ScrapedResult {
  rows: ProjectionRow[];
  fetched: number;
  unresolved: number;
}

// Strip tags, decode the handful of entities these pages use, collapse space.
export function cellText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function normTeam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return teamAbbr(raw.trim()) ?? null;
}

// CBS and FFToday both score passing TDs at 6 pts; Sleeper, ESPN, and all of
// Alex's leagues use 4. Rescore QB lines from the site's own projected pass TDs
// so the consensus isn't skewed ~15% high at QB.
export function toFourPointPassTd(points: number, passTd: number): number {
  return Math.round((points - 2 * passTd) * 100) / 100;
}

export function toRows(
  scraped: ScrapedProjection[],
  resolve: ScrapedResolver,
  source: ProjectionSource,
  season: number,
  week: number,
): ScrapedResult {
  const rows: ProjectionRow[] = [];
  const seen = new Set<string>();
  let unresolved = 0;
  for (const p of scraped) {
    const sleeperId = resolve(p);
    if (!sleeperId) {
      unresolved++;
      continue;
    }
    if (seen.has(sleeperId)) continue; // a player listed twice keeps the first (higher-ranked) row
    seen.add(sleeperId);
    rows.push({ sleeperId, source, season, week, points: Math.round(p.points * 100) / 100 });
  }
  return { rows, fetched: scraped.length, unresolved };
}
