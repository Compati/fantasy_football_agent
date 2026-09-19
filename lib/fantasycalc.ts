// FantasyCalc client — free public API, no auth. Returns market trade values
// and rankings derived from real fantasy trades, updated several times a day.
//
// Endpoint (verified):
//   https://api.fantasycalc.com/values/current?isDynasty=&numQbs=&numTeams=&ppr=
// Each entry carries player.sleeperId, which is our canonical join key.

import { getJson } from "@/lib/http";
import type { ScoringContext, TradeValueRow } from "@/lib/types";

const BASE = "https://api.fantasycalc.com/values/current";

interface FcEntry {
  value: number;
  redraftValue?: number;
  overallRank: number;
  positionRank?: number;
  trend30Day?: number;
  maybeTier?: number | null;
  player: {
    name: string;
    position: string;
    sleeperId?: string | number | null;
  };
}

export async function getTradeValues(
  ctx: ScoringContext,
  isDynasty = false,
): Promise<TradeValueRow[]> {
  const params = new URLSearchParams({
    isDynasty: String(isDynasty),
    numQbs: String(ctx.numQbs),
    numTeams: String(ctx.numTeams),
    ppr: String(ctx.ppr),
  });
  const raw = await getJson<FcEntry[]>(`${BASE}?${params.toString()}`);
  return raw.map((e) => ({
    sleeperId: e.player.sleeperId != null ? String(e.player.sleeperId) : null,
    name: e.player.name,
    position: e.player.position,
    value: e.value,
    redraftValue: e.redraftValue ?? e.value,
    overallRank: e.overallRank,
    positionRank: e.positionRank ?? 0,
    trend30Day: e.trend30Day ?? 0,
    tier: e.maybeTier ?? null,
  }));
}
