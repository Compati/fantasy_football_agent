import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { buildAuthUrl, yahooConfigured } from "@/lib/yahoo/oauth";

// Kick off Yahoo OAuth. The user's session cookie rides along through the
// redirect, so the callback can identify them.
export async function GET() {
  await requireUser();
  if (!yahooConfigured()) {
    return NextResponse.json(
      { error: "Yahoo is not configured. Set YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET." },
      { status: 400 },
    );
  }
  return NextResponse.redirect(buildAuthUrl("connect"));
}
