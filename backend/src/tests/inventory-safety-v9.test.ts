import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { requireInventoryInteger } from "../services/sku-inventory.service.js";

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("inventory quantities reject silent coercion and preserve valid whole numbers", () => {
  assert.equal(requireInventoryInteger(0, 2, "Stock", "INVALID"), 0);
  assert.equal(requireInventoryInteger(undefined, 2, "Stock", "INVALID"), 2);
  assert.equal(requireInventoryInteger(10_000_000, 0, "Stock", "INVALID"), 10_000_000);
  assert.throws(() => requireInventoryInteger(-1, 0, "Stock", "INVALID"), /whole number/);
  assert.throws(() => requireInventoryInteger(1.5, 0, "Stock", "INVALID"), /whole number/);
  assert.throws(() => requireInventoryInteger(Number.NaN, 0, "Stock", "INVALID"), /whole number/);
  assert.throws(() => requireInventoryInteger(10_000_001, 0, "Stock", "INVALID"), /whole number/);
});

test("aggregate and SKU exact-count paths share the active-reservation guard", () => {
  const aggregateInventory = source("src/services/inventory.service.ts");
  const skuInventory = source("src/services/sku-inventory.service.ts");
  const guard = source("src/utils/inventory-reservation.ts");

  assert.match(aggregateInventory, /mode === "set"[\s\S]*requireNoActiveInventoryReservations/);
  assert.match(aggregateInventory, /EXACT_COUNT_HAS_ACTIVE_RESERVATIONS/);
  assert.match(skuInventory, /SKU_EXACT_COUNT_HAS_ACTIVE_RESERVATIONS/);
  assert.match(guard, /reservationItem\.findFirst/);
  assert.match(guard, /"PENDING"/);
  assert.match(guard, /"CONFIRMED"/);
  assert.match(guard, /"READY_FOR_PICKUP"/);
});

test("option structure and SKU combinations rebuild in one API transaction", () => {
  const routes = source("src/routes/staff-products.routes.ts");
  const service = source("src/services/sku-inventory.service.ts");
  const dialog = source("../frontend/components/staff/SkuInventoryDialog.tsx");

  assert.match(routes, /optionGroups: z\.array\(skuOptionGroupSchema\)/);
  assert.match(routes, /optionValueKeys: z\.array/);
  assert.match(service, /SKU_DUPLICATE_OPTION_GROUP_NAME/);
  assert.match(service, /UPDATE "product_variants" AS pv[\s\S]*FROM \(VALUES/);
  assert.match(service, /productSku\.createMany/);
  assert.match(service, /productSkuVariant\.createMany/);
  assert.match(dialog, /Atomic option and inventory setup/);
  assert.match(dialog, /Generate all/);
  assert.match(dialog, /optionGroups/);
});

test("SKU restock uses set-based writes and bulk movement creation", () => {
  const service = source("src/services/sku-inventory.service.ts");

  assert.match(service, /UPDATE "product_skus" AS ps[\s\S]*FROM \(VALUES/);
  assert.match(service, /inventoryMovement\.createMany\([\s\S]*changes\.map/);
  assert.doesNotMatch(service, /for \(const sku of product\.skus\)[\s\S]{0,900}productSku\.update\(/);
});

test("inventory repair migration cleans only stale aggregate data and auto-reconciles provable one-group stock", () => {
  const migration = source("prisma/migrations/20260828000000_repair_inventory_invariants/migration.sql");

  assert.match(migration, /sale_mode <> 'OPTIONS'/);
  assert.match(migration, /COUNT\(DISTINCT lower\(regexp_replace/);
  assert.match(migration, /COALESCE\(SUM\(stock\), 0\)[\s\S]*= p\.stock/);
  assert.match(migration, /NOT EXISTS \([\s\S]*reservation_items[\s\S]*READY_FOR_PICKUP/);
  assert.match(migration, /products_stock_nonnegative/);
  assert.match(migration, /product_variants_stock_nonnegative/);
});

test("archived products have an explicit filtered, audited, and realtime restore workflow", () => {
  const routes = source("src/routes/staff-products.routes.ts");
  const service = source("src/services/inventory.service.ts");
  const client = source("../frontend/lib/staff-api.ts");
  const inventoryScreen = source("../frontend/components/staff/StaffInventoryExperience.tsx");

  assert.match(routes, /visibility: z\.enum\(\["ACTIVE", "ARCHIVED"\]\)\.default\("ACTIVE"\)/);
  assert.match(routes, /"\/:id\/restore"[\s\S]*restoreProduct[\s\S]*publishInventoryChange\(product\.id, "restored"\)/);
  assert.match(service, /isActive: input\.visibility === "ARCHIVED" \? false : true/);
  assert.match(service, /export async function restoreProduct[\s\S]*data: \{ isActive: true[\s\S]*action: "PRODUCT_RESTORED"/);
  assert.match(client, /export async function restoreStaffProduct[\s\S]*method: "POST"/);
  assert.match(inventoryScreen, /Archived items/);
  assert.match(inventoryScreen, /Restore this product\?/);
  assert.match(inventoryScreen, /Restore item/);
});
