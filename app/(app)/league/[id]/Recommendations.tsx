"use client";

import { useState } from "react";

interface Move {
  priority: number;
  type: "start_sit" | "waiver" | "trade" | "hold";
  title: string;
  detail: string;
  confidence: "high" | "medium" | "low";
}

interface RecData {
  summary: string;
  moves: Move[];
  generatedAt: string | null;
  model?: string;
}

export const MODEL_OPTIONS = [
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];
const MODEL_LABEL: Record<string, string> = Object.fromEntries(
  MODEL_OPTIONS.map((m) => [m.id, m.label]),
);

const TYPE_LABEL: Record<Move["type"], string> = {
  start_sit: "Start/Sit",
  waiver: "Waiver",
  trade: "Trade",
  hold: "Hold",
};
const TYPE_COLOR: Record<Move["type"], string> = {
  start_sit: "var(--accent)",
  waiver: "var(--good)",
  trade: "var(--warn)",
  hold: "var(--muted)",
};

export function Recommendations({ teamId, initial }: { teamId: string; initial: RecData | null }) {
  const [data, setData] = useState<RecData | null>(initial);
  const [model, setModel] = useState<string>(initial?.model ?? "claude-sonnet-5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, model }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to generate.");
      setData({ summary: json.summary, moves: json.moves, generatedAt: json.generatedAt, model: json.model });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4 mb-5">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-medium">Coach&rsquo;s recommendations</h2>
        <div className="flex items-center gap-2">
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
            onClick={generate}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? "Thinking…" : data ? "Refresh" : "Generate"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      {!data && !error && (
        <p className="text-sm text-muted">
          Have the advisor review your roster, projections, waivers, and trade market, and hand you a
          prioritized set of moves for the week.
        </p>
      )}

      {data && (
        <>
          <p className="text-sm mb-3">{data.summary}</p>
          <ol className="space-y-2">
            {data.moves.map((m, i) => (
              <li key={i} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
                    style={{ color: TYPE_COLOR[m.type], borderColor: TYPE_COLOR[m.type], border: "1px solid" }}
                  >
                    {TYPE_LABEL[m.type]}
                  </span>
                  <span className="font-medium text-sm flex-1">{m.title}</span>
                  <span className="text-[10px] text-muted uppercase">{m.confidence}</span>
                </div>
                <p className="text-sm text-muted">{m.detail}</p>
              </li>
            ))}
          </ol>
          {data.generatedAt && (
            <p className="mt-2 text-xs text-muted">
              Generated {new Date(data.generatedAt).toLocaleString()}
              {data.model ? ` · ${MODEL_LABEL[data.model] ?? data.model}` : ""} · advise-only, you make
              the moves.
            </p>
          )}
        </>
      )}
    </section>
  );
}
