import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { startSitForTeam } from "@/lib/features/startsit";
import { waiverTargets } from "@/lib/features/waivers";
import { getMatchup } from "@/lib/features/matchup";
import { getSurvival } from "@/lib/features/survival";
import { rosterOutlook } from "@/lib/features/roster";
import { newsForPlayers } from "@/lib/features/news";
import { propsForPlayers } from "@/lib/features/props";
import { refreshSleeperLeagueIfStale } from "@/lib/ingest/sleeper";
import type { PlayerMatchup } from "@/lib/features/opponent";
import type { FaabAdvice } from "@/lib/features/waivers";
import { InjuryBadge } from "@/components/InjuryBadge";
import { TradeAnalyzer } from "./TradeAnalyzer";
import { Recommendations } from "./Recommendations";

export const dynamic = "force-dynamic";

// Compact slot labels so long ones (SUPER_FLEX) don't overflow.
const SLOT_LABELS: Record<string, string> = { SUPER_FLEX: "SFLX", IDP_FLEX: "IDP" };
const slotLabel = (s: string) => SLOT_LABELS[s] ?? s;

// Re-pull rosters from Sleeper when our copy is older than this, so adds/drops
// and lineup changes made in the Sleeper app show up here.
const ROSTER_STALE_MS = 5 * 60_000;

