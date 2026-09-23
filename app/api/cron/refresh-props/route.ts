import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { refreshPlayerProps } from "@/lib/ingest/props";

export const maxDuration = 60;

// Player-prop lines (Phase 5), scoped to games involving a rostered player.
// No-ops if ODDS_API_KEY isn't set. Weekly cadence — see lib/ingest/props.ts
// for the credit-budget reasoning.
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await refreshPlayerProps();
  return NextResponse.json({ ok: true, ...result });
}
