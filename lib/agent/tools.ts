// The agent's toolbox. Each tool is a thin, read-only wrapper around a feature
// function the app already has (lib/features/*). Claude sees only the name,
// the description and the input schema — it decides which to call and when;
// the loop (lib/agent/loop.ts) runs the matching `run` and hands the result
// back. Advise-only: no tool can change anything on Sleeper.
//
// Outputs are trimmed to what a decision needs (every token of a tool result
// is re-read on each later turn of the loop).

import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { getNflState } from "@/lib/sleeper";
import { refreshSleeperLeagueIfStale } from "@/lib/ingest/sleeper";
import { normalizeName } from "@/lib/players";
import { blendProjections } from "@/lib/projections/consensus";
import { injuryAdjustedProj } from "@/lib/features/injury";
import { startSitForTeam, type LineupPlayer } from "@/lib/features/startsit";
import { waiverTargets, type WaiverTarget } from "@/lib/features/waivers";
import { tradeIdeasForTeam, type HorizonIdeas } from "@/lib/features/trade-finder";
import { evaluateTrade } from "@/lib/features/trade";
import { getMatchup } from "@/lib/features/matchup";
import { getSurvival } from "@/lib/features/survival";
import { rosterOutlook } from "@/lib/features/roster";
import { newsForPlayers } from "@/lib/features/news";
import type { ProjectionRow } from "@/lib/types";

export interface ToolContext {
  userId: string;
}

