// LLM-as-a-judge: a second model grades one agent run against a written
// standard. It sees what the agent saw (the question, every tool call with its
// full output) plus the answer, and must quote evidence for each verdict.
//
// The judge is a different model from the agent by default (Opus grading
// Sonnet), so it doesn't share the exact blind spots of the thing it grades.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { AdvisorModel } from "@/lib/agent/advisor";
import type { AgentRun } from "@/lib/agent/eval-checks";
import { TOOL_DEFINITIONS } from "@/lib/agent/tools";

export const JUDGE_MODEL: AdvisorModel = "claude-opus-5";
const MAX_TOKENS = 8000;

const Verdict = z.object({
  pass: z.boolean(),
  evidence: z.string().describe("One sentence quoting the answer and/or the tool output that decides it"),
});
const JudgeSchema = z.object({
  grounded: Verdict.describe("Every number, player, injury, bid and news item in the answer appears in a tool result"),
  followsRules: Verdict.describe("None of the agent's rules (listed in the standard) is broken"),
  answersQuestion: Verdict.describe("Leads with a direct, actionable answer to what was asked"),
  meetsExpectation: Verdict.describe("Does what this specific case expects"),
});
export type Judgment = z.infer<typeof JudgeSchema>;
export const JUDGE_CRITERIA = ["grounded", "followsRules", "answersQuestion", "meetsExpectation"] as const;

const SYSTEM = `You are grading a fantasy football assistant. You get the descriptions of the tools the assistant had, the manager's question, the tool calls the assistant made with the exact results it received, and its final answer. The tool results are the ONLY source of truth about the manager's leagues; the tool descriptions say what the returned fields mean, and the assistant may repeat those meanings (e.g. what the high end of a bid range represents).

Grade four criteria, each pass/fail with one sentence of evidence:

1. grounded — every number, player, injury, bid and news item in the answer appears in a tool result. Arithmetic on returned numbers (a difference, a sum) is fine if correct, and so is explaining a field the way its tool description does. Any invented or misquoted figure fails.
2. followsRules — the assistant's rules:
   - FAAB bids: only the suggestedBid or a number inside the range a tool returned; never higher.
   - Drops: chosen by rest-of-season market value, not this week's projection. A player whose market value is "unknown" must NOT be the recommended drop (unknown = no data, usual for IR players, not low value).
   - Start/sit: no override of a projection on matchup grounds; matchup and news are color only.
   - Lineup: when a tool returned moveIntoLineup / moveToBench, the answer must not call the lineup optimal, and must not describe those moves backwards (moveToBench = currently starting, should sit).
   - Advise-only: never claims to have made, or to be able to make, a move.
   Rules that don't apply to this question pass.
3. answersQuestion — leads with a direct answer to what was asked and is specific enough to act on. Honestly saying something couldn't be found is a direct answer.
4. meetsExpectation — the case-specific expectation given with the run.

Be strict and literal. Do not give credit for things the answer could have meant. If a criterion fails, the evidence must quote the offending text.`;

export async function judgeRun(run: AgentRun, expectation: string, model: AdvisorModel = JUDGE_MODEL): Promise<Judgment> {
  const client = new Anthropic();
  const transcript = run.calls
    .map((c, i) => `#${i + 1} ${c.name}(${JSON.stringify(c.input)})${c.isError ? " → ERROR" : ""}\n${c.content}`)
    .join("\n\n");
  const response = await client.messages.parse({
    model,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content:
          // The first run failed two answers for "inventing" the ~80% win rate of a
          // range's high end — it's in the tool description, which the judge couldn't see.
          `<tool_descriptions>\n${TOOL_DEFINITIONS.map((t) => `${t.name}: ${t.description}`).join("\n")}\n</tool_descriptions>\n\n` +
          `<question>\n${run.question}\n</question>\n\n` +
          `<tool_calls>\n${transcript || "(none)"}\n</tool_calls>\n\n` +
          `<answer>\n${run.answer}\n</answer>\n\n` +
          `<case_expectation>\n${expectation}\n</case_expectation>`,
      },
    ],
    output_config: { format: zodOutputFormat(JudgeSchema) },
  });
  if (!response.parsed_output) throw new Error(`Judge returned no verdict (stop_reason: ${response.stop_reason}).`);
  return response.parsed_output;
}
