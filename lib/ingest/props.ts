// Phase 5: sportsbook player-prop lines (The Odds API), scoped to only the
// games that actually involve one of Alex's rostered players. Free tier is
// 500 credits/month on this key; each event costs markets.length credits
// (verified live: N markets x 1 region = N credits). At 4 markets and a
// typical ~10 relevant games/week, one refresh costs ~40 credits — budget
// for a weekly cadence (~170/month), not more often.

import { prisma } from "@/lib/db";
import { getNflState } from "@/lib/sleeper";
import { weekNumberForDate } from "@/lib/nflweek";
import { normalizeName } from "@/lib/players";
import { teamAbbr } from "@/lib/teams";
import {
  oddsApiConfigured,
  fetchNflEvents,
  fetchEventPlayerProps,
  type PropMarket,
} from "@/lib/odds";

const MARKETS: PropMarket[] = [
  "player_pass_yds",
  "player_rush_yds",
  "player_reception_yds",
  "player_anytime_td",
];
// Only these positions get meaningful yardage/TD props from sportsbooks.
const PROP_POSITIONS = ["QB", "RB", "WR", "TE"];

export interface PropsRefreshResult {
  eventsConsidered: number;
  eventsFetched: number;
  rowsUpserted: number;
  creditsSpent: number;
}

export async function refreshPlayerProps(): Promise<PropsRefreshResult> {
  const empty: PropsRefreshResult = { eventsConsidered: 0, eventsFetched: 0, rowsUpserted: 0, creditsSpent: 0 };
  if (!oddsApiConfigured()) return empty;

  const state = await getNflState();
  const season = Number(state.season);
  const week = state.week > 0 ? state.week : 1;

  const myTeams = new Set(
    (
      await prisma.rosterSpot.findMany({
        where: { team: { isMine: true }, nflTeam: { not: null } },
        select: { nflTeam: true },
        distinct: ["nflTeam"],
      })
    ).map((r) => r.nflTeam as string),
  );
  if (myTeams.size === 0) return empty;

  const events = await fetchNflEvents();
  const relevant = events.filter((e) => {
    if (weekNumberForDate(season, e.commenceTime) !== week) return false;
    const home = teamAbbr(e.homeTeam);
    const away = teamAbbr(e.awayTeam);
    return (!!home && myTeams.has(home)) || (!!away && myTeams.has(away));
  });

  let rowsUpserted = 0;
  let eventsFetched = 0;

  for (const event of relevant) {
    const teamsInGame = [teamAbbr(event.homeTeam), teamAbbr(event.awayTeam)].filter(
      (t): t is string => !!t,
    );
    const players = await prisma.player.findMany({
      where: { nflTeam: { in: teamsInGame }, position: { in: PROP_POSITIONS } },
      select: { sleeperId: true, name: true },
    });
    const byName = new Map(players.map((p) => [normalizeName(p.name), p.sleeperId]));

    const lines = await fetchEventPlayerProps(event.id, MARKETS).catch(() => []);
    eventsFetched++;

    for (const line of lines) {
      const sleeperId = byName.get(normalizeName(line.playerName));
      if (!sleeperId) continue; // not a fantasy-relevant skill player (e.g. a D/ST anytime-TD entry)
      await prisma.playerProp.upsert({
        where: { sleeperId_season_week_market: { sleeperId, season, week, market: line.market } },
        create: {
          sleeperId,
          season,
          week,
          market: line.market,
          line: line.line,
          overPrice: line.overPrice,
          underPrice: line.underPrice,
          yesPrice: line.yesPrice,
          bookmaker: line.bookmaker,
        },
        update: {
          line: line.line,
          overPrice: line.overPrice,
          underPrice: line.underPrice,
          yesPrice: line.yesPrice,
          bookmaker: line.bookmaker,
        },
      });
      rowsUpserted++;
    }
  }

  return { eventsConsidered: relevant.length, eventsFetched, rowsUpserted, creditsSpent: eventsFetched * MARKETS.length };
}
