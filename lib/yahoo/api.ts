// Direct Yahoo Fantasy REST client (read-only). Replaces the `yahoo-fantasy`
// npm package, which fails to load under Next's Turbopack bundler.
//
// Yahoo returns deeply-nested JSON where collections are objects keyed by
// "0","1",... (+ a `count`) and entity metadata is an array of single-key
// objects. The helpers below flatten that into normal arrays/objects.

const BASE = "https://fantasysports.yahooapis.com/fantasy/v2";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function yahooGet(accessToken: string, path: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}format=json`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Yahoo GET ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.fantasy_content;
}

// A Yahoo "collection" is { "0": {...}, "1": {...}, count: n }. Return the items.
export function coll(obj: any): any[] {
  if (!obj || typeof obj !== "object") return [];
  const out: any[] = [];
  for (const k of Object.keys(obj)) {
    if (k === "count") continue;
    if (/^\d+$/.test(k)) out.push(obj[k]);
  }
  return out;
}

// Yahoo entity metadata is frequently an array (sometimes nested) of single-key
// objects. Merge everything object-shaped into one flat record.
export function merge(node: any): Record<string, any> {
  const out: Record<string, any> = {};
  const walk = (a: any) => {
    if (Array.isArray(a)) a.forEach(walk);
    else if (a && typeof a === "object") {
      for (const [k, v] of Object.entries(a)) {
        // Keep scalars/first-seen; don't clobber with nested collections.
        if (!(k in out)) out[k] = v;
      }
    }
  };
  walk(node);
  return out;
}
