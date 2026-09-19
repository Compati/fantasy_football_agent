// Credential-free smoke test of the data layer. Hits the three public sources
// live and prints a report proving:
//   1. each source responds and parses,
//   2. the FantasyCalc `sleeperId` join resolves against the Sleeper catalog,
//   3. the ESPN espn_id join resolves too,
//   4. the consensus blend produces sensible numbers where sources overlap.
//
// Run: npm run probe
//
// Nothing here writes to the DB — it's purely a health check for the upstreams.

import { getNflState, getPlayersCatalog, toCanonicalPlayers, getProjections } from "@/lib/sleeper";
import { getTradeValues } from "@/lib/fantasycalc";
import { getEspnProjections } from "@/lib/projections/espn";
import { blendProjections } from "@/lib/projections/consensus";
import { DEFAULT_SCORING } from "@/lib/types";
import type { ProjectionRow } from "@/lib/types";

function hr(label: string) {
  console.log(`\n${"=".repeat(6)} ${label} ${"=".repeat(6)}`);
}

async function main() {
  const ctx = DEFAULT_SCORING; // 12-team, full PPR, 1 QB

  // --- Current week ---
  hr("Sleeper NFL state");
  const state = await getNflState().catch((e) => {
    console.log("state failed:", e.message);
    return null;
  });
  const season = state ? Number(state.season) : new Date().getFullYear();
  // In-season the "week" is the current one; guard against a 0 in the offseason.
  const week = state && state.week > 0 ? state.week : 1;
  console.log(`season=${season} week=${week} type=${state?.season_type}`);

  // --- Player catalog (the join hub) ---
  hr("Sleeper player catalog");
  const catalog = await getPlayersCatalog();
  const players = toCanonicalPlayers(catalog);
  const bySleeperId = new Set(players.map((p) => p.sleeperId));
  const espnToSleeper = new Map<string, string>();
  let withEspn = 0;
  for (const p of players) {
    if (p.espnId) {
      espnToSleeper.set(p.espnId, p.sleeperId);
      withEspn++;
    }
  }
  console.log(`catalog entries: ${Object.keys(catalog).length}`);
  console.log(`canonical players (named + positioned): ${players.length}`);
  console.log(`with espn_id: ${withEspn}  with yahoo_id: ${players.filter((p) => p.yahooId).length}`);

  // --- FantasyCalc trade values + sleeperId join ---
  hr("FantasyCalc trade values (redraft, 12-team PPR)");
  const values = await getTradeValues(ctx, false);
  const top = values.slice(0, 10);
  console.log(`rows: ${values.length}`);
  console.log("top 10 by value:");
  for (const v of top) {
    console.log(`  ${String(v.overallRank).padStart(3)}. ${v.name.padEnd(22)} ${v.position.padEnd(3)} value=${v.value} sleeperId=${v.sleeperId ?? "—"}`);
  }
  const withSid = values.filter((v) => v.sleeperId);
  const resolved = withSid.filter((v) => bySleeperId.has(v.sleeperId as string));
  console.log(
    `join: ${withSid.length}/${values.length} have a sleeperId; ${resolved.length}/${withSid.length} resolve in catalog`,
  );

  // --- Sleeper projections ---
  hr(`Sleeper projections (season ${season}, week ${week})`);
  let sleeperProj: ProjectionRow[] = [];
  try {
    sleeperProj = await getProjections(season, week, ctx.ppr);
    console.log(`rows: ${sleeperProj.length}`);
    const topProj = [...sleeperProj].sort((a, b) => b.points - a.points).slice(0, 5);
    for (const r of topProj) {
      const name = players.find((p) => p.sleeperId === r.sleeperId)?.name ?? r.sleeperId;
      console.log(`  ${name.padEnd(22)} ${r.points}`);
    }
  } catch (e) {
    console.log("sleeper projections failed:", (e as Error).message);
  }

  // --- ESPN projections ---
  hr(`ESPN projections (season ${season}, week ${week})`);
  let espnProj: ProjectionRow[] = [];
  try {
    const res = await getEspnProjections(season, week, ctx.ppr, espnToSleeper);
    espnProj = res.rows;
    console.log(
      `fetched=${res.fetched} withWeeklyProjection=${res.matchedProjection} resolvedRows=${res.rows.length} unresolvedEspnIds=${res.unresolvedEspnIds}`,
    );
    const topProj = [...espnProj].sort((a, b) => b.points - a.points).slice(0, 5);
    for (const r of topProj) {
      const name = players.find((p) => p.sleeperId === r.sleeperId)?.name ?? r.sleeperId;
      console.log(`  ${name.padEnd(22)} ${r.points}`);
    }
  } catch (e) {
    console.log("espn projections failed:", (e as Error).message);
  }

  // --- Consensus where sources overlap ---
  hr("Consensus blend (Sleeper + ESPN)");
  const consensus = blendProjections([...sleeperProj, ...espnProj]);
  const overlap = [...consensus.values()].filter((c) => c.n >= 2);
  console.log(`players with >=2 sources: ${overlap.length}`);
  const sample = overlap.sort((a, b) => b.points - a.points).slice(0, 8);
  for (const c of sample) {
    const name = players.find((p) => p.sleeperId === c.sleeperId)?.name ?? c.sleeperId;
    console.log(`  ${name.padEnd(22)} consensus=${c.points} (sources: ${c.sources.join("+")}, spread=${c.spread})`);
  }

  hr("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
