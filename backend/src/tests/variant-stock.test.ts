import assert from "node:assert/strict";
import test from "node:test";
import {
  optionGroupsHaveAvailableStock,
  resolveReservationVariantSelections,
  selectStockVariantGroup,
  validateVariantGroupTotals
} from "../domain/variant-stock.js";

const variants = [
  { id: "size-small", optionName: "Size", optionValue: "Small", stock: 0 },
  { id: "size-medium", optionName: "Size", optionValue: "Medium", stock: 5 },
  { id: "color-green", optionName: "Color", optionValue: "Green", stock: 2 },
  { id: "color-white", optionName: "Color", optionValue: "White", stock: 3 }
];

test("a reservation uses one authoritative stock option group", () => {
  assert.equal(resolveReservationVariantSelections({ variants }).issue?.code, "MISSING_OPTION");
  assert.equal(
    resolveReservationVariantSelections({ variants, summary: "Size: Medium" }).issue,
    null
  );
  assert.deepEqual(
    resolveReservationVariantSelections({ variants, summary: "Size: Small, Size: Medium, Color: Green" }).issue,
    { code: "DUPLICATE_OPTION", optionName: "Size" }
  );
  assert.deepEqual(
    resolveReservationVariantSelections({ variants, summary: "Size: Large, Color: Green" }).issue,
    { code: "UNKNOWN_VALUE", optionName: "Size", optionValue: "Large" }
  );

  const valid = resolveReservationVariantSelections({
    variants,
    summary: "size: medium, COLOR: white | Note: QA selection"
  });
  assert.equal(valid.issue, null);
  assert.deepEqual(valid.selected.map((variant) => variant.id), ["size-medium"]);
});

test("size is preferred over legacy secondary option groups for stock", () => {
  assert.deepEqual(
    selectStockVariantGroup(variants).map((variant) => variant.id),
    ["size-small", "size-medium"]
  );
});

test("products without options reject unexpected structured option selections", () => {
  assert.equal(resolveReservationVariantSelections({ variants: [], summary: "Note: Handle with care" }).issue, null);
  assert.deepEqual(
    resolveReservationVariantSelections({ variants: [], summary: "Size: Medium" }).issue,
    { code: "UNEXPECTED_OPTION", optionName: "Size" }
  );
});

test("only the authoritative stock group must match the product total", () => {
  assert.equal(validateVariantGroupTotals(variants, 5), null);
  assert.deepEqual(
    validateVariantGroupTotals(variants, 6),
    { code: "TOTAL_MISMATCH", optionName: "Size", expectedTotal: 6, actualTotal: 5 }
  );
  assert.equal(
    validateVariantGroupTotals([
      ...variants,
      { id: "duplicate", optionName: " size ", optionValue: " MEDIUM ", stock: 0 }
    ], 5)?.code,
    "DUPLICATE_VARIANT"
  );
});

test("availability depends on the authoritative stock group", () => {
  assert.equal(optionGroupsHaveAvailableStock(variants), true);
  assert.equal(optionGroupsHaveAvailableStock(variants.map((variant) => (
    variant.optionName === "Color" ? { ...variant, stock: 0 } : variant
  ))), true);
  assert.equal(optionGroupsHaveAvailableStock(variants.map((variant) => (
    variant.optionName === "Size" ? { ...variant, stock: 0 } : variant
  ))), false);
  assert.equal(optionGroupsHaveAvailableStock([]), true);
});
