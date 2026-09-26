# Dev log

## 2026-09-25 — multi-source projections (4-source consensus)

Consensus now blends **Sleeper + ESPN + CBS + FFToday** (trimmed mean drops min/max at 3+ sources).
Week 3 live: 260 players have all 4 sources, 76 have 3; every non-DEF starter across the 3 leagues
is 4-source (was ≤2). New: `lib/projections/cbs.ts`, `lib/projections/fftoday.ts` (pure HTML
parsers + fetch), `lib/projections/scraped.ts` (shared row → sleeperId via name+pos+team, then
name+pos). `scripts/projections-check.ts` refreshes and prints each source's median ratio vs Sleeper
per position (all 0.88–1.12 now). 52 tests.
- **FantasyPros dropped:** it now shows only the top 10 per position when logged out.
  NFL.com's research page redirects to news. FFToday took the 4th slot.
- **Scoring gotchas found by the ratio check:** CBS + FFToday score passing TDs at 6 pts (all our
  leagues + Sleeper/ESPN use 4) → QB lines rescored `fpts − 2 × passTD`. CBS DST runs ~1.5× Sleeper,
  so CBS DST is skipped (DEF stays Sleeper-only). FFToday K is PosID 80 (unknown PosIDs silently
  serve the QB page). FFToday 403s parallel bursts → fetched sequentially (~10s total).
- A failed/empty scrape keeps the previous rows for that source instead of wiping them.
- **Also fixed:** `refreshTradeValues` crashed (P2002) when a player entered FantasyCalc's list while
  still holding a `derived` row for that format — colliding derived rows are now cleared first.

## Current state — 2026-09-22 (roster outlook: byes + thin positions; uncommitted)

**Working & verified live on 3 real Sleeper leagues** (amiller180): rosters, **start/sit** (optimal
lineup, injury-aware), **waivers + FAAB sizing** (injury-aware), **trade analyzer**, **injuries**
(badges + alerts), **matchups** (proj vs live + win %, H2H leagues only), **Guillotine survival**
(rank / cushion / survive % + full standings strip; also fed to the advisor), **roster outlook**
(upcoming bye crunches + thin positions; also fed to the advisor). SQLite local; dev on port 3005
(`npm run dev -- -p 3005`). 36 unit tests, tsc + lint clean. Not deployed (local only).

**Built but not yet running:** the **AI advisor** (Phase 3) — one-click prioritized moves per league,
model selectable (Sonnet 5 default / Opus 5 / Haiku 4.5). It only needs `ANTHROPIC_API_KEY` in `.env`
to run; everything else is wired and typechecked.

**Blocked (external):** **Yahoo** — OAuth works but Yahoo's Fantasy API now requires manual approval
(applied for? no). Do NOT re-debug the 403; it's Yahoo's gate. Code is ready if/when approved.

**Resume-here next steps, rough priority:**
1. **Finish Phase 3** — add `ANTHROPIC_API_KEY`, restart, click Generate on a league, confirm the
   JSON parses and the moves are sensible (dashboard digest then populates). Likely small follow-ups:
   prompt tuning, a "generate all leagues" button, token/cost estimate.
