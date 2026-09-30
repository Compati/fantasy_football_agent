import Link from "next/link";
import { requireUser } from "@/lib/session";
import { AgentChat } from "./AgentChat";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  await requireUser();
  return (
    <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
      <Link href="/dashboard" className="text-sm text-accent">
        ← Dashboard
      </Link>
      <header className="mt-2 mb-5">
        <h1 className="text-2xl font-semibold">Ask the agent</h1>
        <p className="text-sm text-muted">
          Ask anything about your leagues. The agent decides which of its tools to use, looks up the live data, and
          answers from it — you can watch each lookup as it happens. Advice only; it never makes moves.
        </p>
      </header>
      <AgentChat />
    </main>
  );
}
