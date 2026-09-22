// Projection-derived trade values: gap-fill for players outside FantasyCalc's
// ~200-deep ranked set. For each league format we (1) take the FantasyCalc rows
// that also have a projection as calibration data, (2) fit a projection->value
// power law per position, and (3) apply it to projected players who have NO
// FantasyCalc value, storing the estimate as source "derived". This keeps deep-
// league players (15-team superflex) from showing a blank/zero value.

import { prisma } from "@/lib/db";
import { getNflState } from "@/lib/sleeper";
import { blendProjections } from "@/lib/projections/consensus";
import { fitValueModels, modelFor, predictValue, type CalibrationPoint } from "@/lib/values/calibrate";
import { isUnavailable } from "@/lib/features/injury";
import type { ProjectionRow, ScoringContext } from "@/lib/types";

// Positions FantasyCalc actually values (skill positions). K/DEF have no market
// value and no calibration data, so we leave them blank rather than invent one.
const VALUED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

export async function refreshDerivedValues(ctx: ScoringContext, week?: number): Promise<number> {
  const state = await getNflState();
  const w = week ?? (state.week > 0 ? state.week : 1);
  const season = state.season ? Number(state.season) : new Date().getFullYear();

  const projRows = await prisma.projection.findMany({ where: { season, week: w } });
  if (projRows.length === 0) return 0; // no projections yet this week — nothing to derive from
  const consensus = blendProjections(projRows as unknown as ProjectionRow[]);

  const formatWhere = {
    isDynasty: false,
    ppr: ctx.ppr,
    numQbs: ctx.numQbs,
    numTeams: ctx.numTeams,
  };
  const fcRows = await prisma.tradeValue.findMany({
    where: { ...formatWhere, source: "fantasycalc" },
  });
  const fcById = new Map(fcRows.map((r) => [r.sleeperId, r]));

  // Positions + injury status for every projected player (one query).
  const projIds = [...consensus.keys()];
  const players = await prisma.player.findMany({
    where: { sleeperId: { in: projIds } },
    select: { sleeperId: true, position: true, injuryStatus: true },
  });
  const posById = new Map(players.map((p) => [p.sleeperId, p.position]));
  const statusById = new Map(players.map((p) => [p.sleeperId, p.injuryStatus]));

  // Calibration set: players with BOTH a FantasyCalc value and a projection.
  // Skip ruled-out players — their weekly projection is unreliable, so they'd
  // distort the fit.
  const calibration: CalibrationPoint[] = [];
  for (const r of fcRows) {
    const c = consensus.get(r.sleeperId);
    const pos = posById.get(r.sleeperId);
    if (c && pos && VALUED_POSITIONS.has(pos) && !isUnavailable(statusById.get(r.sleeperId))) {
      calibration.push({ position: pos, proj: c.points, value: r.value });
    }
  }
  const models = fitValueModels(calibration);
  if (!models.global && models.byPosition.size === 0) return 0; // can't calibrate

  // Gap-fill: projected, valued-position players with no FantasyCalc row. Don't
  // invent a value for a ruled-out player from a projection we'd otherwise zero.
  const derived = projIds
    .filter((id) => !fcById.has(id) && !isUnavailable(statusById.get(id)))
    .map((id) => ({ id, pos: posById.get(id), proj: consensus.get(id)!.points }))
    .filter((x): x is { id: string; pos: string; proj: number } => !!x.pos && VALUED_POSITIONS.has(x.pos))
    .map((x) => {
      const model = modelFor(models, x.pos);
      if (!model) return null;
      const value = predictValue(model, x.proj);
      return {
        sleeperId: x.id,
        ...formatWhere,
        value,
        redraftValue: value,
        overallRank: 0,
        positionRank: 0,
        trend30: 0,
        tier: null,
        source: "derived",
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  await prisma.tradeValue.deleteMany({ where: { ...formatWhere, source: "derived" } });
  if (derived.length > 0) await prisma.tradeValue.createMany({ data: derived });
  return derived.length;
}

// Derive values for every distinct format among the user's leagues. Assumes
// FantasyCalc values are already ingested (run this after refreshTradeValues).
export async function refreshDerivedValuesForUser(userId: string): Promise<number> {
  const leagues = await prisma.league.findMany({
    where: { connection: { userId } },
    select: { ppr: true, numQbs: true, numTeams: true },
  });
  const seen = new Set<string>();
  let total = 0;
  for (const l of leagues) {
    const key = `${l.ppr}|${l.numQbs}|${l.numTeams}`;
    if (seen.has(key)) continue;
    seen.add(key);
    total += await refreshDerivedValues({ ppr: l.ppr, numQbs: l.numQbs, numTeams: l.numTeams });
  }
  return total;
}
