import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { exchangeCode } from "@/lib/yahoo/oauth";
import { refreshYahooLeagues } from "@/lib/yahoo/ingest";

// Yahoo redirects here with ?code=. Exchange it, store the tokens on the user's
// Yahoo connection (read-only), then pull their leagues.
export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const origin = url.origin;

  if (error) {
    return NextResponse.redirect(`${origin}/dashboard?yahoo=denied`);
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/dashboard?yahoo=missing_code`);
  }

  try {
    const tokens = await exchangeCode(code);
    const connection = await prisma.connection.upsert({
      where: { userId_platform: { userId: user.id, platform: "yahoo" } },
      update: {
        yahooAccessToken: tokens.accessToken,
        yahooRefreshToken: tokens.refreshToken,
        yahooExpiresAt: tokens.expiresAt,
        yahooGuid: tokens.guid,
      },
      create: {
        userId: user.id,
        platform: "yahoo",
        yahooAccessToken: tokens.accessToken,
        yahooRefreshToken: tokens.refreshToken,
        yahooExpiresAt: tokens.expiresAt,
        yahooGuid: tokens.guid,
      },
    });
    await refreshYahooLeagues(connection.id);
    return NextResponse.redirect(`${origin}/dashboard?yahoo=connected`);
  } catch (e) {
    console.error("Yahoo callback failed:", e);
    return NextResponse.redirect(`${origin}/dashboard?yahoo=error`);
  }
}
