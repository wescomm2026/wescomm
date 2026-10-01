import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildInventoryPlanning,
  buildReportComparisonMetric,
  reconciliationLabel
} from "../domain/report-insights.js";

test("report comparisons handle ordinary and zero-baseline periods without misleading percentages", () => {
  assert.deepEqual(buildReportComparisonMetric(120, 100), {
    current: 120,
    previous: 100,
    difference: 20,
    percentChange: 20
  });
  assert.deepEqual(buildReportComparisonMetric(120, 0), {
    current: 120,
    previous: 0,
    difference: 120,
    percentChange: null
  });
});

test("inventory planning gives beginner-friendly actions for stock and demand states", () => {
  assert.equal(buildInventoryPlanning({ stock: 0, lowStockThreshold: 5, unitsSold: 4, sales: 400, cogs: 200, observationDays: 30 }).status, "OUT_OF_STOCK");
  assert.equal(buildInventoryPlanning({ stock: 3, lowStockThreshold: 5, unitsSold: 4, sales: 400, cogs: 200, observationDays: 30 }).status, "REORDER");
  assert.equal(buildInventoryPlanning({ stock: 20, lowStockThreshold: 5, unitsSold: 0, sales: 0, cogs: 0, observationDays: 30 }).status, "NO_SALES");
  assert.equal(buildInventoryPlanning({ stock: 100, lowStockThreshold: 5, unitsSold: 2, sales: 200, cogs: 100, observationDays: 30 }).status, "SLOW_MOVING");

  const healthy = buildInventoryPlanning({ stock: 10, lowStockThreshold: 5, unitsSold: 30, sales: 3_000, cogs: 1_800, observationDays: 30 });
  assert.equal(healthy.status, "HEALTHY");
  assert.equal(healthy.marginPercent, 40);
  assert.equal(healthy.stockCoverDays, 10);
});

test("every reconciliation exception has a plain-language staff label", () => {
  assert.equal(reconciliationLabel("MISSING_TREASURY_OR"), "Treasury payment has no OR number");
  assert.equal(reconciliationLabel("POST_CUTOVER_NON_CASH"), "Non-cash payment recorded after cash-only cutoff");
});
