"use server";

import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { evaluateTrade, type TradeEvaluation } from "@/lib/features/trade";

export type TradeActionResult = TradeEvaluation | { error: string };

export async function evaluateTradeAction(
  leagueId: string,
  giveIds: string[],
  getIds: string[],
): Promise<TradeActionResult> {
  const user = await requireUser();
  const league = await prisma.league.findFirst({
    where: { id: leagueId, connection: { userId: user.id } },
    select: { id: true },
  });
  if (!league) return { error: "League not found." };
  if (giveIds.length === 0 || getIds.length === 0) {
    return { error: "Pick at least one player on each side." };
  }
  return evaluateTrade(leagueId, giveIds, getIds);
}
