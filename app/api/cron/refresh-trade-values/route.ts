import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { prisma } from "@/lib/db";
import { refreshTradeValues } from "@/lib/ingest/trade-values";
import { refreshDerivedValues } from "@/lib/ingest/derived-values";

export const maxDuration = 60;

// Refresh FantasyCalc values for every distinct format across all leagues, then
// gap-fill projection-derived values for players outside FantasyCalc's set.
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const leagues = await prisma.league.findMany({ select: { ppr: true, numQbs: true, numTeams: true } });
  const seen = new Set<string>();
  let market = 0;
  let derived = 0;
  for (const l of leagues) {
    const key = `${l.ppr}|${l.numQbs}|${l.numTeams}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ctx = { ppr: l.ppr, numQbs: l.numQbs, numTeams: l.numTeams };
    market += await refreshTradeValues(ctx);
    derived += await refreshDerivedValues(ctx);
  }
  return NextResponse.json({ ok: true, formats: seen.size, marketRows: market, derivedRows: derived });
}
