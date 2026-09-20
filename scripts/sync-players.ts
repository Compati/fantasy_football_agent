// Force a full player-catalog sync (name/team/position/injuryStatus).
//   npx tsx scripts/sync-players.ts
import { prisma } from "@/lib/db";
import { syncPlayerCatalog } from "@/lib/players";

async function main() {
  const { total, created } = await syncPlayerCatalog();
  const injured = await prisma.player.count({ where: { injuryStatus: { not: null } } });
  console.log(`synced ${total} players (${created} new); ${injured} currently carry an injury status.`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
