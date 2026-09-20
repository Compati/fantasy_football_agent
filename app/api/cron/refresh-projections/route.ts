import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { refreshProjections } from "@/lib/ingest/projections";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await refreshProjections();
  return NextResponse.json({ ok: true, ...result });
}
