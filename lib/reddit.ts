// Reddit read-only client — app-only OAuth (client_credentials grant). No user
// login is needed: a free "script" app registered at reddit.com/prefs/apps
// gives a client id + secret that can read public subreddits. This is why
// r/fantasyfootball works for community sentiment without asking Alex to sign
// in with his own Reddit account.
//
// Reddit's unauthenticated `www.reddit.com/*.json` endpoints are blocked
// (verified: 403) — the OAuth token below is required even for public reads.

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";
const USER_AGENT = "fantasy-agent/0.1 (personal fantasy tooling; read-only)";

export const DEFAULT_SUBREDDITS = ["fantasyfootball"];

export function redditConfigured(): boolean {
  return !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

interface RedditTokenResponse {
  access_token: string;
  expires_in: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const id = process.env.REDDIT_CLIENT_ID ?? "";
  const secret = process.env.REDDIT_CLIENT_SECRET ?? "";
  if (!id || !secret) throw new Error("REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET not set.");
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Reddit token request failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as RedditTokenResponse;
  cachedToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return cachedToken.token;
}

interface RedditListingChild {
  data: {
    permalink: string;
    title: string;
    selftext?: string;
    created_utc: number;
    stickied?: boolean;
  };
}

interface RedditListing {
  data: { children: RedditListingChild[] };
}

export interface RedditPost {
  url: string;
  title: string;
  summary: string | null;
  publishedAt: Date;
}

// Recent posts from a subreddit's "hot" listing. Stickied threads (weekly
// megathreads, rules posts) are filtered out — they never mention a specific
// player by name and would just add noise.
export async function fetchSubredditPosts(
  subreddit: string,
  opts: { limit?: number } = {},
): Promise<RedditPost[]> {
  const token = await getAccessToken();
  const limit = opts.limit ?? 30;
  const res = await fetch(`${API_BASE}/r/${subreddit}/hot?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Reddit fetch failed for r/${subreddit}: ${res.status}`);
  const json = (await res.json()) as RedditListing;
  return json.data.children
    .filter((c) => !c.data.stickied)
    .map((c) => ({
      url: `https://www.reddit.com${c.data.permalink}`,
      title: c.data.title,
      summary: c.data.selftext ? c.data.selftext.slice(0, 600) : null,
      publishedAt: new Date(c.data.created_utc * 1000),
    }));
}
