// Shared injury gate so start/sit, waivers, and derived trade values all treat
// ruled-out players the same way. A player carrying one of these designations
// won't play, so their projection should be treated as 0 wherever we rank or
// value players for the current week. "Questionable" is a flag only (still
// projectable) and is deliberately NOT here.

export const UNAVAILABLE_STATUS = new Set(["Out", "Doubtful", "IR", "PUP", "Sus", "NA", "DNR", "COV"]);

export function isUnavailable(status?: string | null): boolean {
  return !!status && UNAVAILABLE_STATUS.has(status);
}

// This-week projection with the injury gate applied: 0 if the player is ruled
// out, otherwise the projection as given.
export function injuryAdjustedProj(proj: number, status?: string | null): number {
  return isUnavailable(status) ? 0 : proj;
}
