# Fantasy Agent

A personal decision assistant for fantasy football across my **Sleeper** leagues.
It pulls your rosters plus a **consensus of multiple projection sources**, market **trade values**,
and community context, then helps with **start/sit, waiver pickups + FAAB bidding,
free-agent adds, and trade evaluation**.

**Advise-only:** the agent recommends; you make the moves in the Sleeper app. Every data source is
read-only — no code ever sets a lineup or submits a claim.

**Other platforms:** Sleeper is the only one supported today. A Yahoo connection is built
(`lib/yahoo/`) but can't pull leagues, because Yahoo's Fantasy API now sits behind a manual-approval
program. ESPN leagues are the more realistic next platform.

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

### From pipeline to agent

The first AI version of this project was not an agent. It was a data pipeline with an LLM at the
end: my code fetched everything about a league, packed it into one large context
(`lib/agent/context.ts`), and Claude wrote a prioritized list of moves from it
(`lib/agent/advisor.ts`). The code chose every step; the model only summarized.

The agent reverses that. Claude gets the question and a toolbox, and it decides what to look up, in
what order, and when it has enough to answer. The deterministic features underneath did not change;
they became the tools.

Both remain in the repo. The pipeline still powers the one-click "weekly plan" on each league page,
and the agent handles open-ended questions.

## The app around the agent

Everything below describes what was built first and what the agent runs on: the data ingestion,
the database, the decision features and a web UI. Together they are the start of a larger fantasy
assistant app, with the agent as one way into it.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Prisma 6 · NextAuth v5 ·
Anthropic SDK (agent chat). Mirrors the `pickem` app. SQLite locally; Neon Postgres in prod.

## How it fits together

```
Sources ──► Ingestion ──► Database ──► Features ──► Agent ──► Terminal / Web
            lib/ingest    prisma/      lib/features  lib/agent  scripts/  app/
```

| Source | Client | What it provides |
|---|---|---|
| Sleeper | `lib/sleeper.ts` | leagues, rosters, matchups, schedule, waiver history, projections |
| ESPN, CBS, FFToday | `lib/projections/` | three more weekly projection sources |
| FantasyCalc | `lib/fantasycalc.ts` | market trade values |
| The Odds API | `lib/odds.ts` | game lines and player props (optional, needs a key) |
| YouTube | `lib/youtube.ts` | analyst video transcripts |
| Yahoo | `lib/yahoo/` | leagues and rosters (built; blocked by Yahoo's approval program) |

The four projection sources are blended into one consensus number per player
(`lib/projections/consensus.ts`). The features are plain, deterministic code with unit tests; the
agent's tools are thin read-only wrappers around them.

Every source joins on one canonical `Player` (Sleeper id). FantasyCalc carries `sleeperId`
directly; ESPN joins via the Sleeper catalog's `espn_id`; Yahoo via `yahoo_id`; CBS and FFToday
are matched by name, position and team.

## Repo map

```
fantasy-agent/
├── lib/
│   ├── agent/          the agent: loop.ts (loop + system prompt), tools.ts (the 9 tools),
│   │                   trace.ts (terminal printout), anonymize.ts (demo mode),
│   │                   eval-checks.ts + judge.ts (evals); advisor.ts + context.ts are the
│   │                   older one-shot "weekly plan" pipeline
│   ├── features/       decision logic the tools wrap: start/sit, matchup, survival, waivers,
│   │                   FAAB, trades, trade finder, roster outlook, news, props
│   ├── ingest/         pulls each source into the database
│   ├── projections/    ESPN / CBS / FFToday adapters + the consensus blend
│   ├── values/         projection → trade-value fit for players FantasyCalc doesn't rank
│   ├── yahoo/          Yahoo OAuth, REST client, ingest
│   └── *.ts            API clients (sleeper, fantasycalc, odds, youtube) and shared helpers
├── scripts/            terminal commands: agent-check.ts (the demo), agent-eval.ts (eval set),
│                       phase2-check.ts (refresh data), backtest.ts, setup + spot-check scripts
├── app/                Next.js web UI: dashboard, league page, "Ask the agent" chat, API + cron routes
├── components/         shared UI pieces
├── prisma/             database schema + migrations
├── tests/              unit tests, one file per module tested
├── docs/               agent.md (design write-up), presentation-cheatsheet.md, the slide deck
└── NOTES.md            running dev log
```

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
  `/league/[id]`. Unit tests (90 today), cron refresh jobs.
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
