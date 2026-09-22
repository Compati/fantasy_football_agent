// Terminal trace of what the advisor agent does, step by step. Prints to the
// server console (the terminal running `npm run dev`) — nothing goes to the UI.
// Meant for demos/teaching: it narrates the three stages of a run — GATHER the
// grounded data, REASON (the model's own thinking), DECIDE (the final moves).
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
    ? ` (top: ${ctx.waiverTargets[0].player}, ${ctx.waiverTargets[0].proj} proj, ${ctx.waiverTargets[0].suggestedFaab})`
    : ""));
  if (ctx.survival) {
    const s = ctx.survival;
    log(
      `   • Guillotine survival: rank ${s.myRank}/${s.numActive}, ` +
        `${s.cushion >= 0 ? "+" + s.cushion : s.cushion} vs elim line ${s.eliminationLine} (${s.onTheBlock})` +
        (s.survivalProb != null ? `, ${Math.round(s.survivalProb * 100)}% survive` : ""),
    );
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
