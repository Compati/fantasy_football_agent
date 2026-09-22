import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { buildLeagueContext } from "@/lib/agent/context";
import {
  generateRecommendations,
  isAdvisorModel,
  DEFAULT_ADVISOR_MODEL,
  ADVISOR_MODELS,
} from "@/lib/agent/advisor";
import { traceStart, traceGather } from "@/lib/agent/trace";

export const maxDuration = 60;

// POST { teamId } -> generate (and cache) the advisor's moves for that team.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { teamId?: string; model?: string };
  const { teamId } = body;
  if (!teamId) return NextResponse.json({ error: "teamId required" }, { status: 400 });
  const model = isAdvisorModel(body.model) ? body.model : DEFAULT_ADVISOR_MODEL;

  const team = await prisma.team.findFirst({
    where: { id: teamId, isMine: true, league: { connection: { userId: user.id } } },
    include: { league: true },
  });
  if (!team) return NextResponse.json({ error: "team not found" }, { status: 404 });

  try {
    const context = await buildLeagueContext(teamId);
    traceStart(context.league.name, context.team.name, context.league.week, ADVISOR_MODELS[model]);
    traceGather(context);
    const result = await generateRecommendations(context, model);
    const moves = result.moves as unknown as Prisma.InputJsonValue;
    const rec = await prisma.recommendation.upsert({
      where: { teamId_season_week: { teamId, season: team.league.season, week: context.league.week } },
      update: { summary: result.summary, moves, model },
      create: {
        teamId,
        season: team.league.season,
        week: context.league.week,
        summary: result.summary,
        moves,
        model,
      },
    });
    return NextResponse.json({ ok: true, ...result, model, generatedAt: rec.updatedAt });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
