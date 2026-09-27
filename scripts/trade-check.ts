// Print near-term and rest-of-season trade ideas for each of the user's teams
// (timed), each with the opposite horizon's gains for comparison.
//   npx tsx scripts/trade-check.ts
import { prisma } from "@/lib/db";
import { tradeIdeasForTeam, type HorizonIdeas } from "@/lib/features/trade-finder";

const fmt = (ps: { name: string; position: string; value: number }[]) =>
  ps.map((p) => `${p.name} ${p.position} (${p.value})`).join(" + ");

function show(label: string, h: HorizonIdeas, otherLabel: string) {
  console.log(`  -- ${label} (weeks ${h.weeks[0]}-${h.weeks[h.weeks.length - 1]})`);
  if (!h.ideas.length) console.log("     (no fair win-win trades)");
  for (const i of h.ideas) {
    console.log(`     w/ ${i.partnerName}: give ${fmt(i.give)} -> get ${fmt(i.get)}  [value ${i.giveValue} vs ${i.getValue}]`);
    console.log(`        you +${i.myGain} / them +${i.theirGain}   |  ${otherLabel}: you ${i.other.myGain >= 0 ? "+" : ""}${i.other.myGain} / them ${i.other.theirGain >= 0 ? "+" : ""}${i.other.theirGain}`);
  }
}

async function main() {
  const teams = await prisma.team.findMany({ where: { isMine: true }, include: { league: true } });
  for (const t of teams) {
    const t0 = Date.now();
    const r = await tradeIdeasForTeam(t.id);
    console.log(`\n=== ${t.league.name} (${Date.now() - t0}ms)`);
    show("NEAR TERM", r.near, "rest of season");
    show("REST OF SEASON", r.ros, "next 3 wks");
  }
}
main().finally(() => prisma.$disconnect());
