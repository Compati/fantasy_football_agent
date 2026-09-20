import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { startSitForTeam } from "@/lib/features/startsit";
import { waiverTargets } from "@/lib/features/waivers";
import { TradeAnalyzer } from "./TradeAnalyzer";

export const dynamic = "force-dynamic";

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

  const [startSit, waivers] = await Promise.all([
    startSitForTeam(myTeam.id),
    waiverTargets(myTeam.id, { limit: 15 }),
  ]);

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
              <span className="w-14 shrink-0 text-xs font-mono text-muted">{a.slot}</span>
              <span className="flex-1">{a.player?.name ?? "—"}</span>
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
