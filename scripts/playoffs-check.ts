// Prints the playoff picture for each of my Sleeper leagues (no API key needed).
//   npx tsx scripts/playoffs-check.ts
import { prisma } from "@/lib/db";
import { getPlayoffPicture } from "@/lib/features/playoffs";

async function main() {
  const teams = await prisma.team.findMany({ where: { isMine: true }, include: { league: true } });
  for (const t of teams) {
    console.log(`\n=== ${t.league.name} (${t.name}) ===`);
    const p = await getPlayoffPicture(t.id);
    if (!p.applicable) {
      console.log(`n/a — ${p.reason}`);
      continue;
    }
    console.log(
      `week ${p.week} · ${p.phase} · ${p.playoffTeams} of ${t.league.numTeams} make it (playoffs start wk ${p.playoffWeekStart}, ${p.weeksLeftInRegularSeason} reg-season wks left)`,
    );
    console.log(`me: seed ${p.me.seed}, ${p.me.record}, PF ${p.me.pointsFor} · wins above cut ${p.winsAboveCut} · status ${p.status}`);
    const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
    console.log(`make playoffs ${pct(p.makePlayoffsProb)} · if win ${pct(p.ifWinThisWeek)} · if lose ${pct(p.ifLoseThisWeek)} · swing ${pct(p.thisWeekSwing)}`);
    for (const s of p.standings) {
      console.log(`  ${s.isMine ? "▶" : " "} ${String(s.seed).padStart(2)}. ${s.team.padEnd(28)} ${s.record.padEnd(6)} PF ${String(s.pointsFor).padEnd(7)} ${pct(s.makePlayoffsProb)}`);
    }
    if (p.bracket) console.log("bracket:", p.bracket);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
