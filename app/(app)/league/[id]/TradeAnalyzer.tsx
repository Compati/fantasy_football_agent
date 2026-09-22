"use client";

import { useState, useTransition } from "react";
import { evaluateTradeAction, type TradeActionResult } from "./actions";

interface P {
  sleeperId: string;
  name: string;
  position: string;
  team?: string;
}

export function TradeAnalyzer({
  leagueId,
  myRoster,
  otherPlayers,
}: {
  leagueId: string;
  myRoster: P[];
  otherPlayers: P[];
}) {
  const [give, setGive] = useState<Set<string>>(new Set());
  const [get, setGet] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [result, setResult] = useState<TradeActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  function evaluate() {
    startTransition(async () => {
      setResult(await evaluateTradeAction(leagueId, [...give], [...get]));
    });
  }

  const filtered = otherPlayers.filter((p) =>
    (p.name + " " + p.position + " " + (p.team ?? "")).toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="font-medium mb-3">Trade analyzer</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-medium text-muted uppercase mb-1">You give</h3>
          <ul className="max-h-56 overflow-y-auto text-sm divide-y divide-border">
            {myRoster.map((p) => (
              <li key={p.sleeperId}>
                <label className="flex items-center gap-2 py-1 cursor-pointer">
                  <input type="checkbox" checked={give.has(p.sleeperId)} onChange={() => toggle(give, setGive, p.sleeperId)} />
                  <span className="flex-1">{p.name}</span>
                  <span className="text-xs text-muted">{p.position}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-medium text-muted uppercase mb-1">You get</h3>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter players…"
            className="w-full mb-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
          <ul className="max-h-52 overflow-y-auto text-sm divide-y divide-border">
            {filtered.map((p) => (
              <li key={p.sleeperId}>
                <label className="flex items-center gap-2 py-1 cursor-pointer">
                  <input type="checkbox" checked={get.has(p.sleeperId)} onChange={() => toggle(get, setGet, p.sleeperId)} />
                  <span className="flex-1">
                    {p.name} <span className="text-xs text-muted">({p.team})</span>
                  </span>
                  <span className="text-xs text-muted">{p.position}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <button
        onClick={evaluate}
        disabled={pending || give.size === 0 || get.size === 0}
        className="mt-3 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Evaluating…" : "Evaluate trade"}
      </button>

      {result && "error" in result && <p className="mt-3 text-sm text-bad">{result.error}</p>}
      {result && !("error" in result) && (
        <div className="mt-4 rounded-lg border border-border p-3">
          <div className="flex items-baseline justify-between">
            <span className="font-medium">{result.verdict}</span>
            <span className={`text-sm ${result.diff > 0 ? "text-good" : result.diff < 0 ? "text-bad" : "text-muted"}`}>
              {result.diff > 0 ? "+" : ""}
              {result.diff} value ({result.pct > 0 ? "+" : ""}
              {result.pct}%)
            </span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 text-sm">
            <TradeSide label={`You give (${result.giveTotal})`} players={result.give} />
            <TradeSide label={`You get (${result.getTotal})`} players={result.get} />
          </div>
          {result.warning && <p className="mt-2 text-xs text-warn">⚠ {result.warning}</p>}
          {result.note && <p className="mt-2 text-xs text-muted">{result.note}</p>}
        </div>
      )}
    </section>
  );
}

function TradeSide({
  label,
  players,
}: {
  label: string;
  players: {
    sleeperId: string;
    name: string;
    position: string;
    value: number;
    missing: boolean;
    estimated: boolean;
  }[];
}) {
  return (
    <div>
      <h4 className="text-xs font-medium text-muted uppercase mb-1">{label}</h4>
      <ul>
        {players.map((p) => (
          <li key={p.sleeperId} className="flex justify-between py-0.5">
            <span>
              {p.name} <span className="text-muted">{p.position}</span>
            </span>
            <span className={p.missing ? "text-warn" : "text-muted"}>
              {p.missing ? "no value" : p.estimated ? `~${p.value}` : p.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
