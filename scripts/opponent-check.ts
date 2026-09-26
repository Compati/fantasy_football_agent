// Live check for opponent context: refresh game lines + defense-vs-position for
// the current week and print a sample. Spends 2 Odds API credits if a key is set.
//   npx tsx scripts/opponent-check.ts
import { prisma } from "@/lib/db";
import { getNflState } from "@/lib/sleeper";
import { refreshGameLines, refreshDefenseVsPosition } from "@/lib/ingest/opponent";

async function main() {
  const state = await getNflState();
  const season = Number(state.season);
  const week = state.week > 0 ? state.week : 1;
  console.log(`season ${season} week ${week}`);
  console.log("game lines:", await refreshGameLines(season, week));
  console.log("dvp rows:", await refreshDefenseVsPosition(season, week));

  const lines = await prisma.gameLine.findMany({ where: { season, week }, orderBy: { impliedTotal: "desc" } });
  for (const l of lines.slice(0, 4)) console.log(`  ${l.team} ${l.isHome ? "vs" : "@"} ${l.opponent}  spread ${l.spread}  total ${l.total}  implied ${l.impliedTotal}`);
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    const d = await prisma.defenseVsPosition.findMany({ where: { season, position: pos }, orderBy: { rank: "asc" } });
    const fmt = (x: (typeof d)[number]) => `${x.team} ${x.adjusted} (${x.perGame}/g, ${x.games}g)`;
    console.log(`  ${pos}: easiest ${d.slice(0, 3).map(fmt).join(", ")} | hardest ${d.slice(-2).map(fmt).join(", ")}`);
  }
}
main().finally(() => prisma.$disconnect());
