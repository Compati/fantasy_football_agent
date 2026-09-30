# The agent: how it works and why

Notes for the class mini-project (presented Oct 12, 5 min + Q&A). Rubric: working agent · understanding ·
explanation · real problem.

## The problem

I play in several Sleeper leagues with different formats (14-team PPR, 15-team superflex Guillotine),
and every week each one needs lineup, waiver/FAAB, and trade decisions. The data is scattered
(Sleeper, ESPN, CBS, FFToday projections; FantasyCalc values; Vegas lines; league FAAB history), so the
decisions were being made on gut feel and the easy mistakes (an IR player left in a lineup, overbidding
FAAB 10x) slipped through.

## Two designs in the app — and why both exist

### 1. Weekly plan = a fixed pipeline ("workflow")

`Generate` button → `buildLeagueContext()` (`lib/agent/context.ts`) → one Claude call
(`lib/agent/advisor.ts`, structured output) → prioritized moves.

My code decides what to fetch: every feature runs, every time, in the same order, and Claude
summarizes the pile once. Good for a routine "give me everything for this league": predictable,
one call, cheap. But it's **not an agent** — the model never chooses anything.

### 2. "Ask the agent" = a real agent loop

`/agent` page → `app/api/agent/route.ts` → `runAgent()` (`lib/agent/loop.ts`), hand-rolled:

```
messages = [question]
loop (max 10 turns):
  response = claude.messages.create({ system, tools, messages })
  if no tool requested: return the text        ← the model decided it's done
  run each requested tool (in parallel)         ← our code, lib/agent/tools.ts
  append the tool results to messages           ← the model sees what it asked for
```

Claude gets a **toolbox**, not the data, and decides which tools to call, in what order, and when it
has enough. The tools are thin read-only wrappers around feature functions that already existed:

