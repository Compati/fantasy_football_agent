# Dev log

## 2026-09-19 — Phase 0 scaffold + data-layer probe (DONE)

Stood up the app mirroring `pickem`'s stack (Next.js 16, Prisma 6, NextAuth v5, Tailwind v4).

**Built**
- Config + app shell: login page (credentials), server-rendered `/dashboard` behind `requireUser`,
  `/api/auth/[...nextauth]`, single-user `scripts/seed.ts`.
- Prisma schema (SQLite dev): `User, Connection, League, Team, RosterSpot, Player, Projection,
  TradeValue, NewsItem`. Canonical `Player` keyed by `sleeperId`; ESPN/Yahoo ids carried for joins.
- Credential-free data clients: `lib/sleeper.ts` (accounts/leagues/rosters/matchups/catalog/
  projections), `lib/fantasycalc.ts` (trade values), `lib/projections/espn.ts` (kona_player_info),
  `lib/projections/consensus.ts` (trimmed-mean blend), `lib/http.ts`.
- `scripts/probe.ts` (`npm run probe`) — live health check of all three sources + the joins.

**Probe results (season 2026, wk 2), verified live**
- Sleeper catalog: 12,228 entries → 11,988 canonical; 6,732 w/ espn_id, 6,746 w/ yahoo_id.
- FantasyCalc→catalog join: **196/196 resolve** on `sleeperId`. Airtight.
- Sleeper projections: 1,025 rows. ESPN projections: 546 weekly, **151 resolved via espn_id**.
- Consensus: 114 players blended (Sleeper+ESPN), small spreads (studs agree within ~0.6–2.6).
- End-to-end: login → JWT session → dashboard renders. Screenshot captured.

**Known refinement (Phase 2):** ESPN espn_id join is low (151/546) — top players all resolve (they
carry the consensus) but the tail doesn't. Add a name+position fallback for players whose Sleeper
catalog espn_id is missing/mismatched to lift resolution.

**Decisions**
- Provider = SQLite locally for zero-setup verification; documented the switch to Neon Postgres
  (provider + directUrl) for prod in `schema.prisma` / `.env.example`.
- Added a `fantasy-agent` config to `apps/.claude/launch.json` (session root is `apps/`), port 3005
  so it doesn't collide with pickem on 3000.

**Next (Phase 1):** Sleeper connect (username → leagues/rosters) + Yahoo OAuth read connect; ingest
rosters/matchups into the DB; render real rosters on the dashboard.
