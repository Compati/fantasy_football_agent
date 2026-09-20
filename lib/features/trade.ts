// Trade evaluation using FantasyCalc market values for the league's exact
// format. Pure scoring (unit-tested) + a DB wrapper that resolves players.

import { prisma } from "@/lib/db";

export interface TradeVerdict {
  giveTotal: number;
  getTotal: number;
  diff: number; // get - give (positive = you gain value)
  pct: number; // diff as % of the larger side
  verdict: string;
  note: string | null;
}

export function scoreTrade(giveValues: number[], getValues: number[]): TradeVerdict {
  const giveTotal = giveValues.reduce((a, b) => a + b, 0);
  const getTotal = getValues.reduce((a, b) => a + b, 0);
  const diff = getTotal - giveTotal;
  const larger = Math.max(giveTotal, getTotal, 1);
  const pct = Math.round((diff / larger) * 100);

  let verdict: string;
  const mag = Math.abs(pct);
  if (mag <= 3) verdict = "Even trade";
  else if (mag <= 10) verdict = diff > 0 ? "Slightly favors you" : "Slightly favors them";
  else if (mag <= 25) verdict = diff > 0 ? "Favors you" : "Favors them";
  else verdict = diff > 0 ? "Strongly favors you" : "Strongly favors them";

  // Consolidation note: trading many-for-few concentrates value into your
  // starting lineup (good in shallow leagues) but thins your depth.
  let note: string | null = null;
  if (getValues.length < giveValues.length) {
    note = "You consolidate (fewer, better players) — strengthens your starters but thins depth.";
  } else if (getValues.length > giveValues.length) {
    note = "You add depth (more players) — helps bye weeks/injuries but dilutes your best assets.";
  }

  return { giveTotal, getTotal, diff, pct, verdict, note };
}

export interface TradeSidePlayer {
  sleeperId: string;
  name: string;
  position: string;
  value: number;
  missing: boolean; // no market value found for the league format
}

export interface TradeEvaluation extends TradeVerdict {
  give: TradeSidePlayer[];
  get: TradeSidePlayer[];
  warning: string | null; // set when a player lacks a market value (verdict unreliable)
}

export async function evaluateTrade(
  leagueId: string,
  giveIds: string[],
  getIds: string[],
): Promise<TradeEvaluation> {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const allIds = [...new Set([...giveIds, ...getIds])];

  const [players, values] = await Promise.all([
    prisma.player.findMany({ where: { sleeperId: { in: allIds } } }),
    prisma.tradeValue.findMany({
      where: {
        sleeperId: { in: allIds },
        isDynasty: false,
        ppr: league.ppr,
        numQbs: league.numQbs,
        numTeams: league.numTeams,
      },
    }),
  ]);
  const nameById = new Map(players.map((p) => [p.sleeperId, p]));
  const valueById = new Map(values.map((v) => [v.sleeperId, v.value]));

  const side = (ids: string[]): TradeSidePlayer[] =>
    ids.map((id) => {
      const p = nameById.get(id);
      const value = valueById.get(id) ?? 0;
      return {
        sleeperId: id,
        name: p?.name ?? id,
        position: p?.position ?? "?",
        value,
        missing: !valueById.has(id),
      };
    });

  const give = side(giveIds);
  const get = side(getIds);
  const verdict = scoreTrade(give.map((p) => p.value), get.map((p) => p.value));

  // FantasyCalc only ranks the top ~196 players per format, so deep-league
  // players can lack a value. Flag that rather than scoring them as 0.
  const missing = [...give, ...get].filter((p) => p.missing).map((p) => p.name);
  const warning =
    missing.length > 0
      ? `No market value for ${missing.join(", ")} (outside FantasyCalc's ranked set) — verdict counts them as 0, so treat it as a floor.`
      : null;

  return { ...verdict, give, get, warning };
}
