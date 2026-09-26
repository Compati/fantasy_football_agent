// Backtest the decision features against real results.
//   npx tsx scripts/backtest.ts projections   # this season's completed weeks
//   npx tsx scripts/backtest.ts matchup       # DvP tiebreaker over a past season
//   npx tsx scripts/backtest.ts faab          # FAAB ranges replayed week by week
// (no arg = all three)

import { prisma } from "@/lib/db";
import { getNflState, getProjections, getWeeklyStats } from "@/lib/sleeper";
import { fetchAllSources } from "@/lib/ingest/projections";
import { blendProjections } from "@/lib/projections/consensus";
import { computeDefenseVsPosition, closeCallLean, type WeeklyPoints } from "@/lib/features/opponent";
import { claimSamples, faabRange, faabTier, inSeasonalWindow } from "@/lib/features/faab";
import { mae, pairwiseAccuracy, wouldWin } from "@/lib/backtest";
import type { ProjectionRow } from "@/lib/types";

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const POSITIONS = ["QB", "RB", "WR", "TE"];

// The backtest makes ~70 stats calls per season; retry the odd slow one.
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

async function actualsFor(season: number, week: number, positions = [...POSITIONS, "K", "DEF"]) {
  const out = new Map<string, { position: string; actual: number; opponent: string | null }>();
  for (const position of positions) {
    for (const r of await withRetry(() => getWeeklyStats(season, week, position))) {
      const pts = r.stats?.pts_ppr;
      if (pts == null || (r.stats?.gp ?? 1) <= 0) continue; // didn't play
      out.set(r.player_id, { position, actual: pts, opponent: r.opponent });
    }
  }
  return out;
}

// ---- 1. Projection sources vs results --------------------------------------
async function projections() {
  const state = await getNflState();
  const season = Number(state.season);
  const lastDone = state.week - 1;
  console.log(`\n=== Projections: ${season} weeks 1-${lastDone} (players with all 4 sources who played)`);

  type Row = { position: string; actual: number; bySource: Map<string, number> };
  const rows: Row[] = [];
  const defRows: Row[] = [];
  for (let week = 1; week <= lastDone; week++) {
    // Prefer our own stored snapshot (taken before kickoff) when it has every
    // source: a site's past-week page may have been updated after games began.
    const stored = await prisma.projection.findMany({ where: { season, week } });
    const storedSources = new Set(stored.map((r) => r.source));
    let all: ProjectionRow[];
    if (["sleeper", "espn", "cbs", "fftoday"].every((x) => storedSources.has(x))) {
      all = stored as unknown as ProjectionRow[];
      console.log(`  week ${week}: using stored pre-game snapshot`);
    } else {
      const f = await fetchAllSources(season, week);
      all = [...f.sleeper, ...f.espn, ...f.cbs.rows, ...f.fftoday.rows];
      console.log(`  week ${week}: re-fetched from the sites (may include post-kickoff updates)`);
    }
    const actuals = await actualsFor(season, week);
    const bySource = new Map<string, Map<string, number>>();
    for (const r of all) {
      if (!bySource.has(r.sleeperId)) bySource.set(r.sleeperId, new Map());
      bySource.get(r.sleeperId)!.set(r.source, r.points);
    }
    for (const [id, m] of bySource) {
      const a = actuals.get(id);
      if (!a) continue;
      if (a.position === "DEF" && m.has("sleeper") && m.has("espn")) defRows.push({ position: "DEF", actual: a.actual, bySource: m });
      if (m.size === 4 && (m.get("sleeper") ?? 0) >= 3) rows.push({ position: a.position, actual: a.actual, bySource: m });
    }
    console.log(`    ${[...bySource.values()].filter((m) => m.size === 4).length} players with 4 sources`);
  }

  const blend = (m: Map<string, number>, sources: string[]) =>
    blendProjections(
      sources.filter((s) => m.has(s)).map((s) => ({ sleeperId: "x", source: s as ProjectionRow["source"], season, week: 0, points: m.get(s)! })),
    ).get("x")?.points ?? 0;
  const methods: [string, (m: Map<string, number>) => number][] = [
    ["sleeper", (m) => m.get("sleeper")!],
    ["espn", (m) => m.get("espn")!],
    ["cbs", (m) => m.get("cbs")!],
    ["fftoday", (m) => m.get("fftoday")!],
    ["old: sleeper+espn avg", (m) => blend(m, ["sleeper", "espn"])],
    ["new: 4-source trimmed", (m) => blend(m, ["sleeper", "espn", "cbs", "fftoday"])],
  ];
  console.log(`  n=${rows.length} player-weeks`);
  console.log(`  ${"method".padEnd(24)} ${"MAE".padStart(6)}  ${"order all pairs".padStart(16)}  ${"close pairs (<2 pts)".padStart(22)}`);
  for (const [name, fn] of methods) {
    const pts = rows.map((r) => ({ position: r.position, proj: fn(r.bySource), actual: r.actual }));
    const all = pairwiseAccuracy(pts);
    const close = pairwiseAccuracy(pts, 2);
    console.log(
      `  ${name.padEnd(24)} ${mae(pts).toFixed(2).padStart(6)}  ${pct(all.rate).padStart(16)}  ${`${pct(close.rate)} of ${close.total}`.padStart(22)}`,
    );
  }
  if (defRows.length) {
    console.log(`  DEF (n=${defRows.length}):`);
    for (const [name, fn] of [
      ["sleeper", (m: Map<string, number>) => m.get("sleeper")!],
      ["espn (rescaled)", (m: Map<string, number>) => m.get("espn")!],
      ["2-source avg", (m: Map<string, number>) => blend(m, ["sleeper", "espn"])],
    ] as const) {
      const pts = defRows.map((r) => ({ position: "DEF", proj: fn(r.bySource), actual: r.actual }));
      console.log(`    ${name.padEnd(22)} MAE ${mae(pts).toFixed(2)}  order ${pct(pairwiseAccuracy(pts).rate)}`);
    }
  }
}

