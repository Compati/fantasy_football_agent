// The advisor agent: give Claude the vetted league context and get back a
// prioritized set of concrete moves. Advise-only — it never acts.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
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

// The response shape, enforced by structured outputs (the API guarantees the
// JSON matches — no hand-parsing, no half-formed objects).
const MoveSchema = z.object({
  priority: z.number().int().describe("1 = do this first"),
  type: z.enum(["start_sit", "waiver", "trade", "hold"]),
  title: z.string().describe('Short imperative, e.g. "Start Bucky Irving over Travis Etienne"'),
  detail: z.string().describe("1-2 sentence rationale grounded in the numbers"),
  confidence: z.enum(["high", "medium", "low"]),
});
const AdvisorResultSchema = z.object({
  summary: z.string().describe("One-sentence headline of the week's plan"),
  moves: z.array(MoveSchema),
});

export type Move = z.infer<typeof MoveSchema>;
export type MoveType = Move["type"];
export type AdvisorResult = z.infer<typeof AdvisorResultSchema>;

// Room for adaptive thinking plus the answer. The old 4000 cap let thinking
// crowd out the reply, truncating the JSON mid-string on longer plans.
const MAX_TOKENS = 16000;

const SYSTEM = `You are a sharp, no-nonsense fantasy football analyst giving a manager their weekly action plan.

You will receive a JSON context for ONE fantasy team: league format, the manager's roster, a computed optimal lineup (with projections from a consensus of sources), waiver targets with suggested FAAB bids, FantasyCalc market values, and (when available) YouTube community context and sportsbook player props.

Your job: produce a PRIORITIZED list of concrete moves the manager should make this week. Rules:
- Ground every recommendation STRICTLY in the numbers provided. Do NOT invent news, matchups, or stats you were not given.
- Injury designations ARE provided in "injuries" (and ruled-out players are already set to 0 projection). Factor them in: a started player who is Out/Doubtful/IR is a top-priority fix; flag Questionable starters. Do not claim any injury not listed there.
- Cover three kinds of moves where warranted:
  1. start_sit — lineup changes implied by the optimal lineup vs. what's set, and genuine close calls worth flagging. If shouldStart/shouldSit are non-empty, ALWAYS include a start_sit move naming each swap, however small the gain (it's free points) — never describe the current lineup as already optimal when they are non-empty.
  2. waiver — the best available adds; name the player, the suggestedBid provided (and its faabRange — calibrated on this league's real bids: the low end is the median winning bid (wins about half the time), the high end wins ~80% of the time; never invent a higher number. hotAdd/contestedShare say how likely a fight is), and which bench player to drop. Choose drops by rest-of-season worth, not this week: pick from positions where you have surplus, the bench player with the lowest marketValue (break ties by lower proj). NEVER drop a player just because he is injured or projects 0 this week if his marketValue is meaningful relative to the rest of the bench — a Doubtful/Out starter is a lineup problem, not a drop candidate. Cite the marketValue when you name the drop.
  3. trade — use "tradeIdeas": concrete offers already checked to be fair by market value AND to improve both lineups, found on two windows — nearTerm (next few weeks) and restOfSeason (through the league's final week, playoffs included). Every idea also reports the same swap on the other window (otherWindow* fields; gains are TOTALS over a window, not per week, and can be negative). Prefer trades that are positive on BOTH windows. Call out a nearTerm idea whose otherWindowYourGainPtsTotal is negative as "helps now, costs you later", and a restOfSeason idea that costs you in the near term as a slow burn. Weigh by situation: a Guillotine team on the bubble or a team fighting for a playoff spot can justify near-term gains; a comfortable team should favor the rest-of-season view. If both lists are empty, do not invent a specific offer; at most mention a directional idea with low confidence, or skip trades.
- If a "survival" section is present this is a GUILLOTINE (play-the-field) league: there is NO head-to-head opponent, and the single lowest weekly total is eliminated. Optimize purely to maximize this week's projected total — every start/sit point matters more than usual, and upside plays are worth more when your cushion is thin. Reference the cushion above the elimination line and the survival probability, and raise urgency (and confidence on lineup fixes) when the cushion is small or negative. Do NOT talk about beating a specific opponent.
- Use "outlook" for roster construction: if a position is thin (no bench behind the dedicated starters) or a near-term bye leaves a starting slot unfilled ("nextByeCrunchWeek"), prioritize a waiver add or trade to shore it up, and name the week. Don't invent byes not listed there.
- "news" (may be empty) is a short list of real YouTube items already matched to a specific rostered or waiver-relevant player — use it only to add real-world color to a move you're already making for numeric reasons, never as the sole reason to start/sit or add someone, and never repeat more than the gist of a title/summary. Do not reference "news" items about players who aren't already part of your recommendation.
- "props" (may be empty) is real sportsbook lines for some rostered/waiver-relevant players: passYdsLine, rushYdsLine, recYdsLine (yardage O/U points), anytimeTdProb (0-1, implied from the anytime-TD price). Use it only as a cross-check alongside the projection — e.g. a market yardage line notably above or below the consensus projection is worth a one-line mention, and a high anytimeTdProb strengthens (never replaces) a start/waiver case already justified by the numbers. Never state a prop figure for a player not present in "props", and never treat a prop as a projection in its own right.
- Opponent context: each recommendedLineup entry may carry opponent, matchup ("great"|"good"|"neutral"|"hard"|"tough"), impliedTotal (Vegas expected points for the player's team; for a DEF, the opposing offense's), and oppVsPosition (a plain-English note on how many fantasy points the opponent has allowed to that position this season — small early-season sample). The projections ALREADY account for matchups, and a backtest showed that overriding a projection with a matchup read made start/sit calls worse. So never recommend starting or sitting anyone on matchup grounds — not even on a close call; on close calls, go with the higher projection. Use matchup only as one-line color on a move you're already making.
- If the lineup is already optimal and there are no strong adds, say so plainly with a single "hold" move — do not manufacture busywork.
- Be specific and concise: name players, cite projections and FAAB dollars, one or two sentences per move.
- Order moves by real impact (biggest point/roster improvement first). Assign priority 1..N.
- Return a one-sentence summary headline and the prioritized moves.`;

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
  const response = await client.messages.parse({
    model,
    max_tokens: MAX_TOKENS,
    ...(thinking ? { thinking } : {}),
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(context) }],
    output_config: { format: zodOutputFormat(AdvisorResultSchema) },
  });
  if (response.stop_reason === "max_tokens") {
    throw new Error(`Advisor ran out of room (${MAX_TOKENS} tokens) before finishing — try again or pick another model.`);
  }
  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to produce recommendations for this request.");
  }

  // The model's reasoning comes back as "thinking" blocks (when enabled). We
  // don't store it, but we surface it to the terminal trace before dropping it.
  const reasoning = response.content
    .filter((b): b is Anthropic.ThinkingBlock => b.type === "thinking")
    .map((b) => b.thinking)
    .join("\n");
  traceReason(reasoning);

  const result = response.parsed_output;
  if (!result) throw new Error("Advisor returned a response that didn't match the expected shape.");
  traceDecide(
    result,
    response.usage ? { input: response.usage.input_tokens, output: response.usage.output_tokens } : null,
    Date.now() - startedAt,
  );
  return result;
}
