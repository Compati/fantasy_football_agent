// Surface ingested sportsbook player props for a set of players (a team's
// lineup + waiver targets). A market cross-check alongside the consensus
// projection, not a replacement for it — sportsbooks price in game script,
// injury news, and public perception our projection sources may lag on.

import { prisma } from "@/lib/db";
import { playerDetailMap } from "@/lib/players";
import { impliedProbability } from "@/lib/odds";

export interface PlayerPropSummary {
  sleeperId: string;
  name: string;
  passYdsLine: number | null;
  rushYdsLine: number | null;
  recYdsLine: number | null;
  anytimeTdProb: number | null; // 0-1, implied from American odds (vig included)
}

export async function propsForPlayers(
  sleeperIds: string[],
  season: number,
  week: number,
): Promise<PlayerPropSummary[]> {
  if (sleeperIds.length === 0) return [];

  const rows = await prisma.playerProp.findMany({
    where: { sleeperId: { in: sleeperIds }, season, week },
  });
  if (rows.length === 0) return [];

  const names = await playerDetailMap([...new Set(rows.map((r) => r.sleeperId))]);
  const bySleeperId = new Map<string, PlayerPropSummary>();

  for (const r of rows) {
    const existing = bySleeperId.get(r.sleeperId) ?? {
      sleeperId: r.sleeperId,
      name: names.get(r.sleeperId)?.name ?? r.sleeperId,
      passYdsLine: null,
      rushYdsLine: null,
      recYdsLine: null,
      anytimeTdProb: null,
    };
    if (r.market === "player_pass_yds") existing.passYdsLine = r.line;
    else if (r.market === "player_rush_yds") existing.rushYdsLine = r.line;
    else if (r.market === "player_reception_yds") existing.recYdsLine = r.line;
    else if (r.market === "player_anytime_td" && r.yesPrice != null) {
      existing.anytimeTdProb = impliedProbability(r.yesPrice);
    }
    bySleeperId.set(r.sleeperId, existing);
  }

  return [...bySleeperId.values()];
}