2. **Key-free extensions:** Phase 4 **YouTube** news (no key) + Reddit later (free Reddit app);
   **deeper trade values** (2nd source so deep-league players aren't blank); ~~Guillotine survival
   view~~ **DONE 2026-09-21**; **deploy to Vercel + Neon** (phone use — switch Prisma provider to
   postgres + directUrl).
3. **Yahoo** — only if approved at sports.yahoo.com/developer/access (submit the existing Client ID).

Handy scripts: `npm run probe` (source health), `scripts/connect-sleeper.ts <user>`,
`scripts/phase2-check.ts` (refresh projections/values + print start/sit), `scripts/sync-players.ts`
(refresh catalog incl. injuries).

## 2026-09-22 — Roster outlook: bye-week crunches + thin positions (key-free)

Forward-looking roster construction: which upcoming week leaves a starting slot unfilled (byes), and
where the roster is thin right now.
- Bye source: new `getSchedule(season)` in `lib/sleeper.ts` (api.sleeper.com/schedule/nfl/regular/
  {season}, memoized per season). A team's bye = the week it plays no game.
- `lib/features/roster.ts` (pure cores unit-tested): `byeWeekByTeam(games)`; `computeByeOutlook`
  (future weeks with a rostered player on bye + which starting slots can't be filled — reuses the real
  `optimizeLineup` with equal projections purely for fillability); `computeThinPositions` (a base
  position with rostered count ≤ its *dedicated* starting slots, i.e. no bench behind the starters;
  FLEX/SUPER_FLEX don't inflate any single position's need). `rosterOutlook(teamId)` wraps it (skips IR
  players). +4 tests (36 total).
- Surfaced: "Roster outlook" section on the league page (next bye crunch warning, thin positions,
  upcoming byes with unfilled slots); fed into advisor context (`outlook`) + a prompt rule (shore up
  thin spots / name the bye-crunch week); prints in the trace GATHER stage.
- Verified live: CS Guillotine (deep) → no crunch, correctly groups DET's wk6 bye (Goff/Jefferson/
  Hockenson); Panini CS → thin QB/TE, wk5 DEF crunch; Escalated Calls → thin QB/TE, wk7 TE crunch.

## 2026-09-22 — Injury-aware waivers/values + survival fed to the advisor (key-free)

**#1 Injury gate shared across features.** New `lib/features/injury.ts` (`UNAVAILABLE_STATUS`,
`isUnavailable`, `injuryAdjustedProj`) — start/sit now imports it instead of defining the set locally.
Waivers gate a ruled-out player's projection to 0 (they sink out of the ranked targets, matching
start/sit) and expose `injuryStatus` (badged in the waiver table; Questionable stays visible).
Derived values skip UNAVAILABLE players in both calibration and gap-fill, so we don't invent a value
for a ruled-out player from a projection we'd otherwise zero. Advisor context waiver targets carry
`injuryStatus` too. +2 tests (32 total).
  - **Finding:** the earlier "Watson as top waiver/derived value" was a *red herring* — Sleeper reports
    `injuryStatus = null` for him even after a fresh `sync-players` (884 injured now), and he has a real
    13.13 projection, so he's genuinely an un-rostered projectable QB, correctly NOT gated. Live check:
    **zero** ruled-out free agents in the CS Guillotine pool carry a nonzero projection — the projection
    sources already suppress Out players — so the gate is mainly a consistency *safeguard* + the badge.

**#2 Guillotine survival polish.** `buildLeagueContext` now includes a `survival` block for
play-the-field leagues (rank, cushion, elim line, on-the-block, survivalProb), and the advisor system
prompt has a Guillotine rule: no H2H opponent, maximize this week's total, raise urgency as the
cushion shrinks. Survival also prints in the trace GATHER stage. League page renders a **full
standings strip** under the survival banner (all 15 teams, safest→on-the-block, you highlighted).
Verified live: `context.survival` = rank 4/15, +25.8 cushion, elim 90.57 (J0nnyBgood), 95.7% survive.

## 2026-09-22 — Advisor terminal trace (for demos/teaching)

Narrates the advisor agent's run to the **server console** (terminal running `npm run dev`) — nothing
in the UI. `lib/agent/trace.ts` prints three labeled stages: ① GATHER (the grounded context — optimal
lineup, injuries, waiver targets, FAAB — "all the model gets to see"), ② REASON (**the model's own
thinking blocks**, which advisor.ts previously discarded — now captured from `response.content` where
`type === "thinking"` and printed before dropping), ③ DECIDE (final prioritized moves + token usage +
elapsed time). Wired: `traceStart`/`traceGather` in the recommendations route, `traceReason`/
`traceDecide` in `generateRecommendations`. Toggle via `ADVISOR_TRACE` (1 force on / 0 off; on by
default in dev). GATHER works with no API key; REASON/DECIDE need `ANTHROPIC_API_KEY` (the real Claude
call). tsc + lint clean, 30 tests pass.

