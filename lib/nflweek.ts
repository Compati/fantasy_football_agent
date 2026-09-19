// NFL week helpers. We mostly trust Sleeper's /state/nfl for the live week, but
// keep a season anchor for offline math and bucketing.

const SEASON_WEEK1_THURSDAY: Record<number, string> = {
  2024: "2024-09-05T00:00:00Z",
  2025: "2025-09-04T00:00:00Z",
  2026: "2026-09-10T00:00:00Z",
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function week1Start(season: number): Date {
  const iso = SEASON_WEEK1_THURSDAY[season];
  if (iso) return new Date(iso);
  // Fallback: first Thursday of September.
  const sept1 = new Date(Date.UTC(season, 8, 1));
  const offset = (4 - sept1.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(season, 8, 1 + offset));
}

export function weekNumberForDate(season: number, date: Date): number {
  const diff = date.getTime() - week1Start(season).getTime();
  if (diff < 0) return 1;
  return Math.min(18, Math.floor(diff / WEEK_MS) + 1);
}

export function weekLabel(weekNumber: number): string {
  return `Week ${weekNumber}`;
}
