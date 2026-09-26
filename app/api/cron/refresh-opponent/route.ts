import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { getNflState } from "@/lib/sleeper";
import { refreshDefenseVsPosition, refreshGameLines } from "@/lib/ingest/opponent";

export const maxDuration = 60;

// Opponent context for start/sit: this week's game lines (2 Odds API credits,
// skipped without a key) + defense-vs-position (free). Daily ≈ 60 credits/month.
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const state = await getNflState();
  const season = Number(state.season);
  const week = state.week > 0 ? state.week : 1;
  const [lines, dvpRows] = await Promise.all([
    refreshGameLines(season, week),
    refreshDefenseVsPosition(season, week),
  ]);
  return NextResponse.json({ ok: true, season, week, lines, dvpRows });
}