## 2026-09-22 — Deeper trade values (projection-derived gap-fill; key-free)

FantasyCalc only ranks ~199 players/format (confirmed: `limit` param doesn't lift it — those are the
actively-traded players), so deep-league players (15-team SF) showed blank/zero value in waivers +
trades. Added a **second value source: projection-derived estimates calibrated to FantasyCalc's own
scale**, so every projected skill player gets a value.

- `lib/values/calibrate.ts` (pure, unit-tested): `fitPowerLaw` = OLS of ln(value) on ln(proj) →
  value ≈ a·projᵇ; `fitValueModels` fits **one curve per position** (positional scarcity falls out of
  the market data — a 15-pt RB > 15-pt QB in 1QB) with a **global fallback** for thin positions;
  `predictValue` floors at 1. Needs ≥4 spread points to fit a position, else falls back.
- `lib/ingest/derived-values.ts` `refreshDerivedValues(ctx)`: calibrates on players that have BOTH a
  FantasyCalc value and a current-week consensus projection, then **gap-fills** projected QB/RB/WR/TE
  with no FantasyCalc row. Stored in the same `TradeValue` table as `source="derived"` (K/DEF left
  blank — no market to calibrate). Migration `trade_value_source` adds `source` (default
  "fantasycalc"); FantasyCalc ingest now tags/clears only its own rows, so the two sources coexist
  under the existing `@@unique(sleeperId, format)`.
- Wired: `refresh-trade-values` cron runs market then derived; `refreshTradeValuesForUser` too.
- Readers surface it: waivers `valueEstimated`, trade `estimated` (vs truly `missing`). UI shows a
  `~` prefix for estimates (waiver table + trade sides) and the trade warning distinguishes
  "estimated → approximate" from "no value → floor". +5 calibrate tests (30 total).

## 2026-09-21 — Guillotine survival view (DONE, verified live; key-free)

Fills the gap the matchup banner leaves in play-the-field (Guillotine) leagues, where there's no
head-to-head opponent so the matchup banner correctly hides.