// ---- 2. Matchup (defense-vs-position) tiebreaker ----------------------------
async function matchup(season = 2025) {
  console.log(`\n=== Matchup tiebreaker (defense-vs-position half), ${season} weeks 3-17`);
  console.log("  close calls = same position, both projected >= 8, Sleeper projection gap < 1.5");
  const history: WeeklyPoints[] = [];
  let leanRight = 0;
  let leanTotal = 0;
  let favRight = 0;
  let favTotal = 0;
  const FLIP_THRESHOLDS = [0.06, 0.12, 0.2, 0.3];
  const flips = Object.fromEntries(FLIP_THRESHOLDS.map((t) => [t, { n: 0, right: 0 }])) as Record<number, { n: number; right: number }>;
  for (let week = 1; week <= 17; week++) {
    const actuals = await actualsFor(season, week, POSITIONS);
    if (week >= 3) {
      const dvp = computeDefenseVsPosition(history);
      const dvpBy = new Map(dvp.map((d) => [`${d.team}|${d.position}`, d.adjusted]));
      const avg = new Map(
        POSITIONS.map((p) => {
          const g = dvp.filter((d) => d.position === p);
          return [p, g.reduce((s, d) => s + d.adjusted, 0) / g.length];
        }),
      );
      const proj = new Map((await withRetry(() => getProjections(season, week, 1))).map((r) => [r.sleeperId, r.points]));
      const players = [...actuals]
        .map(([id, a]) => ({ id, ...a, proj: proj.get(id) ?? 0 }))
        .filter((p) => p.proj >= 8 && p.opponent);
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const a = players[i];
          const b = players[j];
          if (a.position !== b.position || Math.abs(a.proj - b.proj) >= 1.5 || a.actual === b.actual) continue;
          const [fav, dog] = a.proj >= b.proj ? [a, b] : [b, a];
          favTotal++;
          if (fav.actual > dog.actual) favRight++;
          const edge = (p: typeof a) => (dvpBy.get(`${p.opponent}|${p.position}`) ?? avg.get(p.position)!) / avg.get(p.position)! - 1;
          const lean = closeCallLean(edge(fav), edge(dog));
          // Split by how strongly the matchup disagrees with the projection.
          const diff = edge(dog) - edge(fav);
          for (const t of FLIP_THRESHOLDS) {
            if (diff >= t) {
              flips[t].n++;
              if (dog.actual > fav.actual) flips[t].right++;
            }
          }
          if (!lean) continue;
          leanTotal++;
          const pick = lean === "starter" ? fav : dog;
          const other = pick === fav ? dog : fav;
          if (pick.actual > other.actual) leanRight++;
        }
      }
    }
    for (const [, a] of actuals) if (a.opponent) history.push({ week, opponent: a.opponent, position: a.position, points: a.actual });
  }
  console.log(`  projection favorite won ${pct(favRight / favTotal)} of ${favTotal} close calls`);
  console.log(`  matchup lean (when it had one) won ${pct(leanRight / leanTotal)} of ${leanTotal}`);
  console.log("  when the matchup favors the projection underdog by at least X, the underdog won:");
  for (const t of FLIP_THRESHOLDS) {
    console.log(`    X=${Math.round(t * 100)}%: ${pct(flips[t].right / flips[t].n)} of ${flips[t].n}`);
  }
}

