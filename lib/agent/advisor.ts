// The advisor agent: give Claude the vetted league context and get back a
// prioritized set of concrete moves. Advise-only — it never acts.

import Anthropic from "@anthropic-ai/sdk";
import type { LeagueContext } from "@/lib/agent/context";
import { traceReason, traceDecide } from "@/lib/agent/trace";

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
- Ground every recommendation STRICTLY in the numbers provided. Do NOT invent news, matchups, or stats you were not given.
- Injury designations ARE provided in "injuries" (and ruled-out players are already set to 0 projection). Factor them in: a started player who is Out/Doubtful/IR is a top-priority fix; flag Questionable starters. Do not claim any injury not listed there.
- Cover three kinds of moves where warranted:
  1. start_sit — lineup changes implied by the optimal lineup vs. what's set, and genuine close calls worth flagging.
  2. waiver — the best available adds; name the player, the suggested FAAB bid provided, and which bench player to drop (pick the lowest-projected bench player at a surplus position).
  3. trade — only if the roster clearly has a positional surplus and a need, suggest the archetype of trade to pursue (e.g. "trade WR depth for a starting RB"); keep it directional and grounded in market values. Skip if nothing stands out.
- If a "survival" section is present this is a GUILLOTINE (play-the-field) league: there is NO head-to-head opponent, and the single lowest weekly total is eliminated. Optimize purely to maximize this week's projected total — every start/sit point matters more than usual, and upside plays are worth more when your cushion is thin. Reference the cushion above the elimination line and the survival probability, and raise urgency (and confidence on lineup fixes) when the cushion is small or negative. Do NOT talk about beating a specific opponent.
- Use "outlook" for roster construction: if a position is thin (no bench behind the dedicated starters) or a near-term bye leaves a starting slot unfilled ("nextByeCrunchWeek"), prioritize a waiver add or trade to shore it up, and name the week. Don't invent byes not listed there.
- "news" (may be empty) is a short list of real Reddit/YouTube items already matched to a specific rostered or waiver-relevant player — use it only to add real-world color to a move you're already making for numeric reasons (e.g. "and Reddit's buzzing about his role" citing the source), never as the sole reason to start/sit or add someone, and never repeat more than the gist of a title/summary. Do not reference "news" items about players who aren't already part of your recommendation.
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
  const startedAt = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    ...(thinking ? { thinking } : {}),
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(context) }],
  });

  // The model's reasoning comes back as "thinking" blocks (when enabled). We
  // don't store it, but we surface it to the terminal trace before dropping it.
  const reasoning = response.content
    .filter((b): b is Anthropic.ThinkingBlock => b.type === "thinking")
    .map((b) => b.thinking)
    .join("\n");
  traceReason(reasoning);

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Advisor returned an empty response.");

  const result = extractJson(text);
  traceDecide(
    result,
    response.usage ? { input: response.usage.input_tokens, output: response.usage.output_tokens } : null,
    Date.now() - startedAt,
  );
  return result;
}
