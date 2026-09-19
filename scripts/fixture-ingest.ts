// Insert a realistic SAMPLE Sleeper league for the seeded user so the dashboard
// rendering path can be verified without anyone's real account. Idempotent.
//   Insert:  npx tsx scripts/fixture-ingest.ts
//   Clear:   npx tsx scripts/fixture-ingest.ts --clear
import { prisma } from "@/lib/db";

const SAMPLE_EXTERNAL = "SAMPLE-fixture-league";

async function main() {
  const email = (process.env.SEED_EMAIL ?? "").toLowerCase().trim();
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  const conn = await prisma.connection.upsert({
    where: { userId_platform: { userId: user.id, platform: "sleeper" } },
    update: { sleeperUsername: "sample", sleeperUserId: "sample-user" },
    create: { userId: user.id, platform: "sleeper", sleeperUsername: "sample", sleeperUserId: "sample-user" },
  });

  if (process.argv.includes("--clear")) {
    await prisma.league.deleteMany({ where: { externalId: SAMPLE_EXTERNAL } });
    console.log("Cleared sample league.");
    return;
  }

  const league = await prisma.league.upsert({
    where: { platform_externalId: { platform: "sleeper", externalId: SAMPLE_EXTERNAL } },
    update: {},
    create: {
      connectionId: conn.id,
      platform: "sleeper",
      externalId: SAMPLE_EXTERNAL,
      name: "SAMPLE — The Gauntlet",
      season: 2026,
      ppr: 1,
      numTeams: 12,
      numQbs: 1,
      faabBudget: 100,
      rosterPositions: ["QB", "RB", "RB", "WR", "WR", "FLEX", "BN", "BN"],
      scoringSettings: { rec: 1 },
    },
  });

  const team = await prisma.team.upsert({
    where: { leagueId_externalId: { leagueId: league.id, externalId: "1" } },
    update: {},
    create: { leagueId: league.id, externalId: "1", name: "Alex's Team", isMine: true, wins: 1, losses: 1 },
  });

  const spots = [
    { slot: "QB", name: "Josh Allen", position: "QB", nflTeam: "BUF", starter: true },
    { slot: "RB", name: "Jahmyr Gibbs", position: "RB", nflTeam: "DET", starter: true },
    { slot: "RB", name: "Bijan Robinson", position: "RB", nflTeam: "ATL", starter: true },
    { slot: "WR", name: "Ja'Marr Chase", position: "WR", nflTeam: "CIN", starter: true },
    { slot: "WR", name: "Puka Nacua", position: "WR", nflTeam: "LAR", starter: true },
    { slot: "FLEX", name: "Amon-Ra St. Brown", position: "WR", nflTeam: "DET", starter: true },
    { slot: "BN", name: "Kenneth Walker", position: "RB", nflTeam: "SEA", starter: false },
    { slot: "BN", name: "Justin Jefferson", position: "WR", nflTeam: "MIN", starter: false },
  ];
  await prisma.rosterSpot.deleteMany({ where: { teamId: team.id } });
  await prisma.rosterSpot.createMany({ data: spots.map((s) => ({ teamId: team.id, ...s })) });

  console.log(`Inserted sample league with ${spots.length} roster spots for ${email}.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
