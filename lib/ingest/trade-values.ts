// Ingest FantasyCalc market values into the TradeValue table, one row-set per
// distinct league format the user actually plays (ppr / numQbs / numTeams).

import { prisma } from "@/lib/db";
import { getTradeValues } from "@/lib/fantasycalc";
import { ensureCatalogFresh } from "@/lib/players";
import type { ScoringContext } from "@/lib/types";

export async function refreshTradeValues(
  ctx: ScoringContext,
  isDynasty = false,
): Promise<number> {
  await ensureCatalogFresh();
  const validIds = new Set(
    (await prisma.player.findMany({ select: { sleeperId: true } })).map((p) => p.sleeperId),
  );

  const rows = (await getTradeValues(ctx, isDynasty)).filter(
    (r) => r.sleeperId && validIds.has(r.sleeperId),
  );

  await prisma.tradeValue.deleteMany({
    where: { isDynasty, ppr: ctx.ppr, numQbs: ctx.numQbs, numTeams: ctx.numTeams },
  });
  if (rows.length > 0) {
    await prisma.tradeValue.createMany({
      data: rows.map((r) => ({
        sleeperId: r.sleeperId as string,
        isDynasty,
        ppr: ctx.ppr,
        numQbs: ctx.numQbs,
        numTeams: ctx.numTeams,
        value: r.value,
        redraftValue: r.redraftValue,
        overallRank: r.overallRank,
        positionRank: r.positionRank,
        trend30: r.trend30Day,
        tier: r.tier,
      })),
    });
  }
  return rows.length;
}

// Refresh values for every distinct format among the user's leagues.
export async function refreshTradeValuesForUser(userId: string): Promise<number> {
  const leagues = await prisma.league.findMany({
    where: { connection: { userId } },
    select: { ppr: true, numQbs: true, numTeams: true },
  });
  const seen = new Set<string>();
  let total = 0;
  for (const l of leagues) {
    const key = `${l.ppr}|${l.numQbs}|${l.numTeams}`;
    if (seen.has(key)) continue;
    seen.add(key);
    total += await refreshTradeValues({ ppr: l.ppr, numQbs: l.numQbs, numTeams: l.numTeams });
  }
  return total;
}
