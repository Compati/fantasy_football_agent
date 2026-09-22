import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitPowerLaw,
  predictValue,
  fitValueModels,
  modelFor,
  type CalibrationPoint,
} from "@/lib/values/calibrate";

test("fitPowerLaw recovers a known power law value = 2·proj^1.5", () => {
  const pts = [2, 4, 6, 8, 10, 14, 18, 22].map((proj) => ({ proj, value: 2 * proj ** 1.5 }));
  const m = fitPowerLaw(pts);
  assert.ok(m);
  assert.ok(Math.abs(m!.b - 1.5) < 1e-6, `slope ${m!.b}`);
  assert.ok(Math.abs(Math.exp(m!.a) - 2) < 1e-6, `scale ${Math.exp(m!.a)}`);
  // And it predicts the curve back.
  assert.equal(predictValue(m!, 10), Math.round(2 * 10 ** 1.5));
});

test("fitPowerLaw is monotonic: a higher projection maps to a higher value", () => {
  const pts = [3, 5, 9, 13, 17, 21].map((proj) => ({ proj, value: 5 * proj ** 1.2 }));
  const m = fitPowerLaw(pts)!;
  assert.ok(predictValue(m, 20) > predictValue(m, 8));
  assert.ok(predictValue(m, 8) > predictValue(m, 3));
});

test("fitPowerLaw returns null with too few points or no spread", () => {
  assert.equal(fitPowerLaw([{ proj: 5, value: 50 }, { proj: 6, value: 60 }]), null); // < 4 usable
  assert.equal(
    fitPowerLaw([
      { proj: 8, value: 40 },
      { proj: 8, value: 50 },
      { proj: 8, value: 60 },
      { proj: 8, value: 70 },
    ]),
    null, // identical projections -> no gradient
  );
});

test("predictValue floors at 1 and never goes negative or zero", () => {
  const m = { a: -5, b: 2, n: 10 }; // tiny values for small proj
  assert.equal(predictValue(m, 0.2), 1); // below MIN_PROJ
  assert.ok(predictValue(m, 1) >= 1);
});

test("fitValueModels fits per position and falls back to global for thin positions", () => {
  const pts: CalibrationPoint[] = [];
  // RB: plenty of points, own curve value = 3·proj^1.4
  for (const proj of [4, 6, 8, 10, 12, 16, 20]) pts.push({ position: "RB", proj, value: 3 * proj ** 1.4 });
  // WR: plenty of points, a different curve value = 6·proj^1.1
  for (const proj of [4, 6, 8, 10, 12, 16, 20]) pts.push({ position: "WR", proj, value: 6 * proj ** 1.1 });
  // TE: only 2 points -> should fall back to the global fit
  pts.push({ position: "TE", proj: 7, value: 40 });
  pts.push({ position: "TE", proj: 11, value: 70 });

  const models = fitValueModels(pts);
  assert.ok(models.byPosition.has("RB"));
  assert.ok(models.byPosition.has("WR"));
  assert.ok(!models.byPosition.has("TE")); // too thin
  assert.ok(models.global); // global still fits across all points

  // modelFor gives TE the global model, RB its own.
  assert.equal(modelFor(models, "RB"), models.byPosition.get("RB"));
  assert.equal(modelFor(models, "TE"), models.global);

  // The two position curves differ where they diverge (proj = 20).
  const rbAt20 = predictValue(models.byPosition.get("RB")!, 20);
  const wrAt20 = predictValue(models.byPosition.get("WR")!, 20);
  assert.notEqual(rbAt20, wrAt20);
});
