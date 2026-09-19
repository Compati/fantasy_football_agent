// Tiny fetch helper: JSON with a sane User-Agent, timeout, and a clear error.
// Several of the upstreams (Sleeper's undocumented endpoints, ESPN's fantasy
// API) reject or rate-limit requests with no User-Agent, so we always send one.

const UA =
  "fantasy-agent/0.1 (personal fantasy tooling; +https://github.com/Compati)";

export interface GetJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function getJson<T = unknown>(
  url: string,
  opts: GetJsonOptions = {},
): Promise<T> {
  const { headers = {}, timeoutMs = 20_000 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `GET ${url} -> ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`,
      );
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
