// Phase 4: pull Reddit + YouTube community context and tag it to the players
// it actually mentions. Only items that name a fantasy-relevant player (one
// with a projection this week) are kept — an untagged item is just noise no
// feature or the advisor could ground anything in.

import { prisma } from "@/lib/db";
import { getNflState } from "@/lib/sleeper";
import { ensureCatalogFresh, normalizeName } from "@/lib/players";
import { redditConfigured, fetchSubredditPosts, DEFAULT_SUBREDDITS } from "@/lib/reddit";
import { DEFAULT_CHANNELS, fetchChannelVideos, fetchTranscriptText } from "@/lib/youtube";

interface PlayerMatcher {
  sleeperId: string;
  regex: RegExp;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildPlayerMatcher(players: { sleeperId: string; name: string }[]): PlayerMatcher[] {
  return players
    .map((p) => normalizeName(p.name))
    .map((name, i) => ({ name, player: players[i] }))
    .filter((x) => x.name.length > 2) // skip bare single-letter/short names (mostly DEF placeholders)
    .map(({ name, player }) => ({
      sleeperId: player.sleeperId,
      regex: new RegExp(`\\b${escapeRegex(name)}\\b`),
    }));
}

export function matchPlayers(text: string, matcher: PlayerMatcher[]): string[] {
  const normalized = normalizeName(text);
  return matcher.filter((m) => m.regex.test(normalized)).map((m) => m.sleeperId);
}

// The universe of players worth matching against: anyone with a current-week
// projection (~500-1500 fantasy-relevant players), not the full ~12k catalog —
// keeps matching fast and avoids false positives from obscure/inactive names.
async function relevantPlayers(): Promise<{ sleeperId: string; name: string }[]> {
  const state = await getNflState();
  const season = Number(state.season);
  const week = state.week > 0 ? state.week : 1;
  const projected = await prisma.projection.findMany({
    where: { season, week },
    select: { sleeperId: true },
    distinct: ["sleeperId"],
  });
  if (projected.length === 0) return [];
  return prisma.player.findMany({
    where: { sleeperId: { in: projected.map((p) => p.sleeperId) } },
    select: { sleeperId: true, name: true },
  });
}

export interface NewsRefreshResult {
  redditChecked: number;
  youtubeChecked: number;
  itemsUpserted: number;
  pruned: number;
}

export async function refreshNews(): Promise<NewsRefreshResult> {
  await ensureCatalogFresh();
  const players = await relevantPlayers();
  const matcher = buildPlayerMatcher(players);

  let redditChecked = 0;
  let youtubeChecked = 0;
  let itemsUpserted = 0;

  if (matcher.length > 0 && redditConfigured()) {
    for (const subreddit of DEFAULT_SUBREDDITS) {
      const posts = await fetchSubredditPosts(subreddit, { limit: 30 }).catch(() => []);
      redditChecked += posts.length;
      for (const post of posts) {
        const playerIds = matchPlayers(`${post.title} ${post.summary ?? ""}`, matcher);
        if (playerIds.length === 0) continue;
        await prisma.newsItem.upsert({
          where: { url: post.url },
          create: {
            source: "reddit",
            url: post.url,
            title: post.title,
            summary: post.summary,
            publishedAt: post.publishedAt,
            playerIds,
          },
          update: { title: post.title, summary: post.summary, playerIds },
        });
        itemsUpserted++;
      }
    }
  }

  if (matcher.length > 0) {
    const videoLists = await Promise.all(
      DEFAULT_CHANNELS.map((c) => fetchChannelVideos(c, 6).catch(() => [])),
    );
    const videos = videoLists.flat();
    youtubeChecked = videos.length;

    // Transcripts fetched concurrently — bounded by fetchTranscriptText's own
    // per-call timeout, not summed, so this stays well under the cron's
    // maxDuration even for a couple dozen videos.
    const transcripts = await Promise.all(videos.map((v) => fetchTranscriptText(v.videoId)));

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const transcript = transcripts[i];
      const playerIds = matchPlayers(`${video.title} ${transcript ?? ""}`, matcher);
      if (playerIds.length === 0) continue;
      const summary = transcript ? transcript.slice(0, 500) : null;
      await prisma.newsItem.upsert({
        where: { url: video.url },
        create: {
          source: "youtube",
          url: video.url,
          title: `${video.channelName}: ${video.title}`,
          summary,
          publishedAt: video.publishedAt,
          playerIds,
        },
        update: { summary, playerIds },
      });
      itemsUpserted++;
    }
  }

  const pruned = await pruneOldNews();
  return { redditChecked, youtubeChecked, itemsUpserted, pruned };
}

// News older than this stops being a useful start/sit or waiver signal — keep
// the table small and current rather than accumulating forever.
export async function pruneOldNews(days = 21): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const { count } = await prisma.newsItem.deleteMany({ where: { publishedAt: { lt: cutoff } } });
  return count;
}
