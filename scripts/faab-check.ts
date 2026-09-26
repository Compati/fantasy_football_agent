// Live check for calibrated FAAB ranges: refresh each league's waiver history,
// print per-tier prices and this week's top waiver targets with their range.
//   npx tsx scripts/faab-check.ts
import { prisma } from "@/lib/db";
import { refreshWaiverHistory } from "@/lib/ingest/waiver-history";
import { waiverTargets } from "@/lib/features/waivers";

async function main() {
  const teams = await prisma.team.findMany({ where: { isMine: true }, include: { league: true } });
  for (const t of teams) console.log(`${t.league.name}: ${await refreshWaiverHistory(t.leagueId)} claims`);
  for (const t of teams) {
    const w = await waiverTargets(t.id, { limit: 10 });
    console.log(`\n=== ${t.league.name} ($${t.league.faabBudget} budget, $${w.remainingBudget} left)`);
    for (const x of w.targets) {
      const f = x.faab;
      console.log(
        `  ${x.name.padEnd(22)} ${x.position.padEnd(3)} ${String(x.proj).padStart(5)}  ` +
          (f ? `${f.tier.padEnd(7)} $${f.low}-$${f.high}  bid $${f.bid} (${f.need}${f.hot ? ", HOT" : ""})  [${f.basis}, n=${f.samples}, contested ${f.contestedShare == null ? "?" : Math.round(f.contestedShare * 100) + "%"}]` : "no FAAB"),
      );
    }
  }
}
main().finally(() => prisma.$disconnect());
