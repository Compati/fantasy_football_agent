# Fantasy Agent

A personal decision assistant for fantasy football across **Sleeper** and **Yahoo** leagues.
It pulls your rosters plus a **consensus of multiple projection sources**, market **trade values**,
and (later) community context, then helps with **start/sit, waiver pickups + FAAB bidding,
free-agent adds, and trade evaluation**.

**Advise-only:** the agent recommends; you make the moves in the Yahoo/Sleeper apps. Yahoo access
is read-only — no code ever sets a lineup or submits a claim.

## The agent (class mini-project)

**Problem:** I manage teams in several fantasy leagues with different formats. Every week each one
needs lineup, waiver/FAAB, and trade decisions, and the data behind them is scattered across four
projection sites, trade-value markets, Vegas lines and each league's bidding history. I was leaving
points on the bench and overpaying on waivers.

**What it does:** ask a question in plain English. The agent decides which of its 9 read-only tools
to call (lineup optimizer, matchup / Guillotine survival odds, waiver targets with FAAB bids
calibrated on the league's real past bids, player lookup, trade finder, trade evaluator, bye-week
outlook, news), reads the results, calls more if it needs to, and answers from the numbers.

**How it works:** a hand-rolled loop, no framework (`lib/agent/loop.ts`): send the conversation +
tool definitions to Claude → run whatever tools it asks for (`lib/agent/tools.ts`) → send the results
back → repeat until it answers without asking for a tool (10-turn cap). Each step is printed: 🧠 what
it decided, 🔧 which tools, ↳ what came back.

**Run it** (terminal, no UI needed):

```powershell
npx tsx scripts/phase2-check.ts                                    # refresh this week's data
npx tsx scripts/agent-check.ts                                     # the demo question (or pass your own in quotes)
npx tsx scripts/agent-check.ts --tools                             # test every tool, no LLM calls
npx tsx scripts/agent-eval.ts                                      # 9-case eval set: code checks + LLM judge
```

Or in the app: dashboard → **Ask the agent →**. Needs `ANTHROPIC_API_KEY` in `.env`.
Design notes, the pipeline → agent history, and what verification caught: [docs/agent.md](docs/agent.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Prisma 6 · NextAuth v5 ·
Anthropic SDK (agent chat). Mirrors the `pickem` app. SQLite locally; Neon Postgres in prod.

## How it fits together

```
Sources ──► Ingestion (lib/) ──► SQLite/Postgres (Prisma) ──► Features (lib/features) ──► UI + Agent
Sleeper      sleeper.ts            Player / Projection            startsit / waivers /       dashboard
ESPN         projections/espn.ts   TradeValue / League / Team     trade  (deterministic)     + chat
FantasyCalc  fantasycalc.ts        RosterSpot / NewsItem          consensus blend            (Claude tools)
Yahoo        yahoo.ts (Phase 1)
Reddit/YT    reddit.ts/youtube.ts (Phase 4)
```

Every source joins on one canonical `Player` (Sleeper id). FantasyCalc carries `sleeperId`
directly; ESPN joins via the Sleeper catalog's `espn_id`; Yahoo via `yahoo_id`.

## Setup

```powershell
cd "C:\Users\Alex\Documents\Alex\Code\apps\fantasy-agent"
npm install
copy .env.example .env      # fill in AUTH_SECRET, SEED_PASSWORD (Yahoo/Anthropic later)
npx prisma migrate dev      # creates ./prisma/dev.db
npx tsx scripts/seed.ts     # creates your single login
npm run dev -- -p 3005
```

### Verify the data layer (no credentials needed)

```powershell
npm run probe
```

Hits Sleeper, ESPN, and FantasyCalc live and prints a health report: source row counts, the
FantasyCalc→catalog id join rate, and a sample consensus blend.

## Status

- **Phase 0 — Scaffold ✅** Next.js app, Prisma schema + migration, NextAuth single-user gate,
  data clients (Sleeper / ESPN / FantasyCalc), consensus blend, and the `probe` smoke test.
- **Phase 1 — League connect ✅** Sleeper username connect + roster ingest (verified live on 3 real
  leagues, 0 unresolved); Yahoo read-only OAuth connect + REST ingest (built & working through token
  exchange, but the Fantasy API itself is gated behind Yahoo's 2026 manual-approval program — see NOTES).
- **Phase 2 — Decisions (no LLM) ✅** Multi-source projection consensus + FantasyCalc trade values;
  start/sit optimizer, waiver ranking with FAAB bid sizing, and a trade analyzer — all live at
  `/league/[id]`. 18 unit tests, cron refresh jobs.
- **Phase 3 — AI advisor agent ✅ (built; needs `ANTHROPIC_API_KEY` to run)** One click generates a
  prioritized list of moves per league (start/sit, waiver + FAAB, trade angles), grounded in the
  numbers; cross-league digest on the dashboard. Model selectable — Sonnet 5 (default) / Opus 5 /
  Haiku 4.5. Advise-only.
- **Phase 4 — YouTube context ✅** · **Phase 5 — player props ✅**; X, podcasts, Yahoo (blocked).
- **Agent loop ✅** "Ask the agent": Claude picks tools itself (the Phase 3 advisor is a one-shot
  pipeline; both remain). See [docs/agent.md](docs/agent.md).

See `NOTES.md` for the running dev log + the detailed roadmap/next steps.

## Quick commands

```powershell
npm run dev -- -p 3005                    # run the app (http://localhost:3005)
npx tsx scripts/connect-sleeper.ts <user> # connect a Sleeper account
npx tsx scripts/phase2-check.ts           # refresh projections/values + print start/sit
npx tsx scripts/agent-check.ts "question" # ask the agent from the terminal
npm run probe                             # credential-free data-source health check
npm test                                  # unit tests
```
