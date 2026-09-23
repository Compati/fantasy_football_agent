// The Odds API client (https://the-odds-api.com) — player prop markets only.
// Free tier: 500 credits/month. Listing events is free; fetching a single
// event's odds costs (markets requested x regions) credits — verified live:
// 3 markets x 1 region = 3 credits/event. Keep both the market list and the
// set of events fetched tight; see lib/ingest/props.ts for the budget math.

import { canonicalTeamName } from "@/lib/teams";

const BASE = "https://api.the-odds-api.com/v4";
const SPORT = "americanfootball_nfl";
// Preferred sportsbook for a consistent line; falls back to the first present.
const PREFERRED_BOOK = "draftkings";

export function oddsApiConfigured(): boolean {
  return !!process.env.ODDS_API_KEY;
}

export interface NflEvent {
  id: string;
  commenceTime: Date;
  homeTeam: string; // canonical full name
  awayTeam: string;
}

interface RawEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

// Free call — does not consume quota.
export async function fetchNflEvents(): Promise<NflEvent[]> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error("ODDS_API_KEY is not set");
  const res = await fetch(`${BASE}/sports/${SPORT}/events/?apiKey=${apiKey}`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Odds API events error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as RawEvent[];
  return data.map((e) => ({
    id: e.id,
    commenceTime: new Date(e.commence_time),
    homeTeam: canonicalTeamName(e.home_team),
    awayTeam: canonicalTeamName(e.away_team),
  }));
}

export type PropMarket =
  | "player_pass_yds"
  | "player_rush_yds"
  | "player_reception_yds"
  | "player_anytime_td";

// One normalized market line for one player from the preferred book.
// `line`/`overPrice`/`underPrice` apply to the yardage markets; anytime_td has
// only `yesPrice` (a Yes/No prop, no over/under line).
export interface PlayerPropLine {
  market: PropMarket;
  playerName: string; // raw sportsbook description, e.g. "Michael Penix Jr."
  bookmaker: string;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  yesPrice: number | null;
}

interface RawOutcome {
  name: string; // "Over" | "Under" | "Yes"
  description: string; // player name
  price: number;
  point?: number;
}
interface RawMarketBlock {
  key: string;
  outcomes: RawOutcome[];
}
export interface RawBookmaker {
  key: string;
  markets: RawMarketBlock[];
}
export interface RawEventOdds {
  bookmakers: RawBookmaker[];
}

function pickBookmaker(ev: RawEventOdds): RawBookmaker | null {
  if (ev.bookmakers.length === 0) return null;
  return ev.bookmakers.find((b) => b.key === PREFERRED_BOOK) ?? ev.bookmakers[0];
}

// Pure: fold one event's raw bookmaker markets into one PlayerPropLine per
// player/market from the preferred book. Split out from fetchEventPlayerProps
// so it's unit-testable without a network call.
export function parseEventOdds(data: RawEventOdds, markets: PropMarket[]): PlayerPropLine[] {
  const book = pickBookmaker(data);
  if (!book) return [];

  const byPlayerMarket = new Map<string, PlayerPropLine>();
  for (const market of book.markets) {
    const key = market.key as PropMarket;
    if (!markets.includes(key)) continue;
    for (const outcome of market.outcomes) {
      const mapKey = `${key}|${outcome.description}`;
      const existing = byPlayerMarket.get(mapKey) ?? {
        market: key,
        playerName: outcome.description,
        bookmaker: book.key,
        line: null,
        overPrice: null,
        underPrice: null,
        yesPrice: null,
      };
      if (outcome.name === "Over") {
        existing.line = outcome.point ?? existing.line;
        existing.overPrice = outcome.price;
      } else if (outcome.name === "Under") {
        existing.line = outcome.point ?? existing.line;
        existing.underPrice = outcome.price;
      } else if (outcome.name === "Yes") {
        existing.yesPrice = outcome.price;
      }
      byPlayerMarket.set(mapKey, existing);
    }
  }
  return [...byPlayerMarket.values()];
}

const DEFAULT_MARKETS: PropMarket[] = [
  "player_pass_yds",
  "player_rush_yds",
  "player_reception_yds",
  "player_anytime_td",
];

// Fetch player props for one event. Costs markets.length credits (1 region).
export async function fetchEventPlayerProps(
  eventId: string,
  markets: PropMarket[] = DEFAULT_MARKETS,
): Promise<PlayerPropLine[]> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error("ODDS_API_KEY is not set");

  const url =
    `${BASE}/sports/${SPORT}/events/${eventId}/odds?apiKey=${apiKey}` +
    `&regions=us&markets=${markets.join(",")}&oddsFormat=american`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Odds API event-odds error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as RawEventOdds;
  return parseEventOdds(data, markets);
}

// American odds -> implied probability (vig-included, but fine as a relative
// signal — we're not trying to find +EV bets, just gauge market confidence).
export function impliedProbability(americanOdds: number): number {
  if (americanOdds > 0) return 100 / (americanOdds + 100);
  return -americanOdds / (-americanOdds + 100);
}
