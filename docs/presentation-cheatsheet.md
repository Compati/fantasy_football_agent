# Presentation cheat sheet (Oct 12)

Two things in one place: how to answer "how was it built / what tools does it call", and the
step-by-step prep for running the demo in a terminal. The longer write-up is [agent.md](agent.md).

## Where things live

```
fantasy-agent/
├── lib/agent/
│   ├── loop.ts          the agent loop + system prompt (~150 lines)
│   ├── tools.ts         the 9 tools: definitions + the code each one runs
│   ├── trace.ts         the terminal printout (🧠 / 🔧 / ↳)
│   ├── eval-checks.ts   code checks for the eval set
│   ├── judge.ts         the LLM judge
│   ├── advisor.ts       the older one-shot "weekly plan" pipeline (not the agent)
│   └── context.ts       builds the big context blob for that pipeline
├── lib/features/        the decision logic the tools wrap (start/sit, waivers, FAAB, trades…)
├── lib/ingest/          pulls data in: Sleeper rosters, projections, trade values, news
├── lib/projections/     the 4 projection sources + the consensus blend
├── scripts/
│   ├── agent-check.ts   ask the agent a question from the terminal (the demo)
│   └── agent-eval.ts    the 9-case eval set
├── app/api/agent/       the same loop behind the web chat page
└── prisma/              the local database (rosters, projections, values)
```

## "How was it built?"

> I built the tools first, with no AI: plain code that pulls my leagues from Sleeper, blends four
> projection sources, and computes start/sit, waiver bids and trade values. I tested and backtested
> those. Then I wrapped nine of them as tools and wrote the loop by hand with the Anthropic SDK, no
> framework.
>
> The loop is: send Claude the question and the tool list. If it asks for tools, my code runs them
> and sends the results back. Repeat until it answers without asking for a tool. That's the whole
> agent; it's capped at 10 turns.

If they probe:

- **The model chooses the steps.** It gets a toolbox, not the data. It decides which tools, in what
  order, and when it has enough. My first version (`advisor.ts`) wasn't an agent: my code fetched
  everything and Claude just summarized.
- **Tools run in parallel.** If Claude asks for six tools in one turn, they all run at once.
- **Errors go back to the model.** A wrong league name comes back as an error result, and the model
  corrects itself instead of crashing.
- **It's read-only.** No tool can change anything on Sleeper; it only advises.
- **The system prompt holds the rules:** cite only numbers the tools returned, never bid above the
  tool's range, never drop a player whose value is unknown, say so when asked to make a move.

## "What tools does it call?"

| Tool | What it returns |
|---|---|
| `list_my_leagues` | my leagues, formats, record, FAAB left, current week |
| `get_lineup_advice` | optimal lineup vs. what's set, the swaps to make, injury alerts, bench values |
| `get_matchup` | opponent and win probability, or survival odds in the Guillotine league |
| `get_waiver_targets` | best available players with a FAAB bid range based on my league's real past bids |
| `lookup_player` | one player's projection, injury, who rosters him, his value |
| `get_trade_ideas` | fair trades that improve both lineups, near-term and rest-of-season |
| `evaluate_trade` | a verdict on a specific trade by market value |
| `get_roster_outlook` | upcoming bye weeks and thin positions |
| `get_player_news` | recent YouTube analyst coverage, for color only |

Each tool has three parts in `tools.ts`: a name, a description the model reads to decide when to use
it, and the function my code runs.

**The demo question** (it's the default, so `agent-check.ts` with no question runs it):

> Find the league where I'm in the most trouble this week. Then fix it: set my best lineup, find a waiver pickup for my weakest starting spot with a bid and who to drop, and check the news on anyone you recommend.

Each step depends on what the last one returned, so the agent has to keep looping. On Oct 5 it took
7 turns, 10 tool calls, 44 seconds:

1. `list_my_leagues`
2. `get_matchup` for all three leagues at once
3. picked the league with the worst odds, then `get_lineup_advice` + `get_roster_outlook` there
4. `get_waiver_targets` for RB and TE
5. saw those weren't upgrades and checked WR too (nobody asked it to; point this out)
6. `get_player_news` on the players it was about to name
7. the answer: lineup swap, waiver add with a bid, the drop, and "I can't make these moves for you"

Nobody programmed that sequence; the model picked it, and it changes from run to run (expect 5 to 7
turns, and a different league depending on the week).

The old question ("Which of my leagues needs the most attention this week, and why?") only took 3
turns: list, six calls at once, answer. It's still a good short follow-up for showing parallel calls.

## "How do you know it works?"

- The features were backtested before any AI saw them (matchup lean lost and was removed; FAAB bids
  were 10–15x too high and were recalibrated).
- `agent-check.ts --tools` runs every tool with no model involved.
- The eval set runs 9 questions, scored by code checks and a second model as judge. Its first run
  failed 7/9: it caught the agent not saying it can't place a waiver claim, and I caught the judge
  mis-grading because it couldn't see the tool descriptions. 9/9 after fixes.
- A demo dry run showed the agent advising on stale rosters (a dropped player still "on my team").
  The tools now re-sync rosters from Sleeper before answering.
- I tested the cheapest model (Oct 11). Haiku 4.5 looped fine and was about 2.5x faster on the demo
  question (13s vs 34s, 25k vs 43k input tokens), but passed only 4 of 9 eval cases. Sonnet 5 passed
  9 of 9 the same day. Haiku's failures were all the same kind: saying things no tool returned (a
  $15 bid, "9 to 11 weeks remaining", an injury for Ekeler), reading the Guillotine rank backwards,
  and not saying it can't place a waiver claim. So Sonnet is the default by test, not by habit.