// ["RB","RB","WR"] -> "2 RB, 1 WR"
function slotCounts(slots: string[]): string {
  const counts = new Map<string, number>();
  for (const s of slots) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts.entries()].map(([s, n]) => `${n} ${slotLabel(s)}`).join(", ");
}

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const loadLeague = () =>
    prisma.league.findFirst({
      where: { id, connection: { userId: user.id } },
      include: { teams: { include: { roster: true } } },
    });
  let league = await loadLeague();
  if (!league) notFound();
  // Best effort: if Sleeper is unreachable, render the last-synced roster.
  const refreshed = await refreshSleeperLeagueIfStale(league.id, ROSTER_STALE_MS).catch(() => false);
  if (refreshed) league = (await loadLeague()) ?? league;

  const myTeam = league.teams.find((t) => t.isMine);
  if (!myTeam) {
    return (
      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        <BackLink />
        <p className="mt-4 text-sm text-muted">No team of yours found in {league.name}.</p>
      </main>
    );
  }

  const [startSit, waivers, matchup, survival, outlook] = await Promise.all([
    startSitForTeam(myTeam.id),
    waiverTargets(myTeam.id, { limit: 15 }),
    getMatchup(myTeam.id).catch(() => null),
    getSurvival(myTeam.id).catch(() => null),
    rosterOutlook(myTeam.id).catch(() => null),
  ]);

  const contextIds = [
    ...myTeam.roster.map((r) => r.sleeperId).filter((id): id is string => !!id),
    ...waivers.targets.map((t) => t.sleeperId),
  ];
  const [news, props] = await Promise.all([
    newsForPlayers(contextIds, 8).catch(() => []),
    propsForPlayers(contextIds, league.season, startSit.week).catch(() => []),
  ]);

  const cachedRec = await prisma.recommendation.findUnique({
    where: { teamId_season_week: { teamId: myTeam.id, season: league.season, week: startSit.week } },
  });
  const initialRec = cachedRec
    ? {
        summary: cachedRec.summary,
        moves: cachedRec.moves as unknown as {
          priority: number;
          type: "start_sit" | "waiver" | "trade" | "hold";
          title: string;
          detail: string;
          confidence: "high" | "medium" | "low";
        }[],
        generatedAt: cachedRec.updatedAt.toISOString(),
        model: cachedRec.model,
      }
    : null;

  const myRoster = myTeam.roster
    .filter((r) => r.sleeperId)
    .map((r) => ({ sleeperId: r.sleeperId as string, name: r.name, position: r.position }));
  const otherPlayers = league.teams
    .filter((t) => !t.isMine)
    .flatMap((t) =>
      t.roster
        .filter((r) => r.sleeperId)
        .map((r) => ({ sleeperId: r.sleeperId as string, name: r.name, position: r.position, team: t.name })),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
      <BackLink />
      <header className="mt-2 mb-5">
        <h1 className="text-2xl font-semibold">{league.name}</h1>
        <p className="text-sm text-muted">
          {myTeam.name} · Week {startSit.week} · {league.numTeams}-team{" "}
          {league.ppr === 1 ? "PPR" : league.ppr === 0.5 ? "Half-PPR" : "Std"}
          {league.numQbs === 2 ? " Superflex" : ""}
          {league.faabBudget ? ` · $${waivers.remainingBudget ?? league.faabBudget} FAAB left` : ""}
        </p>
      </header>

      {/* Matchup */}
      {matchup && matchup.opponent && (
        <section className="rounded-xl border border-border bg-surface p-4 mb-5">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <div className="font-medium">{matchup.me.teamName}</div>
              <div className="text-muted">
                Proj {matchup.me.projected}
                {matchup.me.actual > 0 ? ` · Live ${matchup.me.actual}` : ""}
              </div>
            </div>
            <div className="text-center px-3">
              {matchup.winProb != null ? (
                <>
                  <div className={`text-lg font-semibold ${matchup.winProb >= 0.5 ? "text-good" : "text-bad"}`}>
                    {Math.round(matchup.winProb * 100)}%
                  </div>
                  <div className="text-[10px] text-muted uppercase">win prob</div>
                </>
              ) : (
                <div className="text-xs text-muted">vs</div>
              )}
            </div>
            <div className="text-sm text-right">
              <div className="font-medium">{matchup.opponent.teamName}</div>
              <div className="text-muted">
                Proj {matchup.opponent.projected}
                {matchup.opponent.actual > 0 ? ` · Live ${matchup.opponent.actual}` : ""}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Guillotine survival (play-the-field leagues, no head-to-head) */}
      {survival && (
        <section className="rounded-xl border border-border bg-surface p-4 mb-5">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-medium">Survival — Week {survival.week}</h2>
            {survival.survivalProb != null && (
              <span
                className={`text-sm font-semibold ${
                  survival.survivalProb >= 0.85
                    ? "text-good"
                    : survival.survivalProb >= 0.6
                      ? "text-warn"
                      : "text-bad"
                }`}
              >
                {Math.round(survival.survivalProb * 100)}% survive
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              Projected <strong>{survival.myProjected}</strong>
              {survival.myActual > 0 ? <span className="text-muted"> · Live {survival.myActual}</span> : null}
            </span>
            <span>
              Rank{" "}
              <strong className={survival.myRank >= survival.numActive ? "text-bad" : ""}>
                {survival.myRank}
              </strong>{" "}
              <span className="text-muted">of {survival.numActive}</span>
            </span>
            <span
              className={survival.cushion < 0 ? "text-bad" : survival.cushion < 12 ? "text-warn" : "text-muted"}
            >
              {survival.cushion >= 0
                ? `+${survival.cushion} above the line`
                : `${survival.cushion} — below the line`}
            </span>
            <span className="text-muted">
              Elim line {survival.eliminationLine} ({survival.onTheBlock})
            </span>
          </div>

          {/* Full field, safest → most at risk */}
          <ol className="mt-3 space-y-0.5 text-sm">
            {survival.standings.map((t, i) => {
              const onBlock = i === survival.standings.length - 1;
              return (
                <li
                  key={`${t.teamName}-${i}`}
                  className={`flex items-center gap-2 rounded px-1.5 py-0.5 ${
                    t.isMine ? "bg-accent/10 font-medium" : ""
                  } ${onBlock ? "text-bad" : ""}`}
                >
                  <span className="w-5 shrink-0 text-xs text-muted tabular-nums">{i + 1}</span>
                  <span className="flex-1 truncate">
                    {t.teamName}
                    {t.isMine ? " (you)" : ""}
                    {onBlock ? " — on the block" : ""}
                  </span>
                  <span className="tabular-nums">{t.projected}</span>
                  {t.actual > 0 && <span className="text-xs text-muted tabular-nums">· {t.actual} live</span>}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* Advisor recommendations */}
      <Recommendations teamId={myTeam.id} initial={initialRec} />

      {/* Start / Sit */}
      <section className="rounded-xl border border-border bg-surface p-4 mb-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-medium">Start / Sit — Week {startSit.week}</h2>
          <span className={`text-sm ${startSit.delta > 0 ? "text-warn" : "text-good"}`}>
            {startSit.delta > 0
              ? `${startSit.delta} pts left on your bench`
              : "Your lineup is already optimal"}
          </span>
        </div>

        {startSit.injuryAlerts.length > 0 && (
          <div className="mb-3 rounded-lg border border-warn/40 bg-warn/5 p-2 text-sm">
            {startSit.injuryAlerts.map((a, i) => (
              <div key={i} className={a.starting ? "text-bad" : "text-warn"}>
                <InjuryBadge status={a.status} /> {a.player}
                {a.starting ? " — in your starting lineup" : " (bench)"}
              </div>
            ))}
          </div>
        )}

        {startSit.start.length > 0 && (
          <div className="mb-3 text-sm">
            {startSit.start.map((p, i) => (
              <div key={p.sleeperId} className="text-good">
                ▲ Start <strong>{p.name}</strong> ({p.proj}){" "}
                {startSit.sit[i] && (
                  <span className="text-bad">
                    → bench {startSit.sit[i].name} ({startSit.sit[i].proj})
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-1 sm:grid-cols-2">
          {startSit.lineup.map((a, i) => (
            <div key={i} className="flex items-center gap-2 text-sm py-0.5">
              <span className="w-12 shrink-0 text-xs font-mono text-muted">{slotLabel(a.slot)}</span>
              <span className="flex-1">
                {a.player?.name ?? "—"}
                {a.player?.injuryStatus && <InjuryBadge status={a.player.injuryStatus} />}
              </span>
              {a.player?.matchup && <MatchupTag m={a.player.matchup} position={a.player.position} />}
              <span className="text-xs text-muted w-14 text-right">
                {a.player ? `${a.player.proj}` : ""}
                {a.player && a.player.sources < 2 ? " ·1src" : ""}
              </span>
            </div>
          ))}
        </div>

        {startSit.closeCalls.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            Close calls:{" "}
            {startSit.closeCalls
              .slice(0, 3)
              .map(
                (c) =>
                  `${c.starter.name} over ${c.alternative.name} (+${c.gap})` +
                  (c.lean === "alternative"
                    ? ` — matchup favors ${c.alternative.name}`
                    : c.lean === "starter"
                      ? " — matchup agrees"
                      : ""),
              )
              .join(" · ")}
          </p>
        )}
      </section>

      {/* Waivers */}
      <section className="rounded-xl border border-border bg-surface p-4 mb-5">
        <h2 className="font-medium mb-3">Top waiver targets — Week {waivers.week}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted uppercase">
                <th className="py-1 pr-2">Player</th>
                <th className="py-1 pr-2">Pos</th>
                <th className="py-1 pr-2 text-right">Proj</th>
                <th className="py-1 pr-2 text-right">Value</th>
                <th className="py-1 pr-2 text-right">Trend</th>
                <th className="py-1 pr-2 text-right">FAAB range</th>
                <th className="py-1 pr-2 text-right">Bid</th>
              </tr>
            </thead>
            <tbody>
              {waivers.targets.map((t) => (
                <tr key={t.sleeperId} className="border-t border-border">
                  <td className="py-1 pr-2">
                    {t.name}
                    {t.injuryStatus && <InjuryBadge status={t.injuryStatus} />}
                    {t.nflTeam ? <span className="text-muted"> · {t.nflTeam}</span> : ""}
                  </td>
                  <td className="py-1 pr-2 text-muted">{t.position}</td>
                  <td className="py-1 pr-2 text-right">{t.proj}</td>
                  <td className="py-1 pr-2 text-right text-muted">
                    {t.value ? (t.valueEstimated ? `~${t.value}` : t.value) : "—"}
                  </td>
                  <td
                    className={`py-1 pr-2 text-right ${t.trend30 > 0 ? "text-good" : t.trend30 < 0 ? "text-bad" : "text-muted"}`}
                  >
                    {t.trend30 > 0 ? "▲" : t.trend30 < 0 ? "▼" : "–"}
                  </td>
                  <td
                    className="py-1 pr-2 text-right text-muted whitespace-nowrap"
                    title={t.faab ? faabTitle(t.faab) : undefined}
                  >
                    {t.faab ? `$${t.faab.low}–$${t.faab.high}` : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right whitespace-nowrap">
                    {t.faab ? (
                      <>
                        <span className={t.faab.need === "starts" ? "font-medium" : ""}>${t.faab.bid}</span>
                        <span className="ml-1 text-xs text-muted">{t.faab.need}</span>
                        {t.faab.hot && (
                          <span className="ml-1 text-xs text-warn" title="Top trending add across Sleeper — expect a committed bidder">
                            hot
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          FAAB range is priced off this league&apos;s own bids for comparable players: low = beats the
          casual interest (the typical runner-up bid, often $0 since most claims go uncontested; ties
          go to waiver priority), high = beats the committed bidders too (you need him this week).
          Bid = high if he&apos;d clearly start for you (3+ pts over your weakest eligible starter),
          midpoint if a marginal upgrade (3/4 of the way up if he&apos;s <span className="text-warn">hot</span>),
          low if depth. Past seasons of this league count only for weeks near this one (bids shrink as
          budgets drain).
          Hover a range for the basis.
          A <span className="font-mono">~</span> value is a projection-derived estimate (outside FantasyCalc&apos;s set).
        </p>
      </section>

      {/* Roster outlook: upcoming byes + thin positions */}
      {outlook && (outlook.byes.length > 0 || outlook.thinPositions.length > 0) && (
        <section className="rounded-xl border border-border bg-surface p-4 mb-5">
          <h2 className="font-medium mb-3">Roster outlook</h2>

          {outlook.nextByeCrunch && (
            <div className="mb-3 rounded-lg border border-warn/40 bg-warn/5 p-2 text-sm text-warn">
              ⚠ Week {outlook.nextByeCrunch.week} bye crunch: no one to fill{" "}
              {slotCounts(outlook.nextByeCrunch.unfilledSlots)} — plan a pickup before then.
            </div>
          )}

          {outlook.thinPositions.length > 0 && (
            <p className="mb-3 text-sm">
              <span className="text-muted">Thin (no bench behind your starters): </span>
              {outlook.thinPositions.map((t) => `${t.position} (${t.have}/${t.dedicatedStarters})`).join(" · ")}
            </p>
          )}

          {outlook.byes.length > 0 && (
            <div className="text-sm">
              <div className="text-xs text-muted uppercase mb-1">Upcoming byes</div>
              {outlook.byes.slice(0, 6).map((b) => (
                <div key={b.week} className="flex gap-2 py-0.5">
                  <span className="w-14 shrink-0 text-muted">Wk {b.week}</span>
                  <span className="flex-1">
                    {b.playersOnBye.map((p) => `${p.name} (${p.position})`).join(", ")}
                    {b.unfilledSlots.length > 0 && (
                      <span className="text-warn"> — {slotCounts(b.unfilledSlots)} unfilled</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Player props (Phase 5): sportsbook lines, a cross-check alongside the projection */}
      {props.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-4 mb-5">
          <h2 className="font-medium mb-3">Player props — Week {startSit.week}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted uppercase">
                  <th className="py-1 pr-2">Player</th>
                  <th className="py-1 pr-2 text-right">Pass yds</th>
                  <th className="py-1 pr-2 text-right">Rush yds</th>
                  <th className="py-1 pr-2 text-right">Rec yds</th>
                  <th className="py-1 pr-2 text-right">Anytime TD</th>
                </tr>
              </thead>
              <tbody>
                {props.map((p) => (
                  <tr key={p.sleeperId} className="border-t border-border">
                    <td className="py-1 pr-2">{p.name}</td>
                    <td className="py-1 pr-2 text-right text-muted">{p.passYdsLine ?? "—"}</td>
                    <td className="py-1 pr-2 text-right text-muted">{p.rushYdsLine ?? "—"}</td>
                    <td className="py-1 pr-2 text-right text-muted">{p.recYdsLine ?? "—"}</td>
                    <td className="py-1 pr-2 text-right text-muted">
                      {p.anytimeTdProb != null ? `${Math.round(p.anytimeTdProb * 100)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">
            Sportsbook lines (DraftKings where available) for your roster and top waiver targets — a
            market cross-check alongside the projection above, not a replacement for it.
          </p>
        </section>
      )}

      {/* Community context (Phase 4): YouTube, matched to your players */}
      {news.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-4 mb-5">
          <h2 className="font-medium mb-3">News on your roster &amp; targets</h2>
          <div className="space-y-2 text-sm">
            {news.map((n) => (
              <a
                key={n.url}
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border border-border p-2 hover:bg-accent/5"
              >
                <div className="flex items-center gap-2 text-xs text-muted uppercase mb-0.5">
                  <span>YouTube</span>
                  <span>·</span>
                  <span>{n.players.join(", ")}</span>
                </div>
                <div className="font-medium">{n.title}</div>
                {n.summary && <div className="text-muted text-xs mt-0.5 line-clamp-2">{n.summary}</div>}
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Trade analyzer */}
      <TradeAnalyzer leagueId={league.id} myRoster={myRoster} otherPlayers={otherPlayers} />
    </main>
  );
}

function BackLink() {
  return (
    <Link href="/dashboard" className="text-sm text-accent">
      ← Dashboard
    </Link>
  );
}

const MATCHUP_STYLE: Record<PlayerMatchup["label"], string> = {
  great: "text-good font-medium",
  good: "text-good",
  neutral: "text-muted",
  hard: "text-bad",
  tough: "text-bad font-medium",
};

// "vs NYJ · great" — hover for the numbers behind the rating.
function MatchupTag({ m, position }: { m: PlayerMatchup; position: string }) {
  if (!m.opponent) return <span className="text-xs text-muted">bye</span>;
  const detail = [
    m.impliedTotal != null ? `${position === "DEF" ? "Opponent" : "Team"} implied total ${m.impliedTotal}` : null,
    m.dvpRank != null ? `${m.opponent} allows the #${m.dvpRank} most pts to ${position}s` : null,
    `edge ${m.edge >= 0 ? "+" : ""}${Math.round(m.edge * 100)}%`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="text-xs whitespace-nowrap" title={detail}>
      <span className="text-muted">{m.isHome ? "vs" : "@"} {m.opponent}</span>
      {m.label !== "neutral" && <span className={`ml-1 ${MATCHUP_STYLE[m.label]}`}>{m.label}</span>}
    </span>
  );
}

const FAAB_TIER_LABEL: Record<FaabAdvice["tier"], string> = {
  impact: "impact player",
  starter: "starter",
  flex: "flex / streamer",
  depth: "depth",
  dst_k: "DEF / K",
};

function faabTitle(f: FaabAdvice): string {
  const basis =
    f.basis === "league"
      ? `this league's ${f.samples} winning bids (this season + past seasons' weeks near this one)`
      : f.basis === "pooled"
        ? `${f.samples} winning bids across your leagues, scaled to this league's spending`
        : "defaults (no bid history yet)";
  const contest =
    f.contestedShare != null ? ` · ${Math.round(f.contestedShare * 100)}% of them had a competing bid` : "";
  return `${FAAB_TIER_LABEL[f.tier]} tier · based on ${basis}${contest}`;
}
