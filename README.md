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
- **Phase 1 — My leagues** (next): Sleeper + Yahoo connect, roster/matchup ingestion, dashboard.
- **Phase 2 — Decisions (no LLM):** start/sit, waivers + FAAB, trade analyzer.
- **Phase 3 — Agent chat.** · **Phase 4 — Reddit/YouTube.** · **Phase 5 — props, X, podcasts.**

See `NOTES.md` for the running dev log and `C:\Users\Alex\.claude\plans\i-have-several-fantasy-fuzzy-lightning.md`
for the full plan.
