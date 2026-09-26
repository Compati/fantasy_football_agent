// Pull a league's waiver claims (won + failed, with FAAB bids) from Sleeper so
// FAAB suggestions can be priced off what the league actually pays
// (lib/features/faab.ts). Each claim is stamped with the player's Sleeper PPR
// projection for that week, which feeds the claim's tier.

import { prisma } from "@/lib/db";
import { getTransactions, getProjections, getNflState } from "@/lib/sleeper";

const STALE_MS = 12 * 60 * 60 * 1000;

export async function refreshWaiverHistory(leagueId: string): Promise<number> {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  if (league.platform !== "sleeper") return 0;
  const state = await getNflState();
  const lastWeek = Number(state.season) === league.season ? Math.max(1, state.week) : 18;

  const claims = [];
  for (let week = 1; week <= lastWeek; week++) {
    const txs = (await getTransactions(league.externalId, week)).filter((t) => t.type === "waiver" && t.adds);
    if (txs.length === 0) continue;
    const proj = new Map(
      (await getProjections(league.season, week, league.ppr).catch(() => [])).map((r) => [r.sleeperId, r.points]),
    );
    for (const t of txs) {
      const sleeperId = Object.keys(t.adds!)[0];
      if (!sleeperId) continue;
      claims.push({
        leagueId,
        transactionId: t.transaction_id,
        week,
        sleeperId,
        bid: t.settings?.waiver_bid ?? 0,
        won: t.status === "complete",
        projAtClaim: proj.get(sleeperId) ?? null,
      });
    }
  }

  const positions = new Map(
    (
      await prisma.player.findMany({
        where: { sleeperId: { in: claims.map((c) => c.sleeperId) } },
        select: { sleeperId: true, position: true },
      })
    ).map((p) => [p.sleeperId, p.position]),
  );
  const data = claims.map((c) => ({ ...c, position: positions.get(c.sleeperId) ?? "?" }));
  await prisma.$transaction([
    prisma.waiverClaim.deleteMany({ where: { leagueId } }),
    prisma.waiverClaim.createMany({ data }),
  ]);
  return data.length;
}

// Refresh any of these leagues whose history is missing or older than STALE_MS.
export async function ensureWaiverHistoryFresh(leagueIds: string[]): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  await Promise.all(
    leagueIds.map(async (id) => {
      const latest = await prisma.waiverClaim.findFirst({ where: { leagueId: id }, orderBy: { updatedAt: "desc" } });
      if (!latest || latest.updatedAt < cutoff) await refreshWaiverHistory(id);
    }),
  );
}