- `lib/features/survival.ts`:
  - `getSurvival(teamId, week?)` (DB wrapper, Sleeper-only). **Guillotine detection** = fetch the
    week's matchups; if no `matchup_id` pairs two rosters it's play-the-field → compute; if any
    pairs (H2H) or there are no rows → return `null` (banner hides). Projects every active team's
    total from its set starters via the same consensus blend matchup uses; eliminated teams (no set
    starters → 0) drop out.
  - `computeSurvival(week, teams)` (pure, unit-tested): ranks by projection, finds the elimination
    line (lowest active proj = "on the block"), and a **cushion** = points above safety (margin over
    the block if you're clear; negative deficit up to the second-lowest if *you're* on the block).
  - `survivalProbability(myProj, others, σ=27)` = 1 − P(you post the strict low score), via numeric
    integration ∫ f_me(x)·∏ P(Xⱼ>x) dx (per-team σ=27, i.e. matchup's combined 38/√2). Deterministic.
- UI: survival banner on the league page (`app/(app)/league/[id]/page.tsx`) — Week, survive %,
  projected/live, rank N of M, cushion above/below the line, elim line + who's on the block.
- 7 new unit tests (`tests/survival.test.ts`); one caught a real modeling bug (cushion is 0, not
  negative, when you're last unless you measure to the second-lowest — fixed).

**Verified live (Week 2, real DB + Sleeper API):** CS Guillotine (15-team) → rank 4/15, proj 116.37,
cushion +25.8 over elim line 90.57 (J0nnyBgood), 96% survive. Panini CS & Escalated Calls (H2H) →
`null` (correctly not applicable). tsc + lint clean, 25 tests pass.

## 2026-09-20 — Injuries + matchups (DONE, verified live; key-free)

Two Sleeper-native, no-API-key features while the Anthropic key is pending.

**Injuries & status**
- Captured `injury_status` from the Sleeper catalog (already downloaded) → `Player.injuryStatus`
  (migration `player_injury_status`); `syncPlayerCatalog` now refreshes it. Re-sync populated 722
  currently-injured players.
- Start/sit is injury-aware: `UNAVAILABLE_STATUS` (Out/Doubtful/IR/PUP/Sus/NA/DNR/COV) players are
  projected 0 so the optimizer benches them (surfacing as a swap); `startSitForTeam` returns
  `injuryAlerts` (rostered players with a designation, starters first).
- UI: shared `components/InjuryBadge.tsx` (Q amber, else red) on the start/sit lineup + dashboard
  rosters; an injury-alert banner on the league page. Advisor context now includes `injuries` and
  the system prompt tells it to act on them.

**Matchups / opponent**
- `lib/features/matchup.ts` `getMatchup(teamId, week)` — groups Sleeper matchups by `matchup_id`,
  finds the opponent, computes each side's projected score from set starters' consensus projections,
  reads live `points`, and a win probability (normal model, combined stdev ~38).
- UI: a matchup banner on the league page (my proj/live vs opponent proj/live + win %).

**Verified live (Week 2):** Escalated Calls (14-team H2H) shows "Manufactured Damage 131.88 proj /
22.5 live vs Expired 2023 Wemby 132.82, 49% win"; PUP Zach Charbonnet flagged + benched by the
optimizer; Ladd McConkey (Q) badged in CS Guillotine's lineup. tsc clean, 18 tests pass.

**Note:** CS Guillotine is a Guillotine format (no head-to-head — play the field, low scorer
eliminated), so the matchup banner correctly hides there. Future: show "projected total vs the
survival line" for Guillotine leagues instead.

## 2026-09-20 — Phase 3: AI advisor agent (BUILT; needs ANTHROPIC_API_KEY to run)

Reframed from a chatbot (user's call) to a proactive **advisor agent**: one click generates a
prioritized list of concrete moves for a league — start/sit, waiver adds (with FAAB + who to drop),
and trade angles — grounded strictly in the numbers we already compute.

**Built**
- `lib/agent/context.ts` — `buildLeagueContext(teamId)` assembles a compact JSON context (league
  format, optimal lineup + deltas from `startSitForTeam`, bench, waiver targets from `waiverTargets`,
  FantasyCalc values). This is the only thing the LLM sees.
- `lib/agent/advisor.ts` — `generateRecommendations(context, model)` calls Claude (Anthropic SDK)
  with a strict system prompt (advise-only, no invented injuries/news, output JSON only) and parses
  the moves. **Model is selectable**: `ADVISOR_MODELS` = Sonnet 5 (default) / Opus 5 / Haiku 4.5;
  `DEFAULT_ADVISOR_MODEL = claude-sonnet-5`; adaptive thinking on Sonnet/Opus, skipped on Haiku.
- `Recommendation` Prisma model (migration `recommendations`) caches a report per team+season+week
  (summary + moves JSON + which model). Regenerated on demand via "Refresh".
- `app/api/recommendations/route.ts` (POST {teamId, model}) — auth + ownership check, validates the
  model against the allowlist, builds context, generates, upserts, returns.
- UI: `league/[id]/Recommendations.tsx` — model dropdown + Generate/Refresh, renders prioritized
  moves with type/confidence badges; wired into the league page as the headline section. Dashboard
  now shows a cross-league "This week's moves" digest from cached recommendations.
- Upgraded `@anthropic-ai/sdk` 0.40 → 0.127 (needed for claude-sonnet-5/opus-5 + adaptive thinking).

**Verified:** tsc clean; UI renders (model picker: Sonnet 5 default, Opus 5, Haiku 4.5 + Generate).
**NOT verified live** — no `ANTHROPIC_API_KEY` set yet. To finish: add the key to `.env`, restart,
click Generate on a league, confirm the JSON parses and the moves are sensible. Errors surface
cleanly (missing-key path returns a clear message).

**Cost note:** Sonnet 5 ≈ $2/$10 per MTok; a generation is ~1–2k in + ~1k out (a cent or two).
Opus 5 is sharper/pricier, Haiku 4.5 cheapest.

## 2026-09-20 — Yahoo connect: BLOCKED by Yahoo's new API approval gate

Attempted to connect Yahoo live. OAuth works end-to-end (auth → code → token exchange succeeds,
tokens saved). But **every Fantasy API call returns 403 "This application is not authorized to use
the Fantasy Sports API."**

Root cause is external: **as of 2026-07-22 Yahoo removed self-serve Fantasy Sports API access.**
`developer.yahoo.com/fantasysports` now redirects to `sports.yahoo.com/developer` — a manual
apply-and-review approval program. A freshly created app (with Fantasy Sports–Read checked) is NOT
provisioned for the API until Yahoo approves it. Nothing in the app settings fixes this; editing an
existing app to add the permission also doesn't help.

**Status:** our code is correct and ready. To use Yahoo, Alex must apply at
`sports.yahoo.com/developer/access/` (include the existing Client ID) and wait for approval; once
approved the existing flow should work with no code change.

**Work done this session (kept, unblocked-ready):**
- Replaced the `yahoo-fantasy` npm package (fails to load under Next 16 Turbopack:
  "Failed to load external module … Function.prototype.apply was called on undefined") with a direct
  REST client `lib/yahoo/api.ts` + rewritten `lib/yahoo/ingest.ts` (parses Yahoo's nested JSON;
  maps Yahoo slot labels W/R/T→FLEX, Q/W/R/T→SUPER_FLEX; derives ppr from stat_id 11, numQbs, FAAB).
  Removed the dependency, its `.d.ts`, and the `serverExternalPackages` entry.
- Local HTTPS dev for the OAuth redirect: self-signed cert in `/certs` (gitignored, generated with
  openssl — `next dev --experimental-https` hung on mkcert's CA-install prompt), `npm run dev:https`,
  and a `fantasy-agent-https` launch config. Redirect URI = `https://localhost:3005/api/yahoo/callback`.
- A yahoo Connection row with valid tokens now exists (tokens save before ingest); it has no leagues
  until API access is granted. `refreshYahooLeagues(connectionId)` can be re-run then.

## Roadmap & next steps

**Done so far (Phases 0–2):** a working, advise-only decision tool. Connect Sleeper by username →
your leagues/rosters import; the app shows an optimal start/sit (from a Sleeper+ESPN projection
consensus), waiver targets with suggested FAAB bids, and a trade analyzer valued for each league's
exact format. Verified live on 3 real leagues. Yahoo read-only OAuth is built but untested.

**Immediate next — finish Phase 3 (advisor agent is BUILT, not yet run)**
- Add `ANTHROPIC_API_KEY` to `.env`, restart, and click **Generate** on a league to verify the
  advisor end-to-end (JSON parses, moves are sensible, dashboard digest populates). Note: the design
  changed from a chatbot to a proactive advisor — it hands you prioritized moves, you don't ask it
  questions. Model is selectable (Sonnet 5 default / Opus 5 / Haiku 4.5).
- Likely follow-ups once it runs: tune the system prompt, add a "generate all leagues" action on the
  dashboard, and show a rough token/cost estimate.

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
- ~~**CBS + FantasyPros consensus**~~ **DONE 2026-09-25** as CBS + FFToday (FantasyPros is login-gated).
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
