// Terminal trace of a run, step by step. Prints to the console (the terminal
// running `npm run dev` or a script) — nothing goes to the UI. Meant for
// demos/teaching. Two sets of printers:
//   - the weekly-plan advisor (advisor.ts): GATHER the grounded data, REASON
//     (the model's own thinking), DECIDE (the final moves);
//   - the agent loop (loop.ts), further down: per turn, 🧠 the plan, 🔧 the
//     tool calls it chose, ↳ what each returned, then the answer.
//
// Toggle: on by default in dev; force with ADVISOR_TRACE=1, silence with
// ADVISOR_TRACE=0.

import type { LeagueContext } from "@/lib/agent/context";
import type { AdvisorResult } from "@/lib/agent/advisor";

export function traceEnabled(): boolean {
  const flag = process.env.ADVISOR_TRACE;
  if (flag === "1") return true;
  if (flag === "0") return false;
  return process.env.NODE_ENV !== "production";
}

const RULE = "─".repeat(72);
function log(line = "") {
  console.log(line);
}

export function traceStart(league: string, team: string, week: number, modelLabel: string) {
  if (!traceEnabled()) return;
  log("\n" + RULE);
  log(`🏈 ADVISOR RUN · ${league} · ${team} · Week ${week}`);
  log(`   model: ${modelLabel}`);
}

export function traceGather(ctx: LeagueContext) {
  if (!traceEnabled()) return;
  const ss = ctx.startSit;
  log("\n① GATHER — grounded data assembled (this is all the model gets to see):");
  log(
    `   • Optimal lineup ${ss.optimalPoints} pts vs current ${ss.currentPoints} ` +
      `(${ss.pointsLeftOnBench} left on bench)`,
  );
  if (ss.shouldStart.length) {
    log(
      `   • ${ss.shouldStart.length} start-swap(s): ` +
        ss.shouldStart.map((s, i) => `${s.player} (${s.proj}) over ${ss.shouldSit[i]?.player ?? "?"}`).join("; "),
    );
  }
  if (ctx.injuries.length) {
    log(
      `   • ${ctx.injuries.length} injury alert(s): ` +
        ctx.injuries.map((i) => `${i.player} (${i.status}${i.starting ? ", starting" : ""})`).join("; "),
    );
  }
  log(`   • ${ctx.waiverTargets.length} waiver targets` + (ctx.waiverTargets[0]
    ? ` (top: ${ctx.waiverTargets[0].player}, ${ctx.waiverTargets[0].proj} proj, ${ctx.waiverTargets[0].suggestedBid ?? "no FAAB"})`
    : ""));
  if (ctx.survival) {
    const s = ctx.survival;
    log(
      `   • Guillotine survival: rank ${s.myRank}/${s.numActive}, ` +
        `${s.cushion >= 0 ? "+" + s.cushion : s.cushion} vs elim line ${s.eliminationLine} (${s.onTheBlock})` +
        (s.survivalProb != null ? `, ${Math.round(s.survivalProb * 100)}% survive` : ""),
    );
  }
  if (ctx.outlook.thinPositions.length || ctx.outlook.nextByeCrunchWeek != null) {
    const thin = ctx.outlook.thinPositions.map((t) => t.position).join("/") || "none";
    const crunch = ctx.outlook.nextByeCrunchWeek != null ? `week ${ctx.outlook.nextByeCrunchWeek}` : "none";
    log(`   • Outlook: thin at ${thin}; next bye crunch ${crunch}`);
  }
  log(
    `   • FAAB remaining: ${ctx.league.faabRemaining != null ? "$" + ctx.league.faabRemaining : "n/a"} · ` +
      `sources: ${ctx.dataAvailable.join(", ")}`,
  );
}

export function traceReason(thinking: string) {
  if (!traceEnabled()) return;
  log("\n② REASON — the model's own thinking:");
  if (!thinking.trim()) {
    log("   (no thinking block returned — this model/config runs without visible reasoning)");
    return;
  }
  for (const line of thinking.trim().split("\n")) log("   │ " + line);
}

// ---- Agent loop (lib/agent/loop.ts): one line per tool call, then the answer.

export function traceAgentStart(question: string, modelLabel: string) {
  if (!traceEnabled()) return;
  log("\n" + RULE);
  log(`🤖 AGENT RUN · model: ${modelLabel}`);
  log(`   Q: ${question}`);
}

// What the model decided this turn: its one-line plan and the tool calls it chose.
export function traceAgentDecide(
  turn: number,
  plan: string,
  calls: { name: string; input: Record<string, unknown> }[],
) {
  if (!traceEnabled()) return;
  log(`
   ── turn ${turn} ──`);
  if (plan) log(`   🧠 ${plan}`);
  for (const c of calls) {
    const args = Object.entries(c.input)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    log(`   🔧 ${c.name}(${args})`);
  }
}

// What came back from one tool, as a human-readable line.
export function traceAgentResult(name: string, summary: string, isError: boolean, ms: number) {
  if (!traceEnabled()) return;
  log(`      ${isError ? "⚠️ " : "↳"} ${name}: ${summary} · ${ms}ms`);
}

export function traceAgentDone(
  answer: string,
  turns: number,
  toolCalls: number,
  input: number,
  output: number,
  ms: number,
) {
  if (!traceEnabled()) return;
  log(
    `\n   ✅ answered after ${turns} turn(s), ${toolCalls} tool call(s) · ${(ms / 1000).toFixed(1)}s · ` +
      `${input.toLocaleString()} in / ${output.toLocaleString()} out tokens`,
  );
  for (const line of answer.split("\n")) log("   │ " + line);
  log(RULE + "\n");
}

export function traceDecide(result: AdvisorResult, usage: { input: number; output: number } | null, ms: number) {
  if (!traceEnabled()) return;
  const cost = usage ? ` · ${usage.input.toLocaleString()} in / ${usage.output.toLocaleString()} out tokens` : "";
  log(`\n③ DECIDE — ${result.moves.length} move(s) · ${(ms / 1000).toFixed(1)}s${cost}:`);
  for (const m of [...result.moves].sort((a, b) => a.priority - b.priority)) {
    log(`   ${m.priority}. [${m.type} · ${m.confidence}] ${m.title}`);
    log(`      ${m.detail}`);
  }
  log(`   summary: ${result.summary}`);
  log(RULE + "\n");
}
