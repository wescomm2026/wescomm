import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("catalog stock changes bypass the bounded public cache on realtime refresh", () => {
  const productRoutes = source("src/routes/products.routes.ts");
  const productService = source("src/services/product.service.ts");
  const staffProductRoutes = source("src/routes/staff-products.routes.ts");
  const legacyInventoryRoutes = source("src/routes/inventory.routes.ts");
  const reservationService = source("src/services/reservation.service.ts");
  const clientApi = source("../frontend/lib/api.ts");
  const realtimeClient = source("../frontend/components/realtime/RealtimeProvider.tsx");

  assert.match(productRoutes, /fresh[\s\S]*"private, no-store, max-age=0"/);
  assert.match(productRoutes, /"public, max-age=0, s-maxage=30, stale-while-revalidate=60"/);
  assert.match(productRoutes, /listProducts\(filters, \{ bypassCache: Boolean\(fresh\) \}\)/);
  assert.match(productService, /PUBLIC_PRODUCT_CACHE_TTL_MS = 30_000/);
  assert.match(productService, /if \(publicCatalogRequest\) return publicCatalogRequest/);
  assert.match(staffProductRoutes, /REALTIME_TOPICS\.inventory[\s\S]*audienceRoles: \["STUDENT", "STAFF", "ADMIN"\]/);
  assert.match(legacyInventoryRoutes, /REALTIME_TOPICS\.inventory[\s\S]*audienceRoles: \["STUDENT", "STAFF", "ADMIN"\]/);
  assert.match(reservationService, /action: "reservation-hold"/);
  assert.match(reservationService, /action: "reservation-stock-released"/);
  assert.match(clientApi, /invalidateProductsCache/);
  assert.match(clientApi, /requestProductsRefresh[\s\S]*invalidateProductsCache\(\)[\s\S]*PRODUCTS_REFRESH_EVENT/);
  assert.match(clientApi, /cache: fresh \? "no-store" : "default"/);
  assert.match(clientApi, /`\/products\?fresh=\$\{encodeURIComponent/);
  assert.match(clientApi, /pendingProducts\.generation === generation/);
  assert.match(realtimeClient, /update\.topic === "inventory"[\s\S]*requestProductsRefresh\(update\)/);
});

test("restock keeps aggregate and option stock in one protected transaction", () => {
  const inventoryService = source("src/services/inventory.service.ts");
  const staffProductRoutes = source("src/routes/staff-products.routes.ts");
  const staffInventory = source("../frontend/components/staff/StaffInventoryExperience.tsx");
  const productDisplay = source("../frontend/lib/product-display.ts");
  const repairMigration = source("prisma/migrations/20260824000000_reconcile_singleton_variant_stock/migration.sql");

  assert.match(staffProductRoutes, /variantQuantities: z\.array/);
  assert.match(inventoryService, /VARIANT_STOCK_ALLOCATION_REQUIRED/);
  assert.match(inventoryService, /VARIANT_STOCK_TOTAL_MISMATCH/);
  assert.match(inventoryService, /VARIANT_STOCK_RECONCILIATION_REQUIRED/);
  assert.match(inventoryService, /VARIANT_STRUCTURE_REQUIRES_ZERO_STOCK/);
  assert.match(inventoryService, /transaction\.productVariant\.update/);
  assert.match(inventoryService, /variantId: variant\.id[\s\S]*previousStock: variant\.stock[\s\S]*newStock: variant\.nextStock/);
  assert.match(staffInventory, /restockVariantQuantities/);
  assert.match(staffInventory, /variantQuantities/);
  assert.match(productDisplay, /productOptionValueStock/);
  assert.match(productDisplay, /firstAvailableOptionValue/);
  assert.match(repairMigration, /COUNT\(\*\)[\s\S]*= 1/);
  assert.match(repairMigration, /inventory_movements/);
});
