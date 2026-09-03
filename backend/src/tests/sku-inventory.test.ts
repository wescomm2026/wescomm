import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalSkuVariantKey,
  normalizeSkuOptionName,
  sameSkuVariantSelection
} from "../domain/sku-inventory.js";

test("SKU option names normalize consistently", () => {
  assert.equal(normalizeSkuOptionName("  Top   Size "), "top size");
  assert.equal(normalizeSkuOptionName("WAIST"), "waist");
});

test("SKU combination identity is independent of option ordering", () => {
  assert.equal(canonicalSkuVariantKey(["variant-b", "variant-a"]), "variant-a|variant-b");
  assert.equal(sameSkuVariantSelection(["variant-a", "variant-b"], ["variant-b", "variant-a"]), true);
  assert.equal(sameSkuVariantSelection(["variant-a"], ["variant-a", "variant-b"]), false);
});
