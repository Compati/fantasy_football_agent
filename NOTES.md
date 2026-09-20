# Dev log

## Roadmap & next steps

**Done so far (Phases 0–2):** a working, advise-only decision tool. Connect Sleeper by username →
your leagues/rosters import; the app shows an optimal start/sit (from a Sleeper+ESPN projection
consensus), waiver targets with suggested FAAB bids, and a trade analyzer valued for each league's
exact format. Verified live on 3 real leagues. Yahoo read-only OAuth is built but untested.

**Immediate next — Phase 3: Claude chat agent**
- Add `@anthropic-ai/sdk` tool-calling over the existing features so you can ask in plain English:
  "Who do I flex this week?", "Best RB on waivers and what should I bid?", "Is Jefferson for CMC
  fair?" — grounded in the real numbers (no hallucinated advice).
- Tools wrap what already exists: `list_my_teams`, `get_roster`, `start_sit` (→ `startSitForTeam`),
  `waiver_recommendations` (→ `waiverTargets`), `evaluate_trade` (→ `evaluateTrade`),
  `get_trade_values`. Stream to a chat panel on `/league/[id]` via an `/api/chat` route.
- Needs `ANTHROPIC_API_KEY` in `.env`.

**Phase 4 — community context (Reddit + YouTube)**
- `lib/reddit.ts` (free "script" app) pulls r/fantasyfootball injury/news/start-sit threads;
  `lib/youtube.ts` (`youtube-caption-extractor`, no key) pulls transcripts from chosen channels.
- Match items to rostered/waiver players → `NewsItem` rows → a `search_news` tool + news chips on
  the start/sit and waiver cards.

**Phase 5 — later**
- Player betting props (The Odds API, reuse pickem's `lib/odds.ts` pattern) as a start/sit signal.
- X/Twitter (metered) and podcast transcription (Whisper). Yahoo *write* actions stay out of scope
  (advise-only).

**Quality/coverage improvements worth doing (independent of phases)**
- **Deeper trade values:** FantasyCalc returns ~196 players/format, thin for a 15-team SF league.
  Add a second value source (KeepTradeCut / DynastyProcess) or fall back to projection-based value
  so waiver/trade coverage isn't sparse.
- **Opponent/matchup context:** ingest weekly matchups (`getMatchups`) and defense-vs-position so
  start/sit can factor the actual opponent, not just projection.
- **CBS + FantasyPros consensus:** add a 3rd projection source to strengthen the blend.
- **Scoring dimension:** projections are ingested as full-PPR (all current leagues are PPR); add a
  half/std dimension if a non-PPR league is ever added.
- **Yahoo:** register a Yahoo app and verify `refreshYahooLeagues` extractors vs live JSON (the ppr
  derivation from stat modifiers is a placeholder).
- **Deploy:** move to Vercel + Neon (switch Prisma provider to `postgresql` + `directUrl`) so it's
  usable from a phone during games; the Vercel crons in `vercel.json` then run automatically.
- **Duplicate-name hardening:** the catalog has same-name players (two "Kenneth Walker"); the UI is
  safe (keys off roster sleeperId) but the name+pos projection fallback could be tightened.

## 2026-09-19 — Phase 2 decision engine (DONE, verified on real leagues)

**Built**
- Ingest: `lib/ingest/projections.ts` (Sleeper + ESPN → Projection rows) and
  `lib/ingest/trade-values.ts` (FantasyCalc per league format). ESPN adapter gained a name+pos
  fallback → resolved rows jumped **151 → 508** (unresolved 395 → 38).
- Features: `lib/features/eligibility.ts` (slot rules), `startsit.ts` (greedy optimal lineup +
  swaps + close calls), `waivers.ts` (free-agent ranking + `faabSuggestion` bid sizing),
  `trade.ts` (`scoreTrade` + `evaluateTrade`, with a missing-value warning).
- UI: `/league/[id]` page — start/sit, waiver table (FAAB $), and interactive TradeAnalyzer
  (client) + `evaluateTradeAction`. Dashboard league names now link here.
- Cron: `/api/cron/refresh-{players,projections,trade-values,my-leagues}` (CRON_SECRET-guarded).

**Verified live (season 2026, wk 2, real leagues)**
- `scripts/phase2-check.ts`: all 3 teams get sensible start/sit. Consensus *corrected* a call
  (single-source said start Pierce; 2-source says Etienne is right → lineup already optimal).
- Waivers: ranked with FAAB $ (e.g. 15-team QB add $280), trend arrows for risers.
- Trade UI click-through: give K.Walker (6788) for Travis Hunter (23) → "Strongly favors them
  −100%". Real values resolve; duplicate-name catalog entries (two "Kenneth Walker") don't affect
  the UI since it keys off the roster's sleeperId (8151), not name.
- Cron guard: 401 without secret, 200 with (392 value rows).
- 18/18 unit tests pass (added optimizeLineup, faabSuggestion, scoreTrade); `tsc` clean.

**Notes / TODO**
- FantasyCalc returns ~196 players/format → deep-league players (esp. 15-team SF) can lack a trade
  value; waiver "value" and trade sides show "—"/"no value", and the trade verdict now warns when a
  side has a missing value (counts it as 0 = a floor). Projections/start-sit unaffected.
- Projections ingested as full-PPR (all Alex's leagues are PPR). Half/std would need a scoring dim.
- Name+pos resolver is a fallback only (primary = espnId / roster sleeperId), low dup-name risk.

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
