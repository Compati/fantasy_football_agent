// Confirm the Yahoo OAuth config is loaded and the auth URL is well-formed.
// Imports prisma first so .env is loaded. Prints nothing sensitive.
import "@/lib/db";
import { yahooConfigured, buildAuthUrl } from "@/lib/yahoo/oauth";

const configured = yahooConfigured();
console.log("yahooConfigured:", configured);
if (configured) {
  const u = new URL(buildAuthUrl("connect"));
  console.log("auth host:", u.host);
  console.log("scope:", u.searchParams.get("scope"));
  console.log("redirect_uri:", u.searchParams.get("redirect_uri"));
  console.log("client_id length:", (u.searchParams.get("client_id") ?? "").length);
  console.log("client_secret present:", !!process.env.YAHOO_CLIENT_SECRET);
}
process.exit(0);
