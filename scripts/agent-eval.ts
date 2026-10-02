// Eval set for the agent: a fixed list of questions with known-correct
// properties, each scored two ways — code checks (lib/agent/eval-checks.ts) for
// what can be stated exactly, and an LLM judge (lib/agent/judge.ts) for what
// needs reading. A case passes only if every code check AND every judge
// criterion passes; the run passes at PASS_THRESHOLD. Exit code 1 below it, so
// a prompt or tool change that makes the agent worse shows up as a failure.
//
//   npx tsx scripts/agent-eval.ts                  all cases, Sonnet 5 agent, Opus 5 judge
//   npx tsx scripts/agent-eval.ts bad-league faab  only these cases
//   npx tsx scripts/agent-eval.ts --model claude-haiku-4-5
//   npx tsx scripts/agent-eval.ts --no-judge       code checks only (cheaper)
//   npx tsx scripts/agent-eval.ts --trace          print each run's tool calls (runs one at a time)
//
// Runs against the live local DB (my real leagues), so refresh data first:
// npx tsx scripts/phase2-check.ts. Full results go to evals/results/ (gitignored).
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { runAgent } from "@/lib/agent/loop";
import { ADVISOR_MODELS, DEFAULT_ADVISOR_MODEL, isAdvisorModel, type AdvisorModel } from "@/lib/agent/advisor";
import { judgeRun, JUDGE_CRITERIA, JUDGE_MODEL, type Judgment } from "@/lib/agent/judge";
import * as c from "@/lib/agent/eval-checks";
import type { AgentRun, Check } from "@/lib/agent/eval-checks";

const PASS_THRESHOLD = 0.8;
const CONCURRENCY = 3;

interface EvalCase {
  id: string;
  question: string;
  checks: Check[];
  expect: string; // case-specific standard for the judge
}

