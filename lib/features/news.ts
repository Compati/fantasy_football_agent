// Surface ingested Reddit/YouTube items relevant to a specific set of players
// (a team's roster + its waiver targets). The NewsItem table is small and
// already pre-filtered to player mentions (see lib/ingest/news.ts), so this
// just intersects in JS rather than needing JSON-array queries SQLite doesn't
// support well.

import { prisma } from "@/lib/db";
import { playerDetailMap } from "@/lib/players";

export interface PlayerNewsItem {
  source: "reddit" | "youtube";
  url: string;
  title: string;
  summary: string | null;
  publishedAt: Date;
  players: string[]; // display names of the relevant players this item mentions
}

export async function newsForPlayers(sleeperIds: string[], limit = 8): Promise<PlayerNewsItem[]> {
  if (sleeperIds.length === 0) return [];
  const idSet = new Set(sleeperIds);

  const items = await prisma.newsItem.findMany({ orderBy: { publishedAt: "desc" } });
  const relevant = items.filter((item) => (item.playerIds as unknown as string[]).some((id) => idSet.has(id)));

  const mentionedIds = new Set(relevant.flatMap((r) => r.playerIds as unknown as string[]));
  const names = await playerDetailMap([...mentionedIds]);

  return relevant.slice(0, limit).map((r) => ({
    source: r.source as "reddit" | "youtube",
    url: r.url,
    title: r.title,
    summary: r.summary,
    publishedAt: r.publishedAt,
    players: (r.playerIds as unknown as string[])
      .filter((id) => idSet.has(id))
      .map((id) => names.get(id)?.name ?? id),
  }));
}
