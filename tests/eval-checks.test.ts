import { test } from "node:test";
import assert from "node:assert/strict";
import {
  called,
  citesSurvivalProb,
  dollarsGrounded,
  finished,
  namesEverySwap,
  recoveredFromError,
  type AgentRun,
} from "@/lib/agent/eval-checks";

const run = (answer: string, calls: AgentRun["calls"] = [], errors: string[] = []): AgentRun => ({
  question: "q",
  answer,
  calls,
  turns: 2,
  errors,
});
const ok = (name: string, result: unknown) => ({ name, input: {}, content: JSON.stringify(result), isError: false });

test("dollarsGrounded flags a bid no tool returned", () => {
  const calls = [ok("get_waiver_targets", { faabRemaining: 187, targets: [{ faab: { suggestedBid: 4, range: [2, 9] } }] })];
  assert.equal(dollarsGrounded.run(run("Bid $4 (range $2–$9) of your $187.", calls)), null);
  assert.match(dollarsGrounded.run(run("Bid $25 to be safe.", calls)) ?? "", /\$25/);
  assert.match(dollarsGrounded.run(run("Bid 25 FAAB to be safe.", calls)) ?? "", /\$25/);
});

test("namesEverySwap accepts last names, flags a missing swap", () => {
  const calls = [ok("get_lineup_advice", { moveIntoLineup: ["Tyler Allgeier", "Michael Wilson"], moveToBench: ["De'Von Achane"] })];
  assert.equal(namesEverySwap.run(run("Start Allgeier and Michael Wilson; bench Achane.", calls)), null);
  assert.match(namesEverySwap.run(run("Start Allgeier over Achane.", calls)) ?? "", /Michael Wilson/);
});

test("citesSurvivalProb wants the tool's rounded percentage", () => {
  const calls = [ok("get_matchup", { type: "guillotine", survivalProb: 0.95 })];
  assert.equal(citesSurvivalProb.run(run("You're 95% to survive.", calls)), null);
  assert.ok(citesSurvivalProb.run(run("You're very safe.", calls)));
});

test("called / recoveredFromError / finished", () => {
  const err = { name: "get_lineup_advice", input: {}, content: 'No league matches "x".', isError: true };
  assert.equal(called("get_lineup_advice").run(run("a", [err])), null);
  assert.ok(called("get_matchup").run(run("a", [err])));
  assert.equal(recoveredFromError.run(run("a", [err])), null);
  assert.ok(recoveredFromError.run(run("a", [])));
  assert.ok(finished.run(run("a", [], ["Stopped after 10 turns"])));
  assert.ok(finished.run(run("(no answer)")));
});
