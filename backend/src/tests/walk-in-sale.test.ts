import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("walk-in sale records require cash received server-side and persist tendered cash", () => {
  const routes = source("src/routes/walk-in-sales.routes.ts");
  const service = source("src/services/walk-in-sale.service.ts");

  assert.match(routes, /cashReceived: z\.coerce\.number\(\)\.nonnegative\(\)\.max\(10_000_000\)\.multipleOf\(0\.01\)/);
  assert.doesNotMatch(routes, /cashReceived:[^\n]*optional\(\)/);
  assert.match(service, /INVALID_CASH_RECEIVED/);
  assert.match(service, /input\.cashReceived < totalAmount/);
  assert.match(service, /cashTendered: new Prisma\.Decimal\(input\.cashReceived\)/);
  assert.match(service, /changeDue: new Prisma\.Decimal\(changeDue\)/);
});

test("walk-in sale creation is idempotent per client sale key and cashier", () => {
  const routes = source("src/routes/walk-in-sales.routes.ts");
  const service = source("src/services/walk-in-sale.service.ts");

  assert.match(routes, /clientSaleId:[^\n]+regex[^\n]+\n/);
  assert.doesNotMatch(routes, /clientSaleId:[^\n]*optional\(\)/);
  assert.match(service, /where: \{ clientSaleId \}/);
  assert.match(service, /DUPLICATE_SALE_KEY/);
  assert.match(service, /IDEMPOTENCY_PAYLOAD_MISMATCH/);
  assert.match(service, /requestFingerprint/);
  assert.match(service, /existing\.cashierId !== input\.performedById/);
  assert.match(service, /replayed: true/);
  assert.match(service, /replayExistingSale\(clientSaleId, input\.performedById, requestFingerprint\)/);
  assert.match(service, /if \(!result\.replayed\) \{\s*await createNotificationBestEffort/);
});

test("walk-in sale returns the freshly selected receipt with line items, not the pre-item stale object", () => {
  const service = source("src/services/walk-in-sale.service.ts");

  assert.match(service, /tx\.receipt\.create\([\s\S]*select: \{ id: true \}/);
  assert.match(service, /const fresh = await tx\.receipt\.findUnique/);
  assert.match(service, /itemCount: mappedReceipt\.items\.length/);
});

test("voiding locks the receipt row before reading its status and never overwrites the original cashier", () => {
  const service = source("src/services/walk-in-sale.service.ts");

  assert.match(service, /SELECT id, status[\s\S]*FROM "receipts"[\s\S]*FOR UPDATE/);
  assert.match(service, /status: "VOIDED",\s*voidedAt: now/);
  assert.match(service, /voidedById: input\.voidedById,\s*voidReason: reason,\s*voidedAt: now/);
  assert.doesNotMatch(service, /data: \{\s*status: "VOIDED",\s*issuedById: input\.voidedById/);
  assert.match(service, /if \(result\.changed\) \{\s*await safelyRecordAuditLog/);
});

test("walk-in sales allocate FIFO batches and void reverses the exact allocations", () => {
  const cost = source("src/services/inventory-cost.service.ts");
  const service = source("src/services/walk-in-sale.service.ts");

  assert.match(cost, /export async function allocateWalkInSaleCostsInTransaction/);
  assert.match(cost, /export async function reverseWalkInSaleCostAllocationsInTransaction/);
  assert.match(cost, /quantityRemaining: \{ decrement: quantity \}/);
  assert.match(cost, /quantityRemaining: \{ increment: allocation\.quantity \}/);
  assert.match(cost, /tx\.walkInSaleCostAllocation\.create/);
  assert.match(cost, /requiredBatches\.some\(\(batch\) => !batch\.cost_verified\)/);
  assert.match(cost, /UNVERIFIED_BATCH_COST/);
  assert.match(cost, /current\.costAllocations\.length \|\| current\.walkInAllocations\.length/);
  assert.match(service, /allocateWalkInSaleCostsInTransaction\(tx, \{/);
  assert.match(service, /reverseWalkInSaleCostAllocationsInTransaction\(tx, \{ walkInSaleItemId: item\.id \}\)/);
});

test("receipt API and public verification expose walk-in line items", () => {
  const receiptService = source("src/services/receipt.service.ts");

  assert.match(receiptService, /walkInSaleItems: \{\s*select: \{\s*id: true,\s*productNameSnapshot: true,\s*optionSnapshot: true,\s*quantity: true,\s*unitPrice: true,\s*subtotal: true\s*\}/);
  assert.match(receiptService, /walkInSaleItems: receipt\.walkInSaleItems\.map/);
  assert.match(receiptService, /walk_in_sale_items:walk_in_sale_items\(\s*quantity\s*\)/);
  assert.match(receiptService, /reservation\?\.items \?\? receipt\.walkInSaleItems/);
  assert.match(receiptService, /summarizePublicReceiptItems\(reservation\?\.items \?\? row\.walk_in_sale_items\)/);
});

test("financial reports include verified walk-in sales, voids, and cashier reconciliation", () => {
  const report = source("src/services/report.service.ts");

  assert.match(report, /"walkInSaleAggregate"/);
  assert.match(report, /"walkInVoidAggregate"/);
  assert.match(report, /"walkInSalesTrendRows"/);
  assert.match(report, /"walkInCategorySalesRows"/);
  assert.match(report, /"walkInItemSalesRows"/);
  assert.match(report, /"walkInCashierRows"/);
  assert.match(report, /COALESCE\(sale\.voided_at, receipt\.voided_at, receipt\.updated_at\)/);
  assert.match(report, /walkInSales: \{\s*amount: walkInSalesAmount/);
  assert.match(report, /walkInVoids: \{/);
  assert.match(report, /cashierReconciliation: payload\.walkInCashierRows\.map/);
  assert.match(report, /toNumber\(previous\.totalSales\) \+ toNumber\(previous\.walkInSales\)/);
});

test("walk-in sale schema persists cashier, cash, idempotency, and void metadata", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/20261001000000_add_walk_in_sales/migration.sql");

  assert.match(schema, /model WalkInSale \{/);
  assert.match(schema, /cashierNameSnapshot String\s+@map\("cashier_name_snapshot"\)/);
  assert.match(schema, /clientSaleId\s+String\s+@unique/);
  assert.match(schema, /requestFingerprint\s+String\s+@map\("request_fingerprint"\)/);
  assert.match(schema, /cashTendered\s+Decimal\s+@map\("cash_tendered"\)/);
  assert.match(schema, /voidReason\s+String\?\s+@map\("void_reason"\)/);
  assert.match(schema, /model WalkInSaleCostAllocation \{/);
  assert.match(migration, /CREATE TABLE "walk_in_sales"/);
  assert.match(migration, /"client_sale_id" VARCHAR\(64\) NOT NULL/);
  assert.match(migration, /"request_fingerprint" CHAR\(64\) NOT NULL/);
  assert.match(migration, /CREATE TABLE "walk_in_sale_cost_allocations"/);
  assert.match(migration, /REFERENCES "inventory_batches"\("id"\) ON DELETE RESTRICT/);
  assert.match(migration, /walk_in_sale_cost_allocations" ENABLE ROW LEVEL SECURITY/);
});
