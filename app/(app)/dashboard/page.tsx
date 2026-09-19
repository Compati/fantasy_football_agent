import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";

// Phase 0 shell. Phase 1 fills this with connected leagues + rosters; Phase 2
// adds the start/sit, waiver, and trade panels.
export default async function Dashboard() {
  const user = await requireUser();
  const connections = await prisma.connection.findMany({
    where: { userId: user.id },
    include: { leagues: { include: { teams: true } } },
  });

  return (
    <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Fantasy Agent</h1>
        <p className="text-sm text-muted">
          Signed in as {user.email}. Connect a platform to pull in your leagues.
        </p>
      </header>

      {connections.length === 0 ? (
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="font-medium mb-2">No platforms connected yet</h2>
          <p className="text-sm text-muted">
            Sleeper needs only your username; Yahoo uses a one-time read-only
            sign-in. Connecting arrives in Phase 1.
          </p>
        </section>
      ) : (
        <section className="grid gap-4">
          {connections.map((c) => (
            <div key={c.id} className="rounded-xl border border-border bg-surface p-4">
              <h2 className="font-medium capitalize">{c.platform}</h2>
              <ul className="mt-2 text-sm">
                {c.leagues.map((l) => (
                  <li key={l.id} className="py-1">
                    {l.name} — {l.season} · {l.teams.length} teams
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
