// Run the advisor on every one of the user's teams (same path as the
// "Generate" button, cached the same way) and print the moves next to the
// key context they should be grounded in — for reviewing output quality.
//   npx tsx scripts/advisor-check.ts [model]
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildLeagueContext } from "@/lib/agent/context";
import { generateRecommendations, isAdvisorModel, DEFAULT_ADVISOR_MODEL } from "@/lib/agent/advisor";

async function main() {
  const model = isAdvisorModel(process.argv[2]) ? process.argv[2] : DEFAULT_ADVISOR_MODEL;
  const teams = await prisma.team.findMany({ where: { isMine: true }, include: { league: true } });
  for (const t of teams) {
    const ctx = await buildLeagueContext(t.id);
    console.log(`\n=== ${ctx.league.name} (wk ${ctx.league.week}) — ${model}`);
    console.log("  lineup:", ctx.startSit.recommendedLineup.map((a) => `${a.slot} ${a.player} ${a.proj}`).join(" | "));
    console.log("  close calls:", ctx.startSit.closeCalls.map((c) => `${c.starter}>${c.alternative} +${c.gap}`).join("; ") || "none");
    console.log("  injuries:", ctx.injuries.map((i) => `${i.player} ${i.status}${i.starting ? " (starting)" : ""}`).join(", ") || "none");
    console.log(
      "  top targets:",
      ctx.waiverTargets.slice(0, 5).map((w) => `${w.player} ${w.position} ${w.proj} ${w.faabRange ?? ""}→${w.suggestedBid ?? "-"} ${w.need}${w.hotAdd ? " HOT" : ""}`).join(" | "),
    );
    const t0 = Date.now();
    const res = await generateRecommendations(ctx, model);
    console.log(`  --- advisor (${((Date.now() - t0) / 1000).toFixed(1)}s): ${res.summary}`);
    for (const m of res.moves) console.log(`  ${m.priority}. [${m.type}/${m.confidence}] ${m.title}\n       ${m.detail}`);
    await prisma.recommendation.upsert({
      where: { teamId_season_week: { teamId: t.id, season: t.league.season, week: ctx.league.week } },
      update: { summary: res.summary, moves: res.moves as unknown as Prisma.InputJsonValue, model },
      create: { teamId: t.id, season: t.league.season, week: ctx.league.week, summary: res.summary, moves: res.moves as unknown as Prisma.InputJsonValue, model },
    });
  }
}
main().finally(() => prisma.$disconnect());
