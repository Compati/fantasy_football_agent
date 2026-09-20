// One-off: connect a Sleeper username for the seeded user and print what landed.
//   npx tsx scripts/connect-sleeper.ts <username>
import { prisma } from "@/lib/db";
import { connectSleeper } from "@/lib/ingest/sleeper";

async function main() {
  const username = process.argv[2];
  if (!username) throw new Error("Usage: tsx scripts/connect-sleeper.ts <username>");
  const email = (process.env.SEED_EMAIL ?? "").toLowerCase().trim();
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  console.log(`Connecting Sleeper "${username}" for ${email} …`);
  const summary = await connectSleeper(user.id, username);
  console.log(`\n${summary.leagues} leagues, ${summary.teams} teams (season ${summary.season})\n`);

  const leagues = await prisma.league.findMany({
    where: { connection: { userId: user.id }, platform: "sleeper" },
    include: { teams: { where: { isMine: true }, include: { roster: true } } },
    orderBy: { name: "asc" },
  });

  for (const lg of leagues) {
    const fmt = lg.ppr === 1 ? "PPR" : lg.ppr === 0.5 ? "Half" : "Std";
    const sf = lg.numQbs === 2 ? " SF" : "";
    const faab = lg.faabBudget ? ` $${lg.faabBudget} FAAB` : "";
    const team = lg.teams[0];
    console.log(`• ${lg.name}  [${lg.numTeams}-team ${fmt}${sf}${faab}]`);
    if (!team) {
      console.log("    (no team of yours found)");
      continue;
    }
    const starters = team.roster.filter((r) => r.starter);
    const bench = team.roster.filter((r) => !r.starter);
    const unresolved = team.roster.filter((r) => !r.sleeperId).length;
    console.log(`    team "${team.name}"  starters=${starters.length} bench=${bench.length} unresolved=${unresolved}`);
    console.log("    " + starters.map((s) => `${s.slot}:${s.name}`).join("  "));
  }
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); }).finally(() => prisma.$disconnect());