// Real names from the DB so the cases survive roster changes.
async function buildCases(userId: string): Promise<EvalCase[]> {
  const teams = await prisma.team.findMany({
    where: { isMine: true, league: { connection: { userId } } },
    include: { league: { include: { teams: { include: { roster: true } } } }, roster: true },
  });
  const leagueNames = teams.map((t) => t.league.name);
  const find = (part: string) => {
    const t = teams.find((x) => x.league.name.toLowerCase().includes(part.toLowerCase()));
    if (!t) throw new Error(`Eval set expects a league matching "${part}" (have: ${leagueNames.join(", ")})`);
    return t;
  };
  const escalated = find("Escalated");
  const panini = find("Panini");
  const guillotine = find("Guillotine");

  // A 1-for-1 trade with real players: my first bench RB/WR for another team's.
  const skill = (r: { position: string; sleeperId: string | null }) => ["RB", "WR"].includes(r.position) && r.sleeperId;
  const mine = escalated.roster.filter(skill).sort((a, b) => a.name.localeCompare(b.name))[0];
  const theirs = escalated.league.teams
    .filter((t) => !t.isMine)
    .flatMap((t) => t.roster.filter(skill))
    .sort((a, b) => a.name.localeCompare(b.name))[0];

  return [
    {
      id: "cross-league",
      question: "Which of my leagues needs the most attention this week, and why?",
      checks: [c.finished, c.called("list_my_leagues"), c.calledAnyOf("get_lineup_advice", "get_matchup"), c.maxToolCalls(12), c.answerMentionsAny(leagueNames, "names a league")],
      expect: `Picks ONE league as needing the most attention and justifies it by comparing numbers across the leagues (points left on the bench, win/survival probability, injured starters). It must have looked at all ${teams.length} leagues before choosing.`,
    },
    {
      id: "partial-league-name",
      question: "Who should I start in Escalated this week?",
      checks: [c.finished, c.called("get_lineup_advice"), c.noToolErrors, c.namesEverySwap, c.maxToolCalls(5)],
      expect: `Resolves "Escalated" to "${escalated.league.name}" without asking. Names every moveIntoLineup / moveToBench swap the tool returned with projections; if both lists are empty, says the lineup is already optimal.`,
    },
    {
      id: "bad-league",
      question: "How does my lineup look in the Dynasty Kings league?",
      checks: [c.finished, c.answerMentionsAny(leagueNames, "lists a real league"), c.maxToolCalls(4)],
      expect: `The manager has no league called "Dynasty Kings". The answer must say so and list the real leagues (${leagueNames.join(", ")}). It must NOT silently analyze a different league as if it were Dynasty Kings.`,
    },
    {
      id: "faab-bid",
      question: `Who's the best RB on waivers in ${panini.league.name}, and how much should I bid?`,
      checks: [c.finished, c.calledAnyOf("get_waiver_targets", "lookup_player"), c.dollarsGrounded, c.maxToolCalls(6)],
      expect: "Names one RB that a tool returned as available, with his projection and a FAAB bid equal to the tool's suggestedBid or inside its range. If the tool returned no FAAB data for him, says so rather than inventing a bid.",
    },
    {
      id: "drop-candidate",
      question: `I need to open one roster spot in ${escalated.league.name}. Who should I drop?`,
      checks: [c.finished, c.called("get_lineup_advice"), c.maxToolCalls(8)],
      expect: 'Recommends dropping a bench player with a low NUMERIC market value and cites that value. It must not recommend a player whose marketValue came back "unknown", and must not pick the drop by this week\'s projection alone (e.g. an injured player with a meaningful value).',
    },
    {
      id: "trade-eval",
      question: `In ${escalated.league.name}, should I trade ${mine?.name} for ${theirs?.name}?`,
      checks: [c.finished, c.called("evaluate_trade"), c.answerMatches(/\b(yes|no|accept|decline|reject|pass|don't|do it|take it|favors)\b/i, "gives a verdict")],
      expect: "Gives a clear yes/no grounded in the evaluate_trade result: cites both sides' market values (or the totals / percentage difference) and is consistent with the tool's verdict. If a value was missing or estimated, it says so.",
    },
    {
      id: "unknown-player",
      question: "What's Zzyzx Fakeman projected for this week?",
      checks: [c.finished, c.called("lookup_player"), c.recoveredFromError, c.maxToolCalls(4)],
      expect: "No such player exists. The answer must say he couldn't be found and must not give a projection, team or position for him.",
    },
    {
      id: "advise-only",
      question: `Go ahead and put in a waiver claim for the best available WR in ${panini.league.name} for me.`,
      checks: [c.finished, c.answerMatches(/can't|cannot|can only|unable|not able|only advise|don't have the ability|you'll need to|you will need to/i, "says it can't make moves"), c.dollarsGrounded],
      expect: "Makes clear it cannot place the claim (advise-only) and does not imply the claim was submitted. Ideally still tells the manager who to claim and for how much, using tool data.",
    },
    {
      id: "guillotine-survival",
      question: "Am I in danger of getting eliminated in my Guillotine league this week?",
      checks: [c.finished, c.called("get_matchup"), c.citesSurvivalProb, c.maxToolCalls(6)],
      expect: `Resolves "Guillotine" to "${guillotine.league.name}". Answers yes/no on elimination danger citing the survival probability, the cushion over the elimination line and rank. It must not talk about beating a head-to-head opponent.`,
    },
  ];
}

interface CaseResult {
  id: string;
  run: AgentRun;
  toolCalls: number;
  ms: number;
  tokens: { input: number; output: number };
  checks: { name: string; fail: string | null }[];
  judgment: Judgment | null;
  judgeError?: string;
  pass: boolean;
}

async function runCase(ec: EvalCase, userId: string, model: AdvisorModel, judge: boolean): Promise<CaseResult> {
  const run: AgentRun = { question: ec.question, answer: "", calls: [], turns: 0, errors: [] };
  let ms = 0;
  const tokens = { input: 0, output: 0 };
  try {
    await runAgent(
      ec.question,
      [],
      { userId },
      (e) => {
        if (e.type === "answer") run.answer = e.text;
        else if (e.type === "error") run.errors.push(e.message);
        else if (e.type === "done") {
          run.turns = e.turns;
          ms = e.ms;
          tokens.input = e.inputTokens;
          tokens.output = e.outputTokens;
        }
      },
      model,
      (call) => run.calls.push(call),
    );
  } catch (e) {
    run.errors.push(`run crashed: ${(e as Error).message}`);
  }

  const checks = c.runChecks(run, ec.checks);
  let judgment: Judgment | null = null;
  let judgeError: string | undefined;
  if (judge && run.answer) {
    try {
      judgment = await judgeRun(run, ec.expect);
    } catch (e) {
      judgeError = (e as Error).message;
    }
  }
  const codeOk = checks.every((k) => !k.fail);
  const judgeOk = !judge || (judgment != null && JUDGE_CRITERIA.every((k) => judgment[k].pass));
  return { id: ec.id, run, toolCalls: run.calls.length, ms, tokens, checks, judgment, judgeError, pass: codeOk && judgeOk };
}

function report(r: CaseResult) {
  console.log(`\n${r.pass ? "✅ PASS" : "❌ FAIL"}  ${r.id}  ·  ${r.run.turns} turn(s), ${r.toolCalls} tool call(s), ${(r.ms / 1000).toFixed(1)}s`);
  console.log(`   Q: ${r.run.question}`);
  console.log(`   tools: ${r.run.calls.map((k) => k.name + (k.isError ? "⚠" : "")).join(" → ") || "(none)"}`);
  for (const k of r.checks) console.log(`   ${k.fail ? "✗" : "✓"} code   ${k.name}${k.fail ? ` — ${k.fail}` : ""}`);
  if (r.judgment) {
    for (const k of JUDGE_CRITERIA) {
      const v = r.judgment[k];
      console.log(`   ${v.pass ? "✓" : "✗"} judge  ${k}${v.pass ? "" : ` — ${v.evidence}`}`);
    }
  } else if (r.judgeError) console.log(`   ✗ judge  failed to run — ${r.judgeError}`);
  if (!r.pass) console.log(`   answer: ${r.run.answer.replace(/\s+/g, " ").slice(0, 400)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (f: string) => args.includes(f);
  const modelArg = args[args.indexOf("--model") + 1];
  const model = flag("--model") && isAdvisorModel(modelArg) ? modelArg : DEFAULT_ADVISOR_MODEL;
  const judge = !flag("--no-judge");
  const trace = flag("--trace");
  const only = args.filter((a) => !a.startsWith("--") && a !== modelArg);
  process.env.ADVISOR_TRACE = trace ? "1" : "0";

  const conn = await prisma.connection.findFirstOrThrow({ where: { platform: "sleeper" } });
  const all = await buildCases(conn.userId);
  const cases = only.length ? all.filter((k) => only.includes(k.id)) : all;
  if (!cases.length) throw new Error(`No such case. Cases: ${all.map((k) => k.id).join(", ")}`);

  console.log(`\n📋 AGENT EVAL · ${cases.length} case(s) · agent: ${ADVISOR_MODELS[model]} · judge: ${judge ? ADVISOR_MODELS[JUDGE_MODEL] : "off"}`);

  // A small worker pool; results are reported in case order once all are in.
  const results: CaseResult[] = new Array(cases.length);
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const i = next++;
      results[i] = await runCase(cases[i], conn.userId, model, judge);
      console.log(`   … ${cases[i].id} ${results[i].pass ? "pass" : "FAIL"}`);
    }
  };
  await Promise.all(Array.from({ length: trace ? 1 : CONCURRENCY }, worker));
  results.forEach(report);

  const passed = results.filter((r) => r.pass).length;
  const rate = passed / results.length;
  const sum = (f: (r: CaseResult) => number) => results.reduce((a, r) => a + f(r), 0);
  const ok = rate >= PASS_THRESHOLD;
  console.log(
    `\n${ok ? "✅" : "❌"} ${passed}/${results.length} cases passed (${Math.round(rate * 100)}%, threshold ${PASS_THRESHOLD * 100}%)` +
      ` · agent tokens ${sum((r) => r.tokens.input).toLocaleString()} in / ${sum((r) => r.tokens.output).toLocaleString()} out`,
  );

  mkdirSync("evals/results", { recursive: true });
  const file = `evals/results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify({ model, judge: judge ? JUDGE_MODEL : null, passed, total: results.length, results }, null, 2));
  console.log(`   full transcripts: ${file}`);
  if (!ok) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
