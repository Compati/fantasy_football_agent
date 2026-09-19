"use client";

import { useActionState } from "react";
import { connectSleeperAction, refreshSleeperAction, type ActionResult } from "./actions";

export function ConnectPanel({
  hasSleeper,
  yahooConfigured,
  hasYahoo,
}: {
  hasSleeper: boolean;
  yahooConfigured: boolean;
  hasYahoo: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    connectSleeperAction,
    null,
  );
  const [refreshState, refreshAction, refreshing] = useActionState<ActionResult | null, FormData>(
    async () => refreshSleeperAction(),
    null,
  );

  return (
    <section className="grid gap-4 sm:grid-cols-2">
      {/* Sleeper */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="font-medium mb-1">Sleeper</h2>
        <p className="text-sm text-muted mb-3">
          Public read-only — just your username pulls every league.
        </p>
        <form action={formAction} className="flex gap-2">
          <input
            name="username"
            placeholder="Sleeper username"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            required
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Connecting…" : hasSleeper ? "Reconnect" : "Connect"}
          </button>
        </form>
        {hasSleeper && (
          <form action={refreshAction} className="mt-2">
            <button
              type="submit"
              disabled={refreshing}
              className="text-xs text-accent underline disabled:opacity-60"
            >
              {refreshing ? "Refreshing…" : "Refresh leagues"}
            </button>
          </form>
        )}
        {state && (
          <p className={`mt-2 text-sm ${state.ok ? "text-good" : "text-bad"}`}>{state.message}</p>
        )}
        {refreshState && (
          <p className={`mt-1 text-sm ${refreshState.ok ? "text-good" : "text-bad"}`}>
            {refreshState.message}
          </p>
        )}
      </div>

      {/* Yahoo */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="font-medium mb-1">Yahoo</h2>
        <p className="text-sm text-muted mb-3">
          One-time read-only sign-in. Never sets your lineup — advise only.
        </p>
        {yahooConfigured ? (
          <a
            href="/api/yahoo/start"
            className="inline-block rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
          >
            {hasYahoo ? "Reconnect Yahoo" : "Connect Yahoo"}
          </a>
        ) : (
          <p className="text-sm text-warn">
            Add YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET to enable (see README).
          </p>
        )}
      </div>
    </section>
  );
}
