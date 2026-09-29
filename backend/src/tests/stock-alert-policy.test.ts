import assert from "node:assert/strict";
import test from "node:test";
import { calculateLowStockThreshold, nextStockAlertPolicy, requireLowStockPercent } from "../domain/stock-alert-policy.js";

test("percentage stock alerts round up from a stable stock target", () => {
  assert.equal(calculateLowStockThreshold(100, 25), 25);
  assert.equal(calculateLowStockThreshold(7, 25), 2);
  assert.equal(calculateLowStockThreshold(0, 25), 0);
});

test("restocking grows but never silently shrinks the stock target", () => {
  assert.deepEqual(nextStockAlertPolicy({ previousTarget: 40, resultingStock: 60, lowStockPercent: 20, previousPercent: 25 }), {
    stockTarget: 60,
    lowStockPercent: 20,
    lowStockThreshold: 12
  });
  assert.equal(nextStockAlertPolicy({ previousTarget: 60, resultingStock: 30, previousPercent: 20 }).stockTarget, 60);
});

test("stock alert percentages reject unsafe values", () => {
  assert.throws(() => requireLowStockPercent(0), /1 to 100/);
  assert.throws(() => requireLowStockPercent(101), /1 to 100/);
  assert.throws(() => requireLowStockPercent(12.5), /whole number/);
});
