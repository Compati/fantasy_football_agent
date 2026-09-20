import Link from "next/link";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { yahooConfigured } from "@/lib/yahoo/oauth";
import { ConnectPanel } from "./ConnectPanel";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ yahoo?: string }>;
}) {
  const user = await requireUser();
  const { yahoo } = await searchParams;

  const [connections, leagues] = await Promise.all([
    prisma.connection.findMany({ where: { userId: user.id }, select: { platform: true } }),
    prisma.league.findMany({
      where: { connection: { userId: user.id } },
      include: { teams: { where: { isMine: true }, include: { roster: true } } },
      orderBy: [{ platform: "asc" }, { name: "asc" }],
    }),
  ]);

  const hasSleeper = connections.some((c) => c.platform === "sleeper");
  const hasYahoo = connections.some((c) => c.platform === "yahoo");

  return (
    <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Fantasy Agent</h1>
        <p className="text-sm text-muted">Signed in as {user.email}.</p>
      </header>

      {yahoo && (
        <p className={`mb-4 text-sm ${yahoo === "connected" ? "text-good" : "text-bad"}`}>
          {yahoo === "connected" ? "Yahoo connected." : `Yahoo connect: ${yahoo}.`}
        </p>
      )}

      <ConnectPanel hasSleeper={hasSleeper} yahooConfigured={yahooConfigured()} hasYahoo={hasYahoo} />

      <div className="mt-8 grid gap-4">
        {leagues.length === 0 ? (
          <p className="text-sm text-muted">Connect a platform above to see your rosters.</p>
        ) : (
          leagues.map((lg) => {
            const team = lg.teams[0];
            const starters = team?.roster.filter((r) => r.starter) ?? [];
            const bench = team?.roster.filter((r) => !r.starter) ?? [];
            return (
              <section key={lg.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-baseline justify-between">
                  <Link href={`/league/${lg.id}`} className="font-medium text-accent hover:underline">
                    {lg.name} →
                  </Link>
                  <span className="text-xs text-muted uppercase">
                    {lg.platform} · {lg.season} · {lg.numTeams}-team ·{" "}
                    {lg.ppr === 1 ? "PPR" : lg.ppr === 0.5 ? "Half-PPR" : "Std"}
                    {lg.numQbs === 2 ? " · SF" : ""}
                    {lg.faabBudget ? ` · $${lg.faabBudget} FAAB` : ""}
                  </span>
                </div>
                {team ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <RosterList title="Starters" spots={starters} />
                    <RosterList title="Bench" spots={bench} />
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">No team of yours found in this league.</p>
                )}
              </section>
            );
          })
        )}
      </div>
    </main>
  );
}

// Compact slot labels so long ones (SUPER_FLEX) don't overflow the column.
const SLOT_LABELS: Record<string, string> = { SUPER_FLEX: "SFLX", IDP_FLEX: "IDP" };
function slotLabel(slot: string): string {
  return SLOT_LABELS[slot] ?? slot;
}

function RosterList({
  title,
  spots,
}: {
  title: string;
  spots: { id: string; slot: string; name: string; position: string; nflTeam: string | null }[];
}) {
  return (
    <div>
      <h3 className="text-xs font-medium text-muted uppercase mb-1">{title}</h3>
      <ul className="text-sm divide-y divide-border">
        {spots.map((s) => (
          <li key={s.id} className="flex items-center gap-2 py-1">
            <span className="w-14 shrink-0 text-xs font-mono text-muted">{slotLabel(s.slot)}</span>
            <span className="flex-1">{s.name}</span>
            <span className="text-xs text-muted">
              {s.position}
              {s.nflTeam ? ` · ${s.nflTeam}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
