// The agent loop, hand-rolled. Unlike the weekly-plan advisor (advisor.ts),
// which is handed one big pre-built context, here Claude gets a toolbox
// (tools.ts) and decides for itself what to look up:
//
//   1. send the conversation + tool definitions to Claude
//   2. if it answers with tool_use blocks → run each tool, append the results,
//      and go back to 1 (it now sees what it asked for)
//   3. if it answers without asking for a tool → that's the final answer
//
// Bounded by MAX_TURNS so a confused model can't loop forever. Every step is
// reported through `onEvent` (streamed to the UI) and the terminal trace.

import Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFINITIONS, runTool, type ToolContext } from "@/lib/agent/tools";
import { DEFAULT_ADVISOR_MODEL, ADVISOR_MODELS, type AdvisorModel } from "@/lib/agent/advisor";
import { traceAgentStart, traceAgentDecide, traceAgentResult, traceAgentDone } from "@/lib/agent/trace";

export const MAX_TURNS = 10;
const MAX_TOKENS = 8000;

export type AgentEvent =
  | { type: "plan"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string; ms: number }
  | { type: "answer"; text: string }
  | { type: "done"; turns: number; toolCalls: number; inputTokens: number; outputTokens: number; ms: number }
  | { type: "error"; message: string };

// Prior chat turns (plain text) so follow-up questions have context.
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

const SYSTEM = `You are a sharp, no-nonsense fantasy football assistant for one manager who plays in several leagues. Answer their question by looking up real data with your tools — you have no other knowledge of their rosters, leagues, projections or FAAB history.

How to work:
- Before each round of tool calls, write ONE short sentence (under 20 words) saying what you're about to check and why — it's shown live to the manager as you work. Then call the tools. Call several independent tools in the same turn when you can (e.g. the same tool for each league).
- If a league name is ambiguous or unknown, call list_my_leagues. If a tool returns an error, read it and correct your call.
- Stop calling tools as soon as you have enough to answer; don't fetch data you won't use.

Rules for the answer:
- Ground every claim in numbers the tools returned. Never invent stats, injuries, news, matchups or bids. If you couldn't find something, say so.
- Cite the numbers: projections, points left on bench, FAAB bids (only the suggestedBid/range the tools gave — never a higher number), market values, win/survival probability.
- Projections already include matchups; a backtest showed overriding them on matchup grounds made start/sit calls worse. On close calls, go with the higher projection; mention matchup only as color.
- Drops: choose by rest-of-season market value at a position of surplus, not by this week's projection — never drop a valuable player just because he's hurt this week. An "unknown" market value means no data (usual for IR players), NOT low value — don't pick that player as the drop; if he's the only obvious cut, say it depends on whether his injury is season-ending and give a safe alternative.
- Trades: prefer ideas that help on both windows; flag "helps now, costs you later".
- News is color only, never the sole reason for a move.
- You only advise — you can't make moves. Tell the manager what to do.
- Be concise: lead with the answer, then the key numbers behind it. Use short bullets when covering multiple leagues or moves.`;

function thinkingFor(model: AdvisorModel): { type: "adaptive" } | undefined {
  return model === "claude-haiku-4-5" ? undefined : { type: "adaptive" };
}

export async function runAgent(
  question: string,
  history: ChatTurn[],
  ctx: ToolContext,
  onEvent: (e: AgentEvent) => void,
  model: AdvisorModel = DEFAULT_ADVISOR_MODEL,
): Promise<void> {
  const client = new Anthropic();
  const thinking = thinkingFor(model);
  const startedAt = Date.now();
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.text })),
    { role: "user", content: question },
  ];
  traceAgentStart(question, ADVISOR_MODELS[model]);

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      ...(thinking ? { thinking } : {}),
      system: SYSTEM,
      tools: TOOL_DEFINITIONS,
      messages,
    });
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    // Keep the assistant turn verbatim (thinking + tool_use blocks must be sent back as-is).
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    // No tool requested → the model is done; its text is the answer.
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      if (response.stop_reason === "max_tokens") {
        onEvent({ type: "error", message: "The agent ran out of room mid-answer — try a narrower question." });
      }
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      onEvent({ type: "answer", text: text || "(no answer)" });
      const ms = Date.now() - startedAt;
      traceAgentDone(text, turn, toolCalls, inputTokens, outputTokens, ms);
      onEvent({ type: "done", turns: turn, toolCalls, inputTokens, outputTokens, ms });
      return;
    }

    // Say what it decided: its one-line plan + the calls it chose.
    const plan = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    if (plan) onEvent({ type: "plan", text: plan });
    traceAgentDecide(turn, plan, toolUses.map((tu) => ({ name: tu.name, input: (tu.input ?? {}) as Record<string, unknown> })));

    // Run every requested tool (in parallel — they're independent reads) and
    // hand all results back in one user turn.
    const results = await Promise.all(
      toolUses.map(async (tu) => {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        onEvent({ type: "tool_call", id: tu.id, name: tu.name, input });
        const t0 = Date.now();
        const { content, summary, isError } = await runTool(tu.name, input, ctx);
        const ms = Date.now() - t0;
        toolCalls++;
        // ...and what came back, in one readable line.
        traceAgentResult(tu.name, summary, isError, ms);
        onEvent({ type: "tool_result", id: tu.id, name: tu.name, ok: !isError, summary, ms });
        return {
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content,
          ...(isError ? { is_error: true } : {}),
        };
      }),
    );
    messages.push({ role: "user", content: results });
  }

  onEvent({
    type: "error",
    message: `Stopped after ${MAX_TURNS} turns without a final answer — try a more specific question.`,
  });
}
