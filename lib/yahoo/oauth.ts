// Yahoo OAuth2 (read-only). Standard authorization-code flow. We store the
// refresh token and refresh the access token on demand. Scope `fspt-r` =
// Fantasy Sports READ — advise-only, so we never request write.

const AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const SCOPE = "fspt-r";

export function yahooConfigured(): boolean {
  return !!(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET);
}

function redirectUri(): string {
  return process.env.YAHOO_REDIRECT_URI ?? "http://localhost:3000/api/yahoo/callback";
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.YAHOO_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface YahooTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  guid: string | null;
}

function basicAuthHeader(): string {
  const id = process.env.YAHOO_CLIENT_ID ?? "";
  const secret = process.env.YAHOO_CLIENT_SECRET ?? "";
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

async function tokenRequest(body: URLSearchParams): Promise<YahooTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Yahoo token request failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    xoauth_yahoo_guid?: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    guid: json.xoauth_yahoo_guid ?? null,
  };
}

export function exchangeCode(code: string): Promise<YahooTokens> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
      code,
    }),
  );
}

export function refreshAccessToken(refreshToken: string): Promise<YahooTokens> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      redirect_uri: redirectUri(),
      refresh_token: refreshToken,
    }),
  );
}
