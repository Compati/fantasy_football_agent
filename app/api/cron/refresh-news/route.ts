import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { refreshNews } from "@/lib/ingest/news";

export const maxDuration = 60;

// Reddit + YouTube community context (Phase 4), matched to fantasy-relevant
// players. No-ops on Reddit if REDDIT_CLIENT_ID/SECRET aren't set yet; YouTube
// always runs (key-free).
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await refreshNews();
  return NextResponse.json({ ok: true, ...result });
}
