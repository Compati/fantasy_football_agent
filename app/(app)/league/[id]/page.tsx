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
import { InjuryBadge } from "@/components/InjuryBadge";
import { TradeAnalyzer } from "./TradeAnalyzer";
import { Recommendations } from "./Recommendations";

export const dynamic = "force-dynamic";

// Compact slot labels so long ones (SUPER_FLEX) don't overflow.
const SLOT_LABELS: Record<string, string> = { SUPER_FLEX: "SFLX", IDP_FLEX: "IDP" };
const slotLabel = (s: string) => SLOT_LABELS[s] ?? s;

// ["RB","RB","WR"] -> "2 RB, 1 WR"
function slotCounts(slots: string[]): string {
  const counts = new Map<string, number>();
  for (const s of slots) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts.entries()].map(([s, n]) => `${n} ${slotLabel(s)}`).join(", ");
}

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const league = await prisma.league.findFirst({
    where: { id, connection: { userId: user.id } },
    include: { teams: { include: { roster: true } } },
  });
  if (!league) notFound();

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

  const news = await newsForPlayers(
    [
      ...myTeam.roster.map((r) => r.sleeperId).filter((id): id is string => !!id),
      ...waivers.targets.map((t) => t.sleeperId),
    ],
    8,
  ).catch(() => []);

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
              <span className="text-xs text-muted">
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
              .map((c) => `${c.starter.name} over ${c.alternative.name} (+${c.gap})`)
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
                <th className="py-1 pr-2 text-right">FAAB bid</th>
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
                  <td className="py-1 pr-2 text-right">
                    {t.faab.dollars != null ? `$${t.faab.dollars}` : `${t.faab.pct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          FAAB suggested as a % of your remaining budget, sized by projection and market trend.
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