## "Why not a smaller model?" / "What does the model add?"

> I tried. The small model picks the same tools in the same order, so the loop is not the hard part.
> It fails at the last step: staying inside what the tools returned. That is where the judgment is,
> and it is what my eval set measures.

## Presenting on Monday night: plan Week 6, not Week 5

Sleeper only moves to the next week on Tuesday. On Monday night Week 5 is decided, so advice about
it is useless. Set the planning week in the terminal first; every command after it (refresh, smoke
test, evals, demo) then works on Week 6. It lasts for that terminal window only.

```powershell
$env:PLAN_WEEK = "6"
```

The demo question for that night:

> Week 5 is almost over, so get me ready for Week 6. Find the league where I'm in the most trouble next week. Then fix it: set my best lineup, find a waiver pickup for my weakest starting spot with a bid and who to drop, and check the news on anyone you recommend.

Oct 12 dry run: 6 turns, 7 tool calls, 25 seconds. It picked Escalated Calls (51% to win), found 6.5
points on the bench, saw the starting defense was on bye (projected 0) and bid on a replacement.
Only three projection sources have Week 6 numbers on a Monday (FFToday posts later).

**Eval scores vary from run to run.** Sonnet 5 across four runs: 9/9, 9/9, 6/9, 7/9 (the last two on
Week 6 data). Haiku 4.5: 4/9 on one run. The failures move between cases and are small ungrounded
phrases the judge catches (a misquoted gap, "tied for best projection" when it wasn't). Say the
range, not "9 of 9".

## Running it in a terminal: prep steps

All commands run from the `fantasy-agent` folder in PowerShell.

### A few days before

1. Tool smoke test, no API credits. Expect one `↳` line per tool and exactly one deliberate error
   ("No league matches 'no such league'").
   ```powershell
   npx tsx scripts/agent-check.ts --tools
   ```
2. Full dry run of the demo question (about 45 seconds, 5 to 7 turns). Run it two or three times:
   the steps vary, and you should know roughly how long to narrate for.
   ```powershell
   npx tsx scripts/agent-check.ts
   ```
3. Decide about other managers' team names in the output. To hide them, set `DEMO_ANON=1` first:
   every other team shows as "Team N" (your own team and league names stay). It lasts for that
   terminal window, so set it again on the day.
   ```powershell
   $env:DEMO_ANON = "1"
   ```

### The morning of

4. Refresh projections and trade values (a minute or two). Rosters refresh themselves when the
   agent runs.
   ```powershell
   npx tsx scripts/phase2-check.ts
   ```
5. Re-run the smoke test (step 1). Check the week number and that projections aren't all zero.
6. Run the eval set so "it passed this morning" is true (about a minute).
   ```powershell
   npx tsx scripts/agent-eval.ts
   ```
7. Save a backup run, then open the file to confirm it's legible. Don't commit it.
   ```powershell
   npx tsx scripts/agent-check.ts | Tee-Object demo-backup.txt
   ```
8. Read that answer so you know which league it picked and why before you're in front of the room.

### Right before presenting

9. Maximize the terminal and bump the font (Ctrl + plus).
10. `cls`, then pre-type the demo command without pressing Enter.
11. Close anything showing secrets (`.env`) before sharing the screen.

### During the demo (2:00)

12. Press Enter and narrate: 🧠 is the model's plan, 🔧 the tool calls it chose (point out the
    three calls at once in turn 2, and any turn where it changes course), ↳ what came back, then the answer with turn/tool/token counts.
13. The demo question takes about 45 seconds, so there's probably no time for more. If there is:
    ```powershell
    npx tsx scripts/agent-check.ts "Who's the best RB on waivers in Panini, and how much should I bid?"
    ```
14. If it breaks, say so and walk through `demo-backup.txt`.

### Things that can go wrong

- **API key errors:** the key is in `.env`; run the scripts from the project folder.
- **Network:** needs internet for the Claude API and Sleeper. Tether to a phone if the wifi is
  shaky, or use the backup file.
- **Slow first run:** `npx tsx` starts cold in a few seconds; running step 1 just before warms it up.
