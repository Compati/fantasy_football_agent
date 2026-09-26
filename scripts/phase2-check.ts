// Ingest projections + trade values, then run start/sit for each of my teams.
//   npx tsx scripts/phase2-check.ts
import { prisma } from "@/lib/db";
import { refreshProjections } from "@/lib/ingest/projections";
import { refreshTradeValuesForUser } from "@/lib/ingest/trade-values";
import { startSitForTeam } from "@/lib/features/startsit";

async function main() {
  const email = (process.env.SEED_EMAIL ?? "").toLowerCase().trim();
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  console.log("Ingesting projections …");
  const proj = await refreshProjections();
  console.log(`  season ${proj.season} wk ${proj.week}: sleeper=${proj.sleeper} espn=${proj.espn} (unresolved ${proj.espnUnresolved}) cbs=${proj.cbs} (unresolved ${proj.cbsUnresolved}) fftoday=${proj.fftoday} (unresolved ${proj.fftodayUnresolved})`);

  console.log("Ingesting trade values …");
  const tv = await refreshTradeValuesForUser(user.id);
  console.log(`  ${tv} trade-value rows`);

  const teams = await prisma.team.findMany({
    where: { isMine: true, league: { connection: { userId: user.id } } },
    include: { league: true },
  });

  for (const team of teams) {
    const r = await startSitForTeam(team.id);
    console.log(`\n=== ${team.league.name} — ${team.name} (wk ${r.week}) ===`);
    console.log(`optimal=${r.optimalTotal}  current=${r.currentTotal}  points left on bench=${r.delta}`);
    console.log("Optimal lineup:");
    for (const a of r.lineup) {
      const p = a.player;
      console.log(`  ${a.slot.padEnd(10)} ${p ? `${p.name} (${p.position}) ${p.proj} [${p.sources}src]` : "—"}`);
    }
    if (r.start.length) console.log("START:", r.start.map((p) => `${p.name} (${p.proj})`).join(", "));
    if (r.sit.length) console.log("SIT:  ", r.sit.map((p) => `${p.name} (${p.proj})`).join(", "));
    if (r.closeCalls.length)
      console.log("CLOSE:", r.closeCalls.slice(0, 3).map((c) => `${c.starter.name} vs ${c.alternative.name} (${c.gap})`).join("; "));
  }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); }).finally(() => prisma.$disconnect());
