"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { connectSleeper, refreshSleeperLeagues } from "@/lib/ingest/sleeper";
import { prisma } from "@/lib/db";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function connectSleeperAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const username = String(formData.get("username") ?? "").trim();
  if (!username) return { ok: false, message: "Enter your Sleeper username." };

  try {
    const summary = await connectSleeper(user.id, username);
    revalidatePath("/dashboard");
    return {
      ok: true,
      message: `Connected ${summary.username}: ${summary.leagues} leagues, ${summary.teams} teams (${summary.season}).`,
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function refreshSleeperAction(): Promise<ActionResult> {
  const user = await requireUser();
  const conn = await prisma.connection.findUnique({
    where: { userId_platform: { userId: user.id, platform: "sleeper" } },
  });
  if (!conn) return { ok: false, message: "No Sleeper connection to refresh." };
  try {
    const summary = await refreshSleeperLeagues(conn.id);
    revalidatePath("/dashboard");
    return { ok: true, message: `Refreshed ${summary.leagues} leagues.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