// ---- 3. FAAB ranges replayed week by week ------------------------------------
async function faab(season = 2025) {
  console.log(`\n=== FAAB ranges replayed on ${season}, using only data available before each week`);
  const leagues = await prisma.league.findMany({ include: { waiverClaims: true } });
  const withHistory = leagues.filter((l) => l.waiverClaims.some((c) => c.season === season));
  const tierOf = (c: { position: string; projAtClaim: number | null; projAhead: number | null }, numQbs: number) =>
    faabTier(c.position, Math.max(c.projAtClaim ?? 0, c.projAhead ?? 0), 0, numQbs);

  for (const lg of withHistory) {
    let n = 0;
    const wins = { low: 0, mid: 0, high: 0 };
    let highOverpay = 0;
    for (let week = 1; week <= 17; week++) {
      // Calibration set exactly as production would have had it that week.
      const samples = leagues.flatMap((l) =>
        claimSamples(
          l.id,
          l.waiverClaims.filter(
            (c) => (c.season === season ? c.week < week : c.season < season && inSeasonalWindow(c, season, week)),
          ),
          (c) => tierOf(c, l.numQbs),
        ),
      );
      const groups = new Map<string, typeof lg.waiverClaims>();
      for (const c of lg.waiverClaims.filter((c) => c.season === season && c.week === week)) {
        groups.set(c.sleeperId, [...(groups.get(c.sleeperId) ?? []), c]);
      }
      for (const group of groups.values()) {
        const winner = group.find((c) => c.won);
        if (!winner) continue;
        const tier = tierOf(winner, lg.numQbs);
        const r = faabRange(tier, lg.id, samples, winner.budget, null);
        const bids = group.map((c) => c.bid);
        const mid = Math.round((r.low + r.high) / 2);
        n++;
        if (wouldWin(r.low, bids)) wins.low++;
        if (wouldWin(mid, bids)) wins.mid++;
        if (wouldWin(r.high, bids)) {
          wins.high++;
          highOverpay += r.high - Math.max(...bids);
        }
      }
    }
    console.log(`  ${lg.name} (${n} won claims):`);
    console.log(`    low end wins ${pct(wins.low / n)}   midpoint ${pct(wins.mid / n)}   high end ${pct(wins.high / n)}`);
    console.log(`    when the high end wins, it beats the top bid by $${(highOverpay / Math.max(1, wins.high)).toFixed(1)} on average`);
  }
}

async function main() {
  const which = process.argv[2];
  if (!which || which === "projections") await projections();
  if (!which || which === "matchup") await matchup();
  if (!which || which === "faab") await faab();
}
main().finally(() => prisma.$disconnect());