interface AgentTool {
  definition: Anthropic.Tool;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

// A tool failure the model can recover from (wrong league name, unknown
// player). Returned to Claude as an is_error tool_result, not thrown to the user.
export class ToolInputError extends Error {}

const r1 = (n: number) => Math.round(n * 10) / 10;

async function currentWeek(): Promise<number> {
  const state = await getNflState();
  return state.week > 0 ? state.week : 1;
}

// ---------------------------------------------------------------------------
// League resolution: the model refers to leagues by name ("Escalated"); map
// that to the user's own team in that league. Only the user's leagues match.

// The tools read rosters from our DB copy, which only the web pages and the
// daily cron used to refresh — from the terminal the agent kept advising on
// days-old rosters (a dropped player still "on the team", claimed players
// still "available"). Re-pull any league older than this before answering.
const ROSTER_STALE_MS = 5 * 60 * 1000;
const rosterSync = new Map<string, Promise<void>>();

// One sync at a time per user: parallel tool calls share the in-flight promise
// (a roster sync deletes + re-creates spots, so two at once would collide).
function ensureRostersFresh(userId: string): Promise<void> {
  let p = rosterSync.get(userId);
  if (!p) {
    p = (async () => {
      const leagues = await prisma.league.findMany({
        where: { platform: "sleeper", connection: { userId } },
        select: { id: true, name: true },
      });
      for (const l of leagues) {
        // Sleeper unreachable → answer from the copy we have rather than fail.
        await refreshSleeperLeagueIfStale(l.id, ROSTER_STALE_MS).catch((e) =>
          console.warn(`Roster refresh failed for ${l.name}: ${(e as Error).message}`),
        );
      }
    })().finally(() => rosterSync.delete(userId));
    rosterSync.set(userId, p);
  }
  return p;
}

async function myTeams(userId: string) {
  await ensureRostersFresh(userId);
  return prisma.team.findMany({
    where: { isMine: true, league: { connection: { userId } } },
    include: { league: true },
  });
}

async function resolveTeam(userId: string, league: unknown) {
  const teams = await myTeams(userId);
  const q = String(league ?? "").trim().toLowerCase();
  const names = teams.map((t) => t.league.name).join(", ");
  if (!q) throw new ToolInputError(`A league is required. Your leagues: ${names}`);
  const exact = teams.filter((t) => t.league.id === league || t.league.name.toLowerCase() === q);
  const matches = exact.length ? exact : teams.filter((t) => t.league.name.toLowerCase().includes(q));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new ToolInputError(`No league matches "${league}". Your leagues: ${names}`);
  throw new ToolInputError(
    `"${league}" matches several leagues: ${matches.map((t) => t.league.name).join(", ")}. Use a full name.`,
  );
}

// Players by (partial) name, best match first.
async function findPlayers(name: string, limit = 5) {
  const q = normalizeName(name);
  if (!q) return [];
  const words = q.split(" ");
  const last = words[words.length - 1];
  const candidates = await prisma.player.findMany({
    where: { name: { contains: last } }, // SQLite LIKE: case-insensitive for ASCII
    take: 200,
  });
  const score = (n: string) => {
    const nn = normalizeName(n);
    if (nn === q) return 3;
    if (words.every((w) => nn.includes(w))) return 2;
    return nn.includes(last) ? 1 : 0;
  };
  // Same name quality → prefer active fantasy players (on a team, skill position)
  // over retired / free-agent / defensive namesakes ("Watson" → Christian, not Blake).
  const FANTASY = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
  const relevance = (p: (typeof candidates)[number]) =>
    (p.nflTeam ? 0.5 : 0) + (FANTASY.has(p.position) ? 0.3 : 0);
  return candidates
    .map((p) => ({ p, s: score(p.name) + (score(p.name) > 0 ? relevance(p) : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.p);
}

// FantasyCalc rest-of-season values in this league's exact format.
async function leagueValues(
  league: { ppr: number; numQbs: number; numTeams: number },
  sleeperIds: string[],
): Promise<Map<string, number>> {
  const rows = await prisma.tradeValue.findMany({
    where: { sleeperId: { in: sleeperIds }, isDynasty: false, ppr: league.ppr, numQbs: league.numQbs, numTeams: league.numTeams },
    select: { sleeperId: true, value: true },
  });
  return new Map(rows.map((v) => [v.sleeperId, v.value]));
}

// A missing value is NOT a low value: FantasyCalc drops players on IR from its
// list. Say so in-band, or the model reads null as "worthless" (it once
// recommended dropping an IR star for exactly that reason).
const UNKNOWN_VALUE = "unknown (no market data — typical for IR players; not the same as low value)";

const lineupEntry = (p: LineupPlayer) => ({
  name: p.name,
  pos: p.position,
  proj: r1(p.proj),
  ...(p.injuryStatus ? { injury: p.injuryStatus } : {}),
  ...(p.matchup?.opponent ? { opp: p.matchup.opponent, matchup: p.matchup.label } : {}),
});

const waiverEntry = (t: WaiverTarget) => ({
  name: t.name,
  pos: t.position,
  team: t.nflTeam,
  proj: r1(t.proj),
  marketValue: t.value,
  ...(t.injuryStatus ? { injury: t.injuryStatus } : {}),
  ...(t.faab
    ? {
        faab: {
          suggestedBid: t.faab.bid,
          range: [t.faab.low, t.faab.high],
          need: t.faab.need,
          hot: t.faab.hot,
          contestedShare: t.faab.contestedShare,
        },
      }
    : {}),
});

const tradeIdeas = (h: HorizonIdeas) => ({
  weeks: h.weeks,
  ideas: h.ideas.map((i) => ({
    partner: i.partnerName,
    give: i.give.map((p) => `${p.name} (${p.position})`),
    get: i.get.map((p) => `${p.name} (${p.position})`),
    yourGainPtsTotal: r1(i.myGain),
    theirGainPtsTotal: r1(i.theirGain),
    otherWindowYourGainPtsTotal: r1(i.other.myGain),
    giveValue: i.giveValue,
    getValue: i.getValue,
  })),
});

const LEAGUE_PARAM = {
  type: "string",
  description: 'League name (or a unique part of it, e.g. "Escalated"). Call list_my_leagues if unsure.',
} as const;

// ---------------------------------------------------------------------------

export const TOOLS: AgentTool[] = [
  {
    definition: {
      name: "list_my_leagues",
      description:
        "List every fantasy league the manager is in: name, scoring format, team count, their team name, record, and FAAB budget remaining. Also returns the current NFL week. Call this first when a question spans leagues or a league name is ambiguous.",
      input_schema: { type: "object", properties: {} },
    },
    run: async (_input, ctx) => {
      const [teams, week] = await Promise.all([myTeams(ctx.userId), currentWeek()]);
      return {
        currentWeek: week,
        leagues: teams.map((t) => ({
          league: t.league.name,
          format: `${t.league.numTeams}-team ${t.league.ppr === 1 ? "PPR" : t.league.ppr === 0.5 ? "half-PPR" : "standard"}${t.league.numQbs === 2 ? " superflex" : ""}`,
          myTeam: t.name,
          record: t.wins != null ? `${t.wins}-${t.losses ?? 0}` : null,
          faabRemaining: t.league.faabBudget ? t.league.faabBudget - (t.faabBudgetUsed ?? 0) : null,
        })),
      };
    },
  },
  {
    definition: {
      name: "get_lineup_advice",
      description:
        "This week's start/sit analysis for one league: the optimal lineup by consensus projection (4 sources blended, injury-adjusted), projected points of the optimal vs. currently set lineup, which players to start/sit, moveIntoLineup / moveToBench (the swaps to make now), close calls, and injury alerts. Bench players include rest-of-season marketValue (use it to pick drops). Projections already account for matchups.",
      input_schema: { type: "object", properties: { league: LEAGUE_PARAM }, required: ["league"] },
    },
    run: async (input, ctx) => {
      const team = await resolveTeam(ctx.userId, input.league);
      const ss = await startSitForTeam(team.id);
      const starters = new Set(ss.lineup.map((a) => a.player?.sleeperId).filter(Boolean));
      const bench = ss.players.filter((p) => !starters.has(p.sleeperId));
      // Rest-of-season market value on the bench, so drops can be chosen by worth.
      const values = await leagueValues(team.league, bench.map((p) => p.sleeperId));
      return {
        league: team.league.name,
        week: ss.week,
        optimalProjected: r1(ss.optimalTotal),
        currentProjected: r1(ss.currentTotal),
        pointsLeftOnBench: r1(ss.delta),
        optimalLineup: ss.lineup.map((a) => ({ slot: a.slot, ...(a.player ? lineupEntry(a.player) : { name: null }) })),
        bench: bench.map((p) => ({ ...lineupEntry(p), marketValue: values.get(p.sleeperId) ?? UNKNOWN_VALUE })),
        // Named for the action: "shouldStart/shouldSit" got misread as "already started/benched".
        moveIntoLineup: ss.start.map((p) => p.name), // currently benched, should start
        moveToBench: ss.sit.map((p) => p.name), // currently starting, should sit
        closeCalls: ss.closeCalls.map((c) => ({
          starter: c.starter.name,
          alternative: c.alternative.name,
          gapPts: r1(c.gap),
        })),
        injuryAlerts: ss.injuryAlerts,
      };
    },
  },
  {
    definition: {
      name: "get_matchup",
      description:
        "This week's matchup for one league. Head-to-head leagues: opponent, both projected totals, live points, win probability. Guillotine leagues (lowest score each week is eliminated): rank, elimination line, cushion and survival probability.",
      input_schema: { type: "object", properties: { league: LEAGUE_PARAM }, required: ["league"] },
    },
    run: async (input, ctx) => {
      const team = await resolveTeam(ctx.userId, input.league);
      const survival = await getSurvival(team.id).catch(() => null);
      if (survival) {
        return {
          league: team.league.name,
          type: "guillotine",
          week: survival.week,
          myProjected: r1(survival.myProjected),
          myRank: `${survival.myRank} of ${survival.numActive} (1 = safest)`,
          eliminationLine: r1(survival.eliminationLine),
          cushion: r1(survival.cushion),
          onTheBlock: survival.onTheBlock,
          survivalProb: survival.survivalProb != null ? Math.round(survival.survivalProb * 100) / 100 : null,
        };
      }
      const m = await getMatchup(team.id);
      return {
        league: team.league.name,
        type: "head_to_head",
        week: m.week,
        me: { ...m.me, projected: r1(m.me.projected) },
        opponent: m.opponent ? { ...m.opponent, projected: r1(m.opponent.projected) } : "bye / no matchup",
        winProb: m.winProb != null ? Math.round(m.winProb * 100) / 100 : null,
      };
    },
  },
  {
    definition: {
      name: "get_waiver_targets",
      description:
        "Best unrostered players in one league, ranked by this week's projection, each with market value and (FAAB leagues) a suggested bid calibrated on this league's real past winning bids: range [low, high] where low ≈ median winning bid and high wins ~80% of the time; need = starts|marginal|depth for this roster; hot = trending add across Sleeper.",
      input_schema: {
        type: "object",
        properties: {
          league: LEAGUE_PARAM,
          position: { type: "string", enum: ["QB", "RB", "WR", "TE", "K", "DEF"], description: "Optional position filter" },
          limit: { type: "integer", description: "How many targets (default 8, max 25)" },
        },
        required: ["league"],
      },
    },
    run: async (input, ctx) => {
      const team = await resolveTeam(ctx.userId, input.league);
      const limit = Math.min(Math.max(Number(input.limit) || 8, 1), 25);
      const wv = await waiverTargets(team.id, {
        position: typeof input.position === "string" ? input.position : undefined,
        limit,
      });
      return {
        league: team.league.name,
        week: wv.week,
        faabRemaining: wv.remainingBudget,
        targets: wv.targets.map(waiverEntry),
      };
    },
  },
  {
    definition: {
      name: "lookup_player",
      description:
        "Look up an NFL player by name: position, team, injury status and this week's consensus projection. If a league is given, also says who rosters him there (or that he's available), his market value in that league's format, and — when he's available in a FAAB league — the suggested bid.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: 'Player name, full or partial ("Watson", "Christian Watson")' },
          league: { ...LEAGUE_PARAM, description: "Optional league for availability, value and FAAB bid" },
        },
        required: ["name"],
      },
    },
    run: async (input, ctx) => {
      let found = await findPlayers(String(input.name ?? ""), 10);
      if (found.length === 0) throw new ToolInputError(`No player found matching "${input.name}".`);
      const team = input.league ? await resolveTeam(ctx.userId, input.league) : null;
      const season = team?.league.season ?? new Date().getFullYear();
      const week = await currentWeek();
      const ids = found.map((p) => p.sleeperId);
      const consensus = blendProjections(
        (await prisma.projection.findMany({ where: { sleeperId: { in: ids }, season, week } })) as unknown as ProjectionRow[],
      );
      // Players projected this week are the ones worth asking about; list them first (stable within groups).
      found = [...found.filter((p) => consensus.has(p.sleeperId)), ...found.filter((p) => !consensus.has(p.sleeperId))].slice(0, 5);

      let owners = new Map<string, string>();
      let values = new Map<string, number>();
      const waiverById = new Map<string, WaiverTarget>();
      if (team) {
        const league = await prisma.league.findUniqueOrThrow({
          where: { id: team.leagueId },
          include: { teams: { include: { roster: { where: { sleeperId: { in: ids } } } } } },
        });
        owners = new Map(
          league.teams.flatMap((t) => t.roster.map((r) => [r.sleeperId as string, t.isMine ? "you" : t.name] as const)),
        );
        values = await leagueValues(league, ids);
        // FAAB advice for an available player comes from the waiver ranking itself.
        const available = found.filter((p) => !owners.has(p.sleeperId));
        if (available.length && league.faabBudget) {
          for (const pos of new Set(available.map((p) => p.position))) {
            const wv = await waiverTargets(team.id, { position: pos, limit: 500 });
            for (const t of wv.targets) waiverById.set(t.sleeperId, t);
          }
        }
      }

      return {
        week,
        matches: found.map((p) => {
          const c = consensus.get(p.sleeperId);
          const wt = waiverById.get(p.sleeperId);
          return {
            name: p.name,
            pos: p.position,
            team: p.nflTeam,
            injury: p.injuryStatus,
            projThisWeek: c ? r1(injuryAdjustedProj(c.points, p.injuryStatus)) : null,
            projSources: c?.n ?? 0,
            ...(team
              ? {
                  inLeague: team.league.name,
                  rosteredBy: owners.get(p.sleeperId) ?? "available (free agent)",
                  marketValue: values.get(p.sleeperId) ?? UNKNOWN_VALUE,
                  ...(wt?.faab
                    ? { faab: { suggestedBid: wt.faab.bid, range: [wt.faab.low, wt.faab.high], need: wt.faab.need, hot: wt.faab.hot } }
                    : {}),
                }
              : {}),
          };
        }),
      };
    },
  },
  {
    definition: {
      name: "get_trade_ideas",
      description:
        "Pre-screened trade offers for one league: every idea is fair by market value (they get ≥90%, you pay ≤125%) and improves BOTH teams' optimal lineups. Two windows: nearTerm (next ~3 weeks) and restOfSeason (through the league's final week). Gains are point TOTALS over the window; otherWindowYourGainPtsTotal is the same swap on the other window (negative = helps now, costs later, or vice versa). Empty lists mean no fair win-win exists.",
      input_schema: { type: "object", properties: { league: LEAGUE_PARAM }, required: ["league"] },
    },
    run: async (input, ctx) => {
      const team = await resolveTeam(ctx.userId, input.league);
      const t = await tradeIdeasForTeam(team.id, 4);
      return { league: team.league.name, nearTerm: tradeIdeas(t.near), restOfSeason: tradeIdeas(t.ros) };
    },
  },
  {
    definition: {
      name: "evaluate_trade",
      description:
        "Score a specific proposed trade in one league by rest-of-season market value (league-format FantasyCalc values): totals for each side, the difference, and a verdict. Give player names; they must be on rosters in that league.",
      input_schema: {
        type: "object",
        properties: {
          league: LEAGUE_PARAM,
          give: { type: "array", items: { type: "string" }, description: "Names of players the manager gives" },
          get: { type: "array", items: { type: "string" }, description: "Names of players the manager gets" },
        },
        required: ["league", "give", "get"],
      },
    },
    run: async (input, ctx) => {
      const team = await resolveTeam(ctx.userId, input.league);
      const rostered = await prisma.rosterSpot.findMany({
        where: { team: { leagueId: team.leagueId }, sleeperId: { not: null } },
        select: { sleeperId: true, name: true },
      });
      const resolve = (names: unknown) =>
        (Array.isArray(names) ? names : []).map((n) => {
          const q = normalizeName(String(n));
          const hit =
            rostered.find((r) => normalizeName(r.name) === q) ??
            rostered.find((r) => normalizeName(r.name).includes(q));
          if (!hit) throw new ToolInputError(`"${n}" isn't on any roster in ${team.league.name}.`);
          return hit.sleeperId as string;
        });
      const ev = await evaluateTrade(team.leagueId, resolve(input.give), resolve(input.get));
      return {
        league: team.league.name,
        give: ev.give.map((p) => ({ name: p.name, value: p.value })),
        get: ev.get.map((p) => ({ name: p.name, value: p.value })),
        giveTotal: ev.giveTotal,
        getTotal: ev.getTotal,
        diffPct: ev.pct,
        verdict: ev.verdict,
        note: ev.note,
        warning: ev.warning,
      };
    },
  },
  {
    definition: {
      name: "get_roster_outlook",
      description:
        "Roster construction for one league: upcoming bye weeks (who's out, and any week that leaves a starting slot unfillable) and thin positions with no bench player behind the starters.",
      input_schema: { type: "object", properties: { league: LEAGUE_PARAM }, required: ["league"] },
    },
    run: async (input, ctx) => {
      const team = await resolveTeam(ctx.userId, input.league);
      const o = await rosterOutlook(team.id);
      return {
        league: team.league.name,
        currentWeek: o.currentWeek,
        byes: o.byes.map((b) => ({ week: b.week, onBye: b.playersOnBye.map((p) => p.name), unfilledSlots: b.unfilledSlots })),
        nextByeCrunchWeek: o.nextByeCrunch?.week ?? null,
        thinPositions: o.thinPositions,
      };
    },
  },
  {
    definition: {
      name: "get_player_news",
      description:
        "Recent fantasy-analyst YouTube coverage mentioning the given players (titles + short summaries). Color only — use it to add context, never as the sole reason for a move.",
      input_schema: {
        type: "object",
        properties: { players: { type: "array", items: { type: "string" }, description: "Player names" } },
        required: ["players"],
      },
    },
    run: async (input) => {
      const names = Array.isArray(input.players) ? input.players.map(String) : [];
      const ids = (await Promise.all(names.map((n) => findPlayers(n, 1)))).flat().map((p) => p.sleeperId);
      const items = await newsForPlayers(ids, 6);
      return {
        items: items.map((i) => ({
          title: i.title,
          summary: i.summary,
          players: i.players,
          published: i.publishedAt.toISOString().slice(0, 10),
        })),
      };
    },
  },
];

export const TOOL_DEFINITIONS: Anthropic.Tool[] = TOOLS.map((t) => t.definition);
const byName = new Map(TOOLS.map((t) => [t.definition.name, t]));

// Run one tool call. Recoverable problems come back as { isError } so the
// model can correct itself (e.g. retry with the right league name).
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ content: string; summary: string; isError: boolean }> {
  const tool = byName.get(name);
  if (!tool) return { content: `Unknown tool "${name}".`, summary: `unknown tool "${name}"`, isError: true };
  try {
    const result = await tool.run(input, ctx);
    let summary: string;
    try {
      summary = SUMMARIZE[name]?.(result as Json) ?? "done";
    } catch {
      summary = "done";
    }
    return { content: JSON.stringify(result), summary, isError: false };
  } catch (e) {
    const msg = e instanceof ToolInputError ? e.message : `Tool failed: ${(e as Error).message}`;
    return { content: msg, summary: msg, isError: true };
  }
}

// ---------------------------------------------------------------------------
// One human-readable line per tool result — what the loop prints so the room
// (and I) can follow what came back, not just that something did. Display
// only: the model always gets the full JSON above.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const money = (n: unknown) => (typeof n === "number" ? `$${n}` : "-");

const SUMMARIZE: Record<string, (r: Json) => string> = {
  list_my_leagues: (r) =>
    `${r.leagues.length} leagues (${r.leagues.map((l: Json) => l.league).join(", ")}) · week ${r.currentWeek}`,
  get_lineup_advice: (r) => {
    const swaps = r.moveIntoLineup.length
      ? `start ${r.moveIntoLineup.join(", ")} over ${r.moveToBench.join(", ")}`
      : "lineup already optimal";
    const inj = r.injuryAlerts.filter((i: Json) => i.starting).length;
    return (
      `${r.league}: optimal ${r.optimalProjected} vs set ${r.currentProjected} ` +
      `(${r.pointsLeftOnBench} left on bench) · ${swaps}` +
      (inj ? ` · ${inj} injured starter${inj > 1 ? "s" : ""}` : "")
    );
  },
  get_matchup: (r) =>
    r.type === "guillotine"
      ? `${r.league}: Guillotine rank ${r.myRank}, cushion ${r.cushion >= 0 ? "+" : ""}${r.cushion} over the ` +
        `elimination line, ${r.survivalProb != null ? Math.round(r.survivalProb * 100) + "% to survive" : "survival n/a"}`
      : typeof r.opponent === "string"
        ? `${r.league}: ${r.opponent}`
        : `${r.league}: vs ${r.opponent.teamName.trim()}, ${r.me.projected}–${r.opponent.projected} projected` +
          (r.winProb != null ? `, ${Math.round(r.winProb * 100)}% to win` : ""),
  get_waiver_targets: (r) => {
    const t = r.targets[0];
    if (!t) return `${r.league}: no waiver targets`;
    return (
      `${r.league}: ${r.targets.length} targets · top ${t.name} (${t.pos}) ${t.proj} proj` +
      (t.faab ? `, bid ${money(t.faab.suggestedBid)} (range ${money(t.faab.range[0])}–${money(t.faab.range[1])})` : "")
    );
  },
  lookup_player: (r) => {
    const p = r.matches[0];
    const who = [p.name, p.pos, p.team, p.injury].filter(Boolean).join(" ");
    return (
      `${who} · ${p.projThisWeek ?? "no"} proj` +
      (p.rosteredBy ? ` · ${p.rosteredBy === "you" ? "on your team" : p.rosteredBy}` : "") +
      (p.faab ? ` · bid ${money(p.faab.suggestedBid)}` : "") +
      (r.matches.length > 1 ? ` (+${r.matches.length - 1} other matches)` : "")
    );
  },
  get_trade_ideas: (r) => {
    const top = r.nearTerm.ideas[0] ?? r.restOfSeason.ideas[0];
    return (
      `${r.league}: ${r.nearTerm.ideas.length} near-term / ${r.restOfSeason.ideas.length} rest-of-season ideas` +
      (top ? ` · e.g. give ${top.give.join(" + ")} for ${top.get.join(" + ")} (+${top.yourGainPtsTotal} pts)` : "")
    );
  },
  evaluate_trade: (r) => `${r.league}: ${r.verdict} (give ${r.giveTotal} vs get ${r.getTotal}, ${r.diffPct}%)`,
  get_roster_outlook: (r) =>
    `${r.league}: next bye crunch ${r.nextByeCrunchWeek != null ? "week " + r.nextByeCrunchWeek : "none"} · ` +
    `thin at ${r.thinPositions.map((t: Json) => t.position).join("/") || "nothing"}`,
  get_player_news: (r) =>
    r.items.length ? `${r.items.length} news items · latest: "${r.items[0].title}"` : "no recent news",
};
