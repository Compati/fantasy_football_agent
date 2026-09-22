import { test } from "node:test";
import assert from "node:assert/strict";
import { isUnavailable, injuryAdjustedProj, UNAVAILABLE_STATUS } from "@/lib/features/injury";

test("isUnavailable flags ruled-out designations but not Questionable/healthy", () => {
  for (const s of UNAVAILABLE_STATUS) assert.equal(isUnavailable(s), true, s);
  assert.equal(isUnavailable("Questionable"), false);
  assert.equal(isUnavailable(null), false);
  assert.equal(isUnavailable(undefined), false);
  assert.equal(isUnavailable(""), false);
});

test("injuryAdjustedProj zeroes ruled-out players, passes others through", () => {
  assert.equal(injuryAdjustedProj(14.2, "Out"), 0);
  assert.equal(injuryAdjustedProj(14.2, "IR"), 0);
  assert.equal(injuryAdjustedProj(14.2, "Questionable"), 14.2); // still projectable
  assert.equal(injuryAdjustedProj(14.2, null), 14.2);
  assert.equal(injuryAdjustedProj(0, "Out"), 0);
});
