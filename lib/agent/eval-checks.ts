// Code checks for the agent eval set (scripts/agent-eval.ts). Pure functions
// over one recorded run, so they're unit-tested without calling a model. Each
// returns null when the run passes, or a one-line reason when it doesn't.
//
// Code checks catch what can be stated exactly (did it call the tool? is every
// dollar figure one a tool returned?). The judgment calls (was the drop
// sensible? did it answer the question?) go to the LLM judge instead.

import type { ToolRecord } from "@/lib/agent/loop";

export interface AgentRun {
  question: string;
  answer: string;
  calls: ToolRecord[];
  turns: number;
  errors: string[]; // loop-level errors (turn cap, max_tokens)
}

export type Check = { name: string; run: (r: AgentRun) => string | null };

const lower = (s: string) => s.toLowerCase();

// Tool outputs of one tool, parsed (error results are plain text → skipped).
function outputsOf(run: AgentRun, tool: string): Record<string, unknown>[] {
  return run.calls
    .filter((c) => c.name === tool && !c.isError)
    .map((c) => JSON.parse(c.content) as Record<string, unknown>);
}

export const finished: Check = {
  name: "finished cleanly",
  run: (r) => (r.errors.length ? r.errors[0] : r.answer && r.answer !== "(no answer)" ? null : "no answer"),
};

export const called = (tool: string, min = 1): Check => ({
  name: `called ${tool}${min > 1 ? ` ×${min}+` : ""}`,
  run: (r) => {
    const n = r.calls.filter((c) => c.name === tool).length;
    return n >= min ? null : `${tool} called ${n} time(s), expected ${min}+`;
  },
});

export const calledAnyOf = (...tools: string[]): Check => ({
  name: `called ${tools.join(" or ")}`,
  run: (r) => (r.calls.some((c) => tools.includes(c.name)) ? null : `none of ${tools.join(", ")} was called`),
});

export const maxToolCalls = (max: number): Check => ({
  name: `≤ ${max} tool calls`,
  run: (r) => (r.calls.length <= max ? null : `${r.calls.length} tool calls`),
});

// The model hit a tool error (e.g. unknown league) and kept going to an answer.
export const recoveredFromError: Check = {
  name: "hit a tool error and recovered",
  run: (r) => (r.calls.some((c) => c.isError) ? null : "no tool error occurred (the bad input was never tried)"),
};

export const noToolErrors: Check = {
  name: "no tool errors",
  run: (r) => {
    const bad = r.calls.find((c) => c.isError);
    return bad ? `${bad.name} errored: ${bad.content.slice(0, 80)}` : null;
  },
};

export const answerMatches = (re: RegExp, what: string): Check => ({
  name: what,
  run: (r) => (re.test(r.answer) ? null : `answer doesn't match ${re}`),
});

export const answerMentionsAny = (terms: string[], what: string): Check => ({
  name: what,
  run: (r) => (terms.some((t) => lower(r.answer).includes(lower(t))) ? null : `none of [${terms.join(", ")}] in the answer`),
});

// Every "$N" / "N FAAB" in the answer must be a number some tool returned — the
// prompt's "never a higher bid than the tools gave" rule, checked literally.
export const dollarsGrounded: Check = {
  name: "every $/FAAB amount came from a tool",
  run: (r) => {
    const seen = new Set<number>();
    for (const c of r.calls) for (const m of c.content.matchAll(/\d+(?:\.\d+)?/g)) seen.add(Number(m[0]));
    const bad = [...r.answer.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*FAAB/gi)]
      .map((m) => Number((m[1] ?? m[2]).replace(/,/g, "")))
      .filter((n) => !seen.has(n));
    return bad.length ? `ungrounded amounts: ${[...new Set(bad)].map((n) => "$" + n).join(", ")}` : null;
  },
};

// Every swap the lineup tool asked for is named in the answer (full name, or
// last name — answers often shorten on second mention).
export const namesEverySwap: Check = {
  name: "names every lineup swap",
  run: (r) => {
    const outs = outputsOf(r, "get_lineup_advice");
    if (!outs.length) return "get_lineup_advice never returned";
    const a = lower(r.answer);
    const missing = outs
      .flatMap((o) => [...((o.moveIntoLineup as string[]) ?? []), ...((o.moveToBench as string[]) ?? [])])
      .filter((name) => !a.includes(lower(name)) && !a.includes(lower(name.split(" ").slice(-1)[0])));
    return missing.length ? `not mentioned: ${missing.join(", ")}` : null;
  },
};

// The answer quotes the Guillotine survival probability the tool returned.
export const citesSurvivalProb: Check = {
  name: "cites the tool's survival %",
  run: (r) => {
    const g = outputsOf(r, "get_matchup").find((o) => o.type === "guillotine" && typeof o.survivalProb === "number");
    if (!g) return "no guillotine matchup result";
    const pct = Math.round((g.survivalProb as number) * 100);
    return new RegExp(`\\b${pct}(\\.\\d+)?\\s?%`).test(r.answer) ? null : `${pct}% not in the answer`;
  },
};

export function runChecks(run: AgentRun, checks: Check[]): { name: string; fail: string | null }[] {
  return checks.map((c) => {
    try {
      return { name: c.name, fail: c.run(run) };
    } catch (e) {
      return { name: c.name, fail: `check crashed: ${(e as Error).message}` };
    }
  });
}
