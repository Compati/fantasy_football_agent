// Canonical player table: sync from the Sleeper catalog and resolve players
// coming from other platforms (Yahoo) back to a sleeperId.

import { prisma } from "@/lib/db";
import { getPlayersCatalog, toCanonicalPlayers } from "@/lib/sleeper";

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[.'`-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Upsert the Sleeper catalog into the Player table. ~12k rows; run daily (cron)
// or on first connect. New players are inserted; existing rows are refreshed in
// chunks so team/position changes propagate.
export async function syncPlayerCatalog(): Promise<{ total: number; created: number }> {
  const catalog = await getPlayersCatalog();
  const players = toCanonicalPlayers(catalog);

  const existing = new Set(
    (await prisma.player.findMany({ select: { sleeperId: true } })).map((p) => p.sleeperId),
  );
  const toCreate = players.filter((p) => !existing.has(p.sleeperId));

  // Insert the new ones in bulk.
  const CHUNK = 1000;
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    await prisma.player.createMany({
      data: toCreate.slice(i, i + CHUNK).map((p) => ({
        sleeperId: p.sleeperId,
        espnId: p.espnId,
        yahooId: p.yahooId,
        name: p.name,
        position: p.position,
        nflTeam: p.team,
      })),
    });
  }

  // Refresh volatile fields (team) for players already present.
  for (const p of players) {
    if (!existing.has(p.sleeperId)) continue;
    await prisma.player.update({
      where: { sleeperId: p.sleeperId },
      data: { nflTeam: p.team, position: p.position, name: p.name },
    }).catch(() => {});
  }

  return { total: players.length, created: toCreate.length };
}

// Ensure the catalog is present and reasonably fresh before an ingest that
// depends on it. Syncs if empty or older than `maxAgeHours`.
export async function ensureCatalogFresh(maxAgeHours = 24): Promise<void> {
  const count = await prisma.player.count();
  if (count === 0) {
    await syncPlayerCatalog();
    return;
  }
  const newest = await prisma.player.findFirst({
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  if (!newest) return;
  const ageHours = (Date.now() - newest.updatedAt.getTime()) / 3_600_000;
  if (ageHours > maxAgeHours) await syncPlayerCatalog();
}

// Lightweight lookup of display details by sleeperId (name/pos/team).
export type PlayerDetail = { name: string; position: string; nflTeam: string | null };

export async function playerDetailMap(sleeperIds: string[]): Promise<Map<string, PlayerDetail>> {
  const rows = await prisma.player.findMany({
    where: { sleeperId: { in: sleeperIds } },
    select: { sleeperId: true, name: true, position: true, nflTeam: true },
  });
  return new Map(rows.map((r) => [r.sleeperId, { name: r.name, position: r.position, nflTeam: r.nflTeam }]));
}

// Resolver for players arriving from Yahoo (which gives a yahoo_id and a name).
export interface Resolver {
  byYahooId: (yahooId: string) => string | null;
  byNamePos: (name: string, position: string) => string | null;
}

export async function buildResolver(): Promise<Resolver> {
  const rows = await prisma.player.findMany({
    select: { sleeperId: true, yahooId: true, name: true, position: true },
  });
  const yahoo = new Map<string, string>();
  const namePos = new Map<string, string>();
  for (const r of rows) {
    if (r.yahooId) yahoo.set(r.yahooId, r.sleeperId);
    namePos.set(`${normalizeName(r.name)}|${r.position}`, r.sleeperId);
  }
  return {
    byYahooId: (id) => yahoo.get(id) ?? null,
    byNamePos: (name, position) => namePos.get(`${normalizeName(name)}|${position}`) ?? null,
  };
}