| Tool | Wraps |
|---|---|
| `list_my_leagues` | Prisma: my teams, formats, record, FAAB left, current week |
| `get_lineup_advice` | `startSitForTeam` (+ bench market values for drop decisions) |
| `get_matchup` | `getMatchup` / `getSurvival` (Guillotine) |
| `get_waiver_targets` | `waiverTargets` (FAAB bids calibrated on the league's real bids) |
| `lookup_player` | player search + availability / value / FAAB in a league |
| `get_trade_ideas` | `tradeIdeasForTeam` (fair + both lineups improve, near vs ROS) |
| `evaluate_trade` | `evaluateTrade` (market-value verdict) |
| `get_roster_outlook` | `rosterOutlook` (byes, thin positions) |
| `get_player_news` | `newsForPlayers` (YouTube, color only) |

Why both: the pipeline is the cheap, predictable choice for a fixed job; the agent handles open-ended
and cross-league questions no fixed pipeline anticipates ("which of my leagues needs the most
attention?"), at the cost of several model calls per answer.

## Agent vs. chatbot (for Q&A)

The chat box is just the interface. What's behind it:

- **Chatbot:** question → model → answer. Knows only its training data; it *talks about* your problem
  (generic or invented specifics).
- **Agent:** goal → model picks a step → uses a tool → sees the result → picks the next step → … →
  answer. It *works on* your problem.

| Trait | Chatbot | This agent |
|---|---|---|
| Uses tools to reach outside itself | no | live rosters, projections, waivers, trade math |
| Chooses its own steps | no | picks tools + order |
| Adapts to what it finds | no | e.g. sees an RB is on IR → checks bench depth |
| Decides when it's done | always one reply | loops until it has enough |

Anthropic's "Building Effective Agents" draws the same line: a **workflow** runs LLMs + tools through
predefined code paths; an **agent** is where the LLM dynamically directs its own process and tool use.

**Test:** remove the tools. A chatbot still answers (worse); the agent can't do its job.

**Spectrum:** chatbot → chatbot + retrieval → fixed pipeline (weekly plan) → tool-using agent
(Ask the agent) → autonomous agent (runs on a schedule, no prompt — possible next step: a Wednesday
cron gives the same loop the goal "check all my leagues, alert me if anything's urgent").

## Guardrails

- **Advise-only:** every tool is read-only; the agent cannot touch Sleeper.
- **Grounded:** the system prompt requires citing only numbers tools returned; FAAB bids only from
  the calibrated range.
- **Bounded:** 10-turn cap, 8k tokens per call; tool errors (bad league name, unknown player) go back
  to the model as `is_error` results so it can correct itself instead of crashing.
- **Backtest-informed rules:** projections already include matchups (a 10.8k-game backtest showed
  matchup overrides made start/sit worse), so the agent is told not to override on matchup.

## Things found while building it (good "understanding" material)

- **Null ≠ low.** The agent recommended dropping De'Von Achane because his market value came back
  `null` — it read "no data" as "value collapsed". FantasyCalc drops IR players from its list. Fix:
  tools now say `"unknown (no market data — typical for IR players; not the same as low value)"` and
  the prompt says never to drop on an unknown value. Re-run: it correctly dropped the 3rd QB (value 47).
- **Tool design shapes behavior.** Without bench market values in `get_lineup_advice`, the agent spent
  an extra turn calling `lookup_player` four times to get them. Adding the field: 7 tool calls → 4.
- **Parallel tool use.** Asked "which league needs the most attention?", it called `list_my_leagues`,
  then fired 6 calls at once (lineup + matchup × 3 leagues) and compared — 3 turns, ~14 s.

## Running it

- UI: `npm run dev` → dashboard → **Ask the agent →** (tool calls stream in live as the agent works).
- Terminal: `npx tsx scripts/agent-check.ts "your question" [model]` (prints each tool call + answer);
  `npx tsx scripts/agent-check.ts --tools` smoke-tests every tool with no LLM calls.
- Needs `ANTHROPIC_API_KEY` in `.env`; fresh data via `npx tsx scripts/phase2-check.ts`.

## From pipeline to agent: how it got here

The project didn't start as an agent. It became one in stages, and each stage was verified before the
next was built on top of it.

**Stage 1: deterministic tools first (Phases 0–2, Sep 19).** Data layer (Sleeper rosters, Sleeper +
ESPN projections, FantasyCalc values), then plain-code decision features: start/sit optimizer, waiver
ranking with FAAB bids, trade analyzer. No AI at all. Every feature was checked against my 3 real
leagues (e.g. 0 unresolved players on ingest).

**Stage 2: an LLM wrapper (Phase 3, Sep 20).** `advisor.ts`: my code gathers *everything*
(`buildLeagueContext`) → one JSON blob → one Claude call → prioritized moves. Useful, but the model
only summarizes; **my code makes every decision about what to look at.** It's a pipeline with an LLM
at the end.

**Stage 3: widen and deepen the tools (Sep 20–26).** Injuries, matchups, Guillotine survival, byes,
YouTube news, sportsbook props, 4-source projection consensus, opponent context, FAAB bids calibrated
on real league bids (incl. past seasons), trade finder. Each fed into the same one-shot context.

**Stage 4: verify the wrapper (Sep 26).** This is where most of the real bugs surfaced:
- A **backtest** of the decision features (`scripts/backtest.ts`): 4-source blend beat 2-source
  (MAE 4.96 vs 5.06); the "matchup lean" idea *lost* (underdog won 47–48% over 10.8k close calls) →
  removed. FAAB bids were ~10–15x too high vs real clearing prices → recalibrated.
- An **advisor check-in** (`scripts/advisor-check.ts`, reading the model's output against its input):
  every bench player had been reaching the model with projection 0 since Phase 3; drops were cutting
  injured stars; "DvP rank 1" was misread as "best defense". All fixed.
- Structured outputs (`messages.parse` + zod) after a long plan got truncated mid-JSON.

**Stage 5: the realization (Sep 29).** Reading the rubric ("working agent", "understand how it
works"), the honest answer to "where's the agent?" was: there isn't one. The model never chooses a
step. That's a workflow, not an agent.

**Stage 6: convert to an agent (Sep 29).** Because the features were already standalone functions
taking a `teamId`, the conversion was mostly *wrapping*, not rewriting:
1. Wrap 9 features as tools (`tools.ts`): name + description (the model reads it to decide when to
   use the tool) + input schema + trimmed JSON output. All read-only.
2. Hand-roll the loop (`loop.ts`): `messages.create` with tools → run requested tools (in parallel) →
   append `tool_result`s → repeat until the model answers without a tool call; 10-turn cap.
3. Make it visible: terminal trace of each tool call, NDJSON stream to a chat page, terminal script.
4. Keep the pipeline too: the weekly-plan button is still the right tool for a routine full plan.

**Stage 7: verify the agent (Sep 29).**
- `agent-check.ts --tools`: every tool run against real data with no LLM, including a deliberately
  bad league name (returns a helpful error). Surfaced stale week-4 projections (all 0) → refreshed
  before testing the model.
- Live questions: the cross-league question fanned out 6 parallel calls and answered correctly.
- **Caught:** the agent said to drop De'Von Achane (IR) because his market value was `null`; it read
  "no data" as "worthless". Fixed in the tool output + prompt, re-ran, correct answer.
- **Caught:** an extra round of 4 `lookup_player` calls because bench values were missing from the
  lineup tool → added them; 7 calls → 4.
- **Caught (after the printout change):** the answer said two Guillotine starters were "correctly
  benched" when they should be benched; the tool's `shouldStart`/`shouldSit` keys read like
  "already started/benched". Renamed to `moveIntoLineup`/`moveToBench`; re-ran, correct.
- **Caught:** player search for "Watson" returned a retired namesake with no projection first →
  now ranks active, projected, skill-position players first.
- 84 existing unit tests still pass.

**Stage 8: make it say what it's doing (Sep 29).** Per the Class 4 slides ("the printed steps are the
demo"): the model now writes one short sentence before each round of tool calls, and every tool
result gets a one-line human summary (`SUMMARIZE` in `tools.ts`, display only; the model still gets
the full JSON). The terminal shows 🧠 plan → 🔧 calls → ↳ results per turn; the chat page shows the
same timeline. Watching the printout is what exposed the "correctly benched" misstatement above,
which is exactly the slide's point: *if you can't see the steps, a good answer and a lucky one look
the same.*

**Lesson:** the hard part of an agent is the tools and the verification, not the loop. The loop is
~100 lines; the tools took a week and were only trustworthy because each was tested and backtested
before an LLM ever saw its output.

## Course requirements → how this project meets them

From the rubric and the Class 4 slides 22–31 ("Your Mini-Project", "Five Minutes on Your Feet",
"Running It From a Terminal", "Make It Say What It Is Doing", "One Print, Inside the Loop",
"What This Means For Your Project").

| Requirement | Where it stands |
|---|---|
| One agent, built alone, real pain point | ✅ Weekly decisions across 3 real Sleeper leagues; used on my own teams |
| Start with the annoyance, not the technology | ✅ Started from "I overbid FAAB and leave points on the bench"; the tech came after |
| Runs end to end, genuinely useful | ✅ Real week-4 answers (lineup fixes, FAAB bids, drops) from live data |
| Hand-rolled encouraged; framework only if understood | ✅ No framework: plain Anthropic SDK + a loop I can explain line by line |
| No UI required (that's a final-project requirement) | ✅ Terminal demo works on its own (`scripts/agent-check.ts`); the `/agent` page is a bonus |
| Run from a terminal with one line | ✅ `npx tsx scripts/agent-check.ts "question"` (slide example is `py -3 your_agent.py "question"`; same idea in TypeScript) |
| Make it say what it's doing: print inside the loop what it decided and what came back | ✅ Each turn prints 🧠 the model's one-line plan, 🔧 the tool calls it chose (with arguments), then ↳ a readable one-line summary of each result (e.g. "Escalated Calls: vs ZynDesk, 123.7–120.4 projected, 53% to win"). Same timeline streams to the `/agent` page |
| Understanding: "here's how I verified it and what I caught" | ✅ Strong: backtests, advisor check-in, tool smoke test, live runs; concrete catches (zeroed bench projections, 10x FAAB, matchup lean removed, Achane null-value bug) |
| Verify: Read / Test / Judge (Class 4) | ✅ Read + Test done. ⚠️ **Judge not done:** no LLM-as-a-judge pass on the agent yet |
| Evals (required for the final project; good to start now) | ⚠️ Backtests are evals for the features; **no eval set for the agent's answers yet.** Idea: 8–10 questions with known-correct properties (never drops an IR/unknown-value star; bid within the tool's range; resolves partial league names; recovers from a bad name; names every shouldStart swap), scored by code + a judge model, with a pass threshold |
| Presentation: 30 s problem / 90 s build / 2 min demo / 30 s next, strictly timed | ⏳ Plan below follows this split |
| A demo that breaks, handled well, is fine | ⏳ Plan: data refreshed that morning; backup = a saved terminal run of the same question |
| Font up, window big, command typed before sharing | ⏳ Rehearsal checklist below |
| Commit to course repo + README section | ✅ README "The agent" section (problem, how it works, how to run). ⏳ Course repo deferred |
| Non-sensitive data only | ✅ My own leagues, no keys in the repo (`.env` gitignored). ⚠️ Other managers' team names appear in output; consider anonymizing for the demo |

## Sample terminal run (what the demo looks like)

```
🤖 AGENT RUN · model: Sonnet 5
   Q: Which of my leagues needs the most attention this week, and why?

   ── turn 1 ──
   🧠 Let me pull up all your leagues first to see what we're working with.
   🔧 list_my_leagues()
      ↳ list_my_leagues: 3 leagues (CS Guillotine, Panini CS League, Escalated Calls) · week 4 · 45ms

   ── turn 2 ──
   🧠 Now let me check the matchup/lineup situation in each league ...
   🔧 get_matchup(league="CS Guillotine")        (… 6 calls in parallel …)
      ↳ get_matchup: CS Guillotine: Guillotine rank 7 of 15, cushion +19.7 …, 95% to survive
      ↳ get_lineup_advice: Escalated Calls: optimal 123.7 vs set 112.2 (11.5 left on bench) · start
        Tyler Allgeier, Michael Wilson over De'Von Achane, Devaughn Vele · 1 injured starter
      ↳ get_matchup: Escalated Calls: vs ZynDesk, 123.7–120.4 projected, 53% to win
      …
   ✅ answered after 3 turn(s), 7 tool call(s) · 15.1s · 13,586 in / 1,216 out tokens
   │ **Escalated Calls** needs the most attention this week. …
```

## Possible next steps

Ordered by value for the Oct 12 presentation first, then the final project.

**Before Oct 12**
1. **Slide deck** (5 slides max: problem, architecture diagram, pipeline→agent, verification catches,
   next) and a timed rehearsal under 5:00.
2. **Demo safety:** refresh data the morning of; save a backup terminal run; decide whether to
   anonymize other managers' team names in the output (a `DEMO_ANON=1` flag that maps them to
   "Team 1…N").
3. **LLM-as-a-judge pass** (Class 4 "Judge" step): a second model grades a handful of agent answers
   against a written standard (grounded numbers only, bid within tool range, no unknown-value drops,
   names every swap). Gives a "here's what the judge caught" line for Q&A.
4. **Course repo:** copy/push the project + README section there (deferred by user for now).

**Toward the final project**
5. **Agent eval set** (required for the final project): ~10 questions with known-correct properties,
   scored by code checks + the judge, a pass threshold, runnable as one script so regressions show.
   Seed cases: the Achane unknown-value drop, the "correctly benched" misread, partial/bad league
   names, a cross-league question, a trade evaluation.
6. **Autonomous mode:** a scheduled run (Wednesday morning after waivers process, Sunday pre-kickoff)
   that gives the same loop the goal "check all my leagues and flag anything urgent" and pushes an
   alert only when something matters (IR starter, thin cushion, big bench leak). Reuses `runAgent`.
7. **Deploy** (Vercel + Neon) so the chat works from a phone on game day.
8. **Cost/latency:** prompt caching on the system prompt + tool definitions; Haiku for simple lookups.
9. **Tool gaps the agent could use:** season-long standings/playoff odds, past-week actuals ("why did
   I lose?"), and a proper trade-offer simulator for a specific partner.
10. **Re-run the week-3 backtest** (CBS reweighting question from the 9/27 notes).

## Presentation plan (5:00, per the slide-26 split)

| Time | Content |
|---|---|
| 0:30 | **Problem:** 3 leagues, different formats, weekly lineup/waiver/trade calls, data scattered across 4 projection sites + values + FAAB history. I was leaving points on the bench and overpaying FAAB. |
| 1:30 | **Build:** tools first (tested + backtested), then the loop: model picks a tool → my code runs it → result goes back → repeat until it answers. One diagram. One line on pipeline vs agent ("my first version wasn't an agent; here's how I turned it into one"). One verification catch (Achane). |
| 2:00 | **Live demo (terminal):** "Which of my leagues needs the most attention this week?" The room watches the printed tool calls fan out across leagues, then the answer. If time allows, a waiver/FAAB follow-up. |
| 0:30 | **Next:** a scheduled version that runs Wednesdays with no prompt and alerts me; an eval set + LLM judge for the agent's answers. |

**Rehearsal checklist:** refresh data (`npx tsx scripts/phase2-check.ts`) the morning of; terminal
font up and maximized; command pre-typed; `ADVISOR_TRACE=1`; a saved backup run; time it under 5:00.
