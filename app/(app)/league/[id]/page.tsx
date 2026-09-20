import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { startSitForTeam } from "@/lib/features/startsit";
import { waiverTargets } from "@/lib/features/waivers";
import { getMatchup } from "@/lib/features/matchup";
import { InjuryBadge } from "@/components/InjuryBadge";
import { TradeAnalyzer } from "./TradeAnalyzer";
import { Recommendations } from "./Recommendations";

export const dynamic = "force-dynamic";

// Compact slot labels so long ones (SUPER_FLEX) don't overflow.
const SLOT_LABELS: Record<string, string> = { SUPER_FLEX: "SFLX", IDP_FLEX: "IDP" };
const slotLabel = (s: string) => SLOT_LABELS[s] ?? s;

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

  const [startSit, waivers, matchup] = await Promise.all([
    startSitForTeam(myTeam.id),
    waiverTargets(myTeam.id, { limit: 15 }),
    getMatchup(myTeam.id).catch(() => null),
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
                    {t.nflTeam ? <span className="text-muted"> · {t.nflTeam}</span> : ""}
                  </td>
                  <td className="py-1 pr-2 text-muted">{t.position}</td>
                  <td className="py-1 pr-2 text-right">{t.proj}</td>
                  <td className="py-1 pr-2 text-right text-muted">{t.value || "—"}</td>
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
        </p>
      </section>

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

