// YouTube ingestion — entirely key-free. Two undocumented-but-stable, public
// surfaces do the job without the paid/quota-limited Data API:
//   - the channel uploads RSS feed (`/feeds/videos.xml?channel_id=...`) for
//     "what's new", no auth;
//   - `youtube-caption-extractor` for transcripts of a given video id.
//
// Caveat (see that package's README): YouTube can block requests from
// datacenter IPs (Vercel/Lambda). Works fine from a normal dev machine; if
// this cron route starts failing once deployed, that's the likely cause —
// the package supports a custom `fetch` (e.g. routed through a proxy) as the
// fix, not a code rewrite.

import { getVideoDetails } from "youtube-caption-extractor";

export interface YoutubeChannel {
  id: string;
  name: string;
}

// A small, curated set of mainstream redraft-focused FF channels. Add more by
// resolving `youtube.com/@handle` -> channelId (view source, look for
// "channelId":"UC...") and appending here.
export const DEFAULT_CHANNELS: YoutubeChannel[] = [
  { id: "UC-No2ITxJsNt50oJQ3fLmUA", name: "The Fantasy Footballers" },
  { id: "UCZYaxEBdyKDsZfq_JGZwIeQ", name: "FantasyPros" },
  { id: "UCvIyBYSykqTU4oqB1gSTM5w", name: "Establish The Run" },
];

export interface YoutubeVideo {
  videoId: string;
  url: string;
  title: string;
  channelName: string;
  publishedAt: Date;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m);
}

// Parse the channel uploads feed by hand (fixed Atom shape, one <entry> per
// video) rather than pulling in an XML library for four fields.
export async function fetchChannelVideos(channel: YoutubeChannel, limit = 6): Promise<YoutubeVideo[]> {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`, {
    headers: { "User-Agent": "fantasy-agent/0.1 (personal fantasy tooling)" },
  });
  if (!res.ok) throw new Error(`YouTube feed fetch failed for ${channel.name}: ${res.status}`);
  const xml = await res.text();

  const videos: YoutubeVideo[] = [];
  for (const block of xml.split("<entry>").slice(1, limit + 1)) {
    const videoId = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = block.match(/<title>([^<]*)<\/title>/)?.[1];
    const published = block.match(/<published>([^<]+)<\/published>/)?.[1];
    if (!videoId || !title || !published) continue;
    videos.push({
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: decodeEntities(title),
      channelName: channel.name,
      publishedAt: new Date(published),
    });
  }
  return videos;
}

// Best-effort transcript text for player matching + a summary snippet. Not
// every video has captions (fresh uploads, some shorts) — callers should treat
// null as "match on title only" rather than an error.
export async function fetchTranscriptText(videoId: string, timeoutMs = 8_000): Promise<string | null> {
  try {
    const details = await Promise.race([
      getVideoDetails({ videoID: videoId, lang: "en" }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    if (!details.subtitles.length) return null;
    return details.subtitles.map((s) => s.text).join(" ");
  } catch {
    return null;
  }
}
