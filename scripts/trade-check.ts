// Print trade ideas for each of the user's teams (timed).
//   npx tsx scripts/trade-check.ts
import { prisma } from "@/lib/db";
import { tradeIdeasForTeam } from "@/lib/features/trade-finder";

async function main() {
  const teams = await prisma.team.findMany({ where: { isMine: true }, include: { league: true } });
  for (const t of teams) {
    const t0 = Date.now();
    const { ideas, horizon } = await tradeIdeasForTeam(t.id);
    console.log(`\n=== ${t.league.name} (weeks ${horizon.join(",")}; ${Date.now() - t0}ms)`);
    const fmt = (ps: { name: string; position: string; value: number }[]) => ps.map((p) => `${p.name} ${p.position} (${p.value})`).join(" + ");
    for (const i of ideas) {
      console.log(`  w/ ${i.partnerName}: give ${fmt(i.give)}  ->  get ${fmt(i.get)}`);
      console.log(`      you +${i.myGain} pts / them +${i.theirGain} pts over ${horizon.length} wks · value ${i.giveValue} vs ${i.getValue}`);
    }
    if (!ideas.length) console.log("  (no fair win-win trades found)");
  }
}
main().finally(() => prisma.$disconnect());
