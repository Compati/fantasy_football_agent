# Dev log

## 2026-09-19 — Phase 1 league connect + roster ingest (Sleeper DONE, Yahoo built/untested)

**Built**
- Canonical player sync + resolver: `lib/players.ts` (`syncPlayerCatalog`, `ensureCatalogFresh`,
  `playerDetailMap`, `buildResolver` for Yahoo yahoo_id + name+pos fallback, `normalizeName`).
- Sleeper ingest: pure transforms `lib/ingest/sleeper-transform.ts` (`parseLeagueSettings`,
  `starterSlots`, `rosterToSpots`) + DB layer `lib/ingest/sleeper.ts` (`connectSleeper`,
  `refreshSleeperLeagues`). Derives ppr/numQbs(SF)/FAAB/numTeams; my-team = owner_id match.
- Yahoo (read-only): `lib/yahoo/oauth.ts` (auth URL / code exchange / refresh, scope `fspt-r`) +
  `lib/yahoo/ingest.ts` (`refreshYahooLeagues` via `yahoo-fantasy`, token auto-refresh, defensive
  extractors) + routes `/api/yahoo/start` & `/api/yahoo/callback`. Ambient types in
  `types/yahoo-fantasy.d.ts`. **Untested until real Yahoo app creds exist.**
- UI: `ConnectPanel.tsx` (Sleeper username form + refresh via server actions in `dashboard/actions.ts`;
  Yahoo connect button, gated on YAHOO_CLIENT_ID) + dashboard renders my roster (starters by slot +
  bench) per league with parsed settings badges.
- Added `next-auth.d.ts` (session.user.id typing, same as pickem).

**Verified**
- 10/10 unit tests pass (`npm test`): settings parsing (PPR/half/std, superflex→numQbs2, FAAB),
  starter-slot filtering, roster→spots (slot alignment, empty "0" skip, bench, unknown-player
  fallback), consensus blend (single/avg/trimmed-mean/grouping).
- `npx tsc --noEmit` clean across the whole app (incl. Yahoo code).
- DB→UI rendering proven with `scripts/fixture-ingest.ts` (sample PPR league) → dashboard shows
  starters/bench correctly, no console errors; screenshot taken; fixture then cleared.

**Not yet done / next**
- Live Sleeper connect against a real username (user chose "build generically" — no username given).
  Ready to run the moment a username is entered in the UI or `connectSleeper` is called.
- Yahoo end-to-end needs the user to register a Yahoo app (client id/secret + redirect URI
  http://localhost:3000/api/yahoo/callback) — then verify `refreshYahooLeagues` extractors vs live
  JSON (ppr from stat modifiers is a placeholder 0.5).
- Matchups ingestion (getMatchups) not yet wired to DB — deferred to Phase 2 where start/sit needs it.

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
