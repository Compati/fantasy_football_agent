// The advisor agent: give Claude the vetted league context and get back a
// prioritized set of concrete moves. Advise-only — it never acts.

import Anthropic from "@anthropic-ai/sdk";
import type { LeagueContext } from "@/lib/agent/context";

// Selectable advisor models (id -> display label). Sonnet 5 is the default:
// strong quality at ~60% less than Opus. Opus 5 for the sharpest takes; Haiku
// 4.5 for the cheapest/fastest.
export const ADVISOR_MODELS = {
  "claude-sonnet-5": "Sonnet 5",
  "claude-opus-5": "Opus 5",
  "claude-haiku-4-5": "Haiku 4.5",
} as const;

export type AdvisorModel = keyof typeof ADVISOR_MODELS;
export const DEFAULT_ADVISOR_MODEL: AdvisorModel = "claude-sonnet-5";

export function isAdvisorModel(m: unknown): m is AdvisorModel {
  return typeof m === "string" && m in ADVISOR_MODELS;
}

// Haiku 4.5 doesn't support adaptive thinking (it uses budget_tokens); Sonnet 5
// and Opus 5 do. Skip the thinking param on Haiku.
function thinkingFor(model: AdvisorModel): { type: "adaptive" } | undefined {
  return model === "claude-haiku-4-5" ? undefined : { type: "adaptive" };
}

export type MoveType = "start_sit" | "waiver" | "trade" | "hold";

export interface Move {
  priority: number; // 1 = do this first
  type: MoveType;
  title: string; // short imperative, e.g. "Start Bucky Irving over Travis Etienne"
  detail: string; // the reasoning, grounded in the numbers
  confidence: "high" | "medium" | "low";
}

export interface AdvisorResult {
  summary: string;
  moves: Move[];
}

const SYSTEM = `You are a sharp, no-nonsense fantasy football analyst giving a manager their weekly action plan.

You will receive a JSON context for ONE fantasy team: league format, the manager's roster, a computed optimal lineup (with projections from a consensus of sources), waiver targets with suggested FAAB bids, and FantasyCalc market values.

Your job: produce a PRIORITIZED list of concrete moves the manager should make this week. Rules:
- Ground every recommendation STRICTLY in the numbers provided. Do NOT invent injuries, news, matchups, or stats you were not given. (Injury/news feeds are not available yet — do not claim any.)
- Cover three kinds of moves where warranted:
  1. start_sit — lineup changes implied by the optimal lineup vs. what's set, and genuine close calls worth flagging.
  2. waiver — the best available adds; name the player, the suggested FAAB bid provided, and which bench player to drop (pick the lowest-projected bench player at a surplus position).
  3. trade — only if the roster clearly has a positional surplus and a need, suggest the archetype of trade to pursue (e.g. "trade WR depth for a starting RB"); keep it directional and grounded in market values. Skip if nothing stands out.
- If the lineup is already optimal and there are no strong adds, say so plainly with a single "hold" move — do not manufacture busywork.
- Be specific and concise: name players, cite projections and FAAB dollars, one or two sentences per move.
- Order moves by real impact (biggest point/roster improvement first). Assign priority 1..N.

Respond with ONLY a JSON object, no prose, no code fences, matching exactly:
{"summary": "<one sentence headline of the week's plan>", "moves": [{"priority": <int>, "type": "start_sit"|"waiver"|"trade"|"hold", "title": "<short imperative>", "detail": "<1-2 sentence rationale with numbers>", "confidence": "high"|"medium"|"low"}]}`;

function extractJson(text: string): AdvisorResult {
  let t = text.trim();
  // Strip a ```json ... ``` fence if the model added one.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  // Otherwise grab the outermost object.
  if (!t.startsWith("{")) {
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
  }
  const parsed = JSON.parse(t) as AdvisorResult;
  if (!parsed || !Array.isArray(parsed.moves)) throw new Error("Advisor returned no moves.");
  return parsed;
}

export async function generateRecommendations(
  context: LeagueContext,
  model: AdvisorModel = DEFAULT_ADVISOR_MODEL,
): Promise<AdvisorResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — add it to .env to enable recommendations.");
  }
  const client = new Anthropic();
  const thinking = thinkingFor(model);
  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    ...(thinking ? { thinking } : {}),
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(context) }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Advisor returned an empty response.");
  return extractJson(text);
}
