import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { prisma } from "@/lib/db";
import { refreshTradeValues } from "@/lib/ingest/trade-values";

export const maxDuration = 60;

// Refresh FantasyCalc values for every distinct format across all leagues.
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const leagues = await prisma.league.findMany({ select: { ppr: true, numQbs: true, numTeams: true } });
  const seen = new Set<string>();
  let total = 0;
  for (const l of leagues) {
    const key = `${l.ppr}|${l.numQbs}|${l.numTeams}`;
    if (seen.has(key)) continue;
    seen.add(key);
    total += await refreshTradeValues({ ppr: l.ppr, numQbs: l.numQbs, numTeams: l.numTeams });
  }
  return NextResponse.json({ ok: true, formats: seen.size, rows: total });
}
