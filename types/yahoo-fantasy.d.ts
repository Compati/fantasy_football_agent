// Minimal ambient types for the untyped `yahoo-fantasy` package. We only use a
// handful of read methods; the responses are normalized defensively in
// lib/yahoo/ingest.ts, so the surface is intentionally loose.
declare module "yahoo-fantasy" {
  interface YahooResource {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [method: string]: (...args: any[]) => Promise<any>;
  }
  export default class YahooFantasy {
    constructor(
      clientId: string,
      clientSecret: string,
      tokenCallback?: unknown,
      redirectUri?: string,
    );
    setUserToken(accessToken: string): void;
    user: YahooResource;
    league: YahooResource;
    team: YahooResource;
    roster: YahooResource;
    games: YahooResource;
  }
}
