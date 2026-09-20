import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { prisma } from "@/lib/db";
import { refreshSleeperLeagues } from "@/lib/ingest/sleeper";
import { refreshYahooLeagues } from "@/lib/yahoo/ingest";

export const maxDuration = 60;

// Re-pull rosters/matchups for every connected platform.
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connections = await prisma.connection.findMany();
  const results: Record<string, unknown> = {};
  for (const c of connections) {
    try {
      if (c.platform === "sleeper" && c.sleeperUserId) {
        results[c.id] = await refreshSleeperLeagues(c.id);
      } else if (c.platform === "yahoo" && c.yahooRefreshToken) {
        results[c.id] = await refreshYahooLeagues(c.id);
      }
    } catch (e) {
      results[c.id] = { error: (e as Error).message };
    }
  }
  return NextResponse.json({ ok: true, results });
}
