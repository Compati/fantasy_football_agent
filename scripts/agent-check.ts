// Ask the agent a question from the terminal (same loop as the "Ask the agent"
// page) and print every step — for testing and demos without the UI.
//   npx tsx scripts/agent-check.ts                      (the demo question)
//   npx tsx scripts/agent-check.ts "Who should I start in Escalated?" [model]
//   npx tsx scripts/agent-check.ts --tools   (smoke-test every tool, no LLM calls)
import { prisma } from "@/lib/db";
import { runAgent } from "@/lib/agent/loop";
import { runTool } from "@/lib/agent/tools";
import { isAdvisorModel, DEFAULT_ADVISOR_MODEL } from "@/lib/agent/advisor";

// The demo question: each step depends on what the last one returned, so the
// loop runs 5-7 turns (the old "which league needs the most attention?" took 3).
const DEMO_QUESTION =
  "Find the league where I'm in the most trouble this week. Then fix it: set my best lineup, find a waiver pickup for my weakest starting spot with a bid and who to drop, and check the news on anyone you recommend.";

async function main() {
  const conn = await prisma.connection.findFirstOrThrow({ where: { platform: "sleeper" } });
  const ctx = { userId: conn.userId };

  if (process.argv[2] === "--tools") {
    const teams = await prisma.team.findMany({ where: { isMine: true }, include: { league: true } });
    const league = teams[0].league.name;
    const calls: [string, Record<string, unknown>][] = [
      ["list_my_leagues", {}],
      ["get_lineup_advice", { league }],
      ["get_matchup", { league }],
      ["get_waiver_targets", { league, limit: 3 }],
      ["lookup_player", { name: "Watson", league }],
      ["get_trade_ideas", { league }],
      ["get_roster_outlook", { league }],
      ["get_player_news", { players: ["Bijan Robinson"] }],
      ["get_lineup_advice", { league: "no such league" }],
    ];
    for (const g of teams.map((t) => t.league.name)) calls.push(["get_matchup", { league: g }]);
    for (const [name, input] of calls) {
      const t0 = Date.now();
      const r = await runTool(name, input, ctx);
      console.log(`\n${r.isError ? "⚠️ " : "✓ "}${name}(${JSON.stringify(input)}) ${Date.now() - t0}ms, ${r.content.length} chars`);
      console.log("  ↳ " + r.summary);
      console.log("  " + r.content.slice(0, 300));
    }
    return;
  }

  const question = process.argv[2] ?? DEMO_QUESTION;
  const model = isAdvisorModel(process.argv[3]) ? process.argv[3] : DEFAULT_ADVISOR_MODEL;
  // The loop's terminal trace prints each tool call and the answer.
  process.env.ADVISOR_TRACE = "1";
  await runAgent(question, [], ctx, (e) => {
    if (e.type === "error") console.log("ERROR:", e.message);
  }, model);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
