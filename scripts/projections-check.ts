// Live check for the multi-source projections: refresh every source, then
// report coverage per source and how each one tracks Sleeper by position
// (median ratio ≈ 1.0 means the scoring settings line up; e.g. a site using
// 6-pt passing TDs would show QB well above 1).
//   npx tsx scripts/projections-check.ts

import { prisma } from "@/lib/db";
import { refreshProjections } from "@/lib/ingest/projections";

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

async function main() {
  const r = await refreshProjections();
  console.log(r);

  const rows = await prisma.projection.findMany({
    where: { season: r.season, week: r.week },
    include: { player: { select: { position: true } } },
  });
  const sleeper = new Map(rows.filter((x) => x.source === "sleeper").map((x) => [x.sleeperId, x.points]));

  for (const source of ["espn", "cbs", "fftoday"]) {
    const byPos = new Map<string, number[]>();
    for (const x of rows) {
      if (x.source !== source) continue;
      const base = sleeper.get(x.sleeperId);
      if (!base || base < 5 || x.points <= 0) continue; // ratios on fringe players are noise
      const arr = byPos.get(x.player.position) ?? [];
      arr.push(x.points / base);
      byPos.set(x.player.position, arr);
    }
    const parts = [...byPos].map(([pos, xs]) => `${pos} ${median(xs).toFixed(2)} (n=${xs.length})`);
    console.log(`${source.padEnd(8)} vs sleeper median ratio: ${parts.join("  ")}`);
  }

  const perPlayer = new Map<string, number>();
  for (const x of rows) perPlayer.set(x.sleeperId, (perPlayer.get(x.sleeperId) ?? 0) + 1);
  const dist = [1, 2, 3, 4].map((n) => `${n}src=${[...perPlayer.values()].filter((v) => v === n).length}`);
  console.log(`players by source count: ${dist.join(" ")}`);
}

main().finally(() => prisma.$disconnect());
