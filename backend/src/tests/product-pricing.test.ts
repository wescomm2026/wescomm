import assert from "node:assert/strict";
import test from "node:test";
import { availabilityStatus, isProductOnSale } from "../domain/product-pricing.js";

test("sale state is derived only from a real price markdown", () => {
  assert.equal(isProductOnSale(900, 1_000), true);
  assert.equal(isProductOnSale("1000.00", "1000.00"), false);
  assert.equal(isProductOnSale(1_100, 1_000), false);
  assert.equal(isProductOnSale(900, null), false);
});

test("legacy ON_SALE values do not replace inventory availability", () => {
  assert.equal(availabilityStatus(0, 5, "ON_SALE"), "OUT_OF_STOCK");
  assert.equal(availabilityStatus(3, 5, "ON_SALE"), "RESTOCK_SOON");
  assert.equal(availabilityStatus(20, 5, "ON_SALE"), "IN_STOCK");
});
