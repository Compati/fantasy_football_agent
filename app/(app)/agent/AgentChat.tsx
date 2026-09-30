"use client";

import { useRef, useState, type ReactNode } from "react";
import { MODEL_OPTIONS } from "../league/[id]/Recommendations";

interface ToolStep {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "running" | "ok" | "error";
  summary?: string;
  ms?: number;
}

// The agent's timeline: its one-line plans interleaved with the tool calls.
type Step = ({ kind: "plan"; id: string; text: string }) | ({ kind: "tool" } & ToolStep);

interface Exchange {
  question: string;
  steps: Step[];
  answer: string | null;
  error: string | null;
  stats: { turns: number; toolCalls: number; inputTokens: number; outputTokens: number; ms: number } | null;
}

const EXAMPLES = [
  "Which of my leagues needs the most attention this week, and why?",
  "Do I have any lineup mistakes set right now in any league?",
  "Who's the best waiver add in each of my FAAB leagues, and what should I bid?",
  "Am I safe from elimination in my Guillotine league?",
];

// Friendly labels for the live step list.
const TOOL_LABEL: Record<string, string> = {
  list_my_leagues: "Listing your leagues",
  get_lineup_advice: "Checking lineup",
  get_matchup: "Checking matchup",
  get_waiver_targets: "Scanning waivers",
  lookup_player: "Looking up player",
  get_trade_ideas: "Searching trade ideas",
  evaluate_trade: "Scoring trade",
  get_roster_outlook: "Checking byes & depth",
  get_player_news: "Reading news",
};

function stepArgs(input: Record<string, unknown>): string {
  return Object.values(input)
    .map((v) => (Array.isArray(v) ? v.join(", ") : String(v)))
    .join(" · ");
}

export function AgentChat() {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [question, setQuestion] = useState("");
  const [model, setModel] = useState("claude-sonnet-5");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Patch the in-flight (last) exchange.
  const patch = (fn: (x: Exchange) => Exchange) =>
    setExchanges((xs) => (xs.length ? [...xs.slice(0, -1), fn(xs[xs.length - 1])] : xs));

  async function ask(q: string) {
    q = q.trim();
    if (!q || busy) return;
    // Prior completed turns become conversation history for follow-ups.
    const history = exchanges
      .filter((x) => x.answer)
      .flatMap((x) => [
        { role: "user" as const, text: x.question },
        { role: "assistant" as const, text: x.answer as string },
      ]);
    setExchanges((xs) => [...xs, { question: q, steps: [], answer: null, error: null, stats: null }]);
    setQuestion("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history, model }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(JSON.parse(line));
      }
    } catch (e) {
      patch((x) => ({ ...x, error: (e as Error).message }));
    } finally {
      setBusy(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  function handle(e: { type: string } & Record<string, unknown>) {
    if (e.type === "plan") {
      patch((x) => ({ ...x, steps: [...x.steps, { kind: "plan", id: `plan-${x.steps.length}`, text: e.text as string }] }));
    } else if (e.type === "tool_call") {
      patch((x) => ({
        ...x,
        steps: [
          ...x.steps,
          {
            kind: "tool",
            id: e.id as string,
            name: e.name as string,
            input: e.input as Record<string, unknown>,
            status: "running",
          },
        ],
      }));
    } else if (e.type === "tool_result") {
      patch((x) => ({
        ...x,
        steps: x.steps.map((s) =>
          s.kind === "tool" && s.id === e.id
            ? { ...s, status: e.ok ? "ok" : "error", summary: e.summary as string, ms: e.ms as number }
            : s,
        ),
      }));
    } else if (e.type === "answer") {
      patch((x) => ({ ...x, answer: e.text as string }));
    } else if (e.type === "done") {
      patch((x) => ({ ...x, stats: e as unknown as Exchange["stats"] }));
    } else if (e.type === "error") {
      patch((x) => ({ ...x, error: e.message as string }));
    }
  }

  return (
    <div>
      {exchanges.length === 0 && (
        <div className="grid gap-2 sm:grid-cols-2 mb-5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => ask(ex)}
              className="text-left text-sm rounded-xl border border-border bg-surface p-3 hover:border-accent"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-5">
        {exchanges.map((x, i) => (
          <div key={i} className="grid gap-2">
            <div className="self-end ml-auto max-w-[85%] rounded-xl bg-accent text-[var(--accent-fg)] px-3 py-2 text-sm">
              {x.question}
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              {x.steps.length > 0 && (
                <ol className="mb-3 grid gap-1 text-xs">
                  {x.steps.map((s) =>
                    s.kind === "plan" ? (
                      <li key={s.id} className="flex items-start gap-2 mt-1 first:mt-0 italic">
                        <span className="w-4 shrink-0 not-italic">🧠</span>
                        <span className="flex-1">{s.text}</span>
                      </li>
                    ) : (
                      <li key={s.id} className="flex items-start gap-2">
                        <span className="w-4 shrink-0">
                          {s.status === "running" ? "⏳" : s.status === "ok" ? "🔧" : "⚠️"}
                        </span>
                        <span className="flex-1">
                          <span className="font-medium">{TOOL_LABEL[s.name] ?? s.name}</span>
                          {stepArgs(s.input) && <span className="text-muted"> · {stepArgs(s.input)}</span>}
                          <span className="font-mono text-muted"> {s.name}()</span>
                          {s.summary && (
                            <span className={`block ${s.status === "error" ? "text-bad" : "text-muted"}`}>
                              ↳ {s.summary}
                            </span>
                          )}
                        </span>
                        {s.ms != null && <span className="text-muted">{s.ms}ms</span>}
                      </li>
                    ),
                  )}
                </ol>
              )}
              {!x.answer && !x.error && busy && i === exchanges.length - 1 && (
                <p className="text-sm text-muted">{x.steps.length ? "Thinking about what it found…" : "Planning…"}</p>
              )}
              {x.answer && <Markdown text={x.answer} />}
              {x.error && <p className="text-sm text-bad mt-2">{x.error}</p>}
              {x.stats && (
                <p className="mt-3 text-xs text-muted">
                  {x.stats.turns} turn{x.stats.turns === 1 ? "" : "s"} · {x.stats.toolCalls} tool call
                  {x.stats.toolCalls === 1 ? "" : "s"} · {(x.stats.ms / 1000).toFixed(1)}s ·{" "}
                  {x.stats.inputTokens.toLocaleString()} in / {x.stats.outputTokens.toLocaleString()} out tokens
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
      <div ref={bottomRef} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="mt-5 flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={exchanges.length ? "Ask a follow-up…" : "Ask about your leagues…"}
          disabled={busy}
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm disabled:opacity-60"
        />
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={busy}
          className="rounded-md border border-border bg-surface px-2 py-2 text-xs disabled:opacity-60"
          aria-label="Agent model"
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="rounded-md bg-accent text-[var(--accent-fg)] px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {busy ? "Working…" : "Ask"}
        </button>
      </form>
    </div>
  );
}

// Minimal markdown for the agent's answers: headings, bullets, **bold**.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={blocks.length} className="list-disc pl-5 grid gap-1">
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(
      heading ? (
        <p key={blocks.length} className="font-semibold mt-1">
          {inline(heading[1])}
        </p>
      ) : (
        <p key={blocks.length}>{inline(line)}</p>
      ),
    );
  }
  flush();
  return <div className="text-sm grid gap-2">{blocks}</div>;
}
