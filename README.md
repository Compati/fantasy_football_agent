# Fantasy Agent

A personal decision assistant for fantasy football across **Sleeper** and **Yahoo** leagues.
It pulls your rosters plus a **consensus of multiple projection sources**, market **trade values**,
and (later) community context, then helps with **start/sit, waiver pickups + FAAB bidding,
free-agent adds, and trade evaluation**.

**Advise-only:** the agent recommends; you make the moves in the Yahoo/Sleeper apps. Yahoo access
is read-only — no code ever sets a lineup or submits a claim.

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
  leagues, 0 unresolved); Yahoo read-only OAuth connect + ingest (built, awaits a Yahoo app).
- **Phase 2 — Decisions (no LLM) ✅** Multi-source projection consensus + FantasyCalc trade values;
  start/sit optimizer, waiver ranking with FAAB bid sizing, and a trade analyzer — all live at
  `/league/[id]`. 18 unit tests, cron refresh jobs.
- **Phase 3 — Agent chat** (next): Claude tool-calling over the data (start/sit, waivers, trades).
- **Phase 4 — Reddit/YouTube context.** · **Phase 5 — player props, X, podcasts, Yahoo verified.**

See `NOTES.md` for the running dev log + the detailed roadmap/next steps.

## Quick commands

```powershell
npm run dev -- -p 3005                    # run the app (http://localhost:3005)
npx tsx scripts/connect-sleeper.ts <user> # connect a Sleeper account
npx tsx scripts/phase2-check.ts           # refresh projections/values + print start/sit
npm run probe                             # credential-free data-source health check
npm test                                  # unit tests
```
