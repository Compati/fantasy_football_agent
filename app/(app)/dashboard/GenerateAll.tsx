"use client";

// One click to run the advisor for every league (in parallel, same endpoint as
// each league page's Generate button), then refresh the digest below.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MODEL_OPTIONS } from "../league/[id]/Recommendations";

type Status = "idle" | "running" | "done" | "error";

export function GenerateAll({ teams }: { teams: { teamId: string; leagueName: string }[] }) {
  const router = useRouter();
  const [model, setModel] = useState("claude-sonnet-5");
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const busy = Object.values(status).includes("running");

  async function run() {
    setErrors({});
    setStatus(Object.fromEntries(teams.map((t) => [t.teamId, "running" as Status])));
    await Promise.all(
      teams.map(async (t) => {
        try {
          const res = await fetch("/api/recommendations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ teamId: t.teamId, model }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? "Failed to generate.");
          setStatus((s) => ({ ...s, [t.teamId]: "done" }));
        } catch (e) {
          setStatus((s) => ({ ...s, [t.teamId]: "error" }));
          setErrors((er) => ({ ...er, [t.teamId]: (e as Error).message }));
        }
      }),
    );
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={model}
        onChange={(e) => setModel(e.target.value)}
        disabled={busy}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-60"
        aria-label="Advisor model"
      >
        {MODEL_OPTIONS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <button
        onClick={run}
        disabled={busy || teams.length === 0}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
      >
        {busy ? "Generating…" : `Generate all ${teams.length} leagues`}
      </button>
      {teams.map((t) =>
        status[t.teamId] && status[t.teamId] !== "idle" ? (
          <span
            key={t.teamId}
            className={`text-xs ${status[t.teamId] === "error" ? "text-bad" : status[t.teamId] === "done" ? "text-good" : "text-muted"}`}
            title={errors[t.teamId]}
          >
            {t.leagueName}: {status[t.teamId] === "running" ? "…" : status[t.teamId] === "done" ? "✓" : "failed"}
          </span>
        ) : null,
      )}
    </div>
  );
}
