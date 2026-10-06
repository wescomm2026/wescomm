import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("walk-in POS catalog search covers inventory names, aliases, options, and SKU codes", () => {
  const inventory = source("src/services/inventory.service.ts");

  assert.match(inventory, /name: \{ contains: query, mode: "insensitive" \}/);
  assert.match(inventory, /aliases: \{ some: \{ alias: \{ contains: query, mode: "insensitive" \} \} \}/);
  assert.match(inventory, /variants: \{ some: \{ optionValue: \{ contains: query, mode: "insensitive" \} \} \}/);
  assert.match(inventory, /skus: \{ some: \{ code: \{ contains: query, mode: "insensitive" \} \} \}/);
  assert.match(inventory, /optionValues: \{ some: \{ variant: \{ optionValue: \{ contains: query, mode: "insensitive" \} \} \} \}/);
});

test("walk-in sale records require cash received server-side and persist tendered cash", () => {
  const schemas = source("src/domain/walk-in-sale-schemas.ts");
  const service = source("src/services/walk-in-sale.service.ts");

  assert.match(schemas, /collectionChannel: z\.literal\("COMMISSARY"\),\s*cashReceived: z\.coerce\.number\(\)\.nonnegative\(\)\.max\(10_000_000\)\.multipleOf\(0\.01\)/);
  assert.doesNotMatch(schemas, /cashReceived:[^\n]*optional\(\)/);
  assert.match(service, /INVALID_CASH_RECEIVED/);
  assert.match(service, /cashReceived < totalAmount/);
  assert.match(service, /cashTendered: cashReceived === null \? null : new Prisma\.Decimal\(cashReceived\)/);
  assert.match(service, /changeDue: changeDue === null \? null : new Prisma\.Decimal\(changeDue\)/);
});

test("walk-in request schema keeps Commissary cash and Treasury OR details mutually exclusive", async () => {
  const { parseRecordWalkInSale } = await import("../domain/walk-in-sale-schemas.js");
  const base = {
    items: [{ productId: "00000000-0000-4000-8000-000000000001", quantity: 1 }],
    buyerName: "Walk-in Buyer",
    clientSaleId: "sale-key-0001"
  };

  const legacy = parseRecordWalkInSale({ ...base, cashReceived: 100 });
  assert.equal(legacy.collectionChannel, "COMMISSARY");

  const treasury = parseRecordWalkInSale({
    ...base,
    collectionChannel: "TREASURER",
    officialReceiptNumber: " or-0012 ",
    treasuryReceiptInspected: true
  });
  assert.equal(treasury.collectionChannel, "TREASURER");

  assert.throws(() => parseRecordWalkInSale({ ...base, collectionChannel: "COMMISSARY" }));
  assert.throws(() => parseRecordWalkInSale({ ...base, cashReceived: 100, officialReceiptNumber: "OR-1" }));
  assert.throws(() => parseRecordWalkInSale({
    ...base,
    collectionChannel: "TREASURER",
    officialReceiptNumber: "OR-1",
    treasuryReceiptInspected: true,
    cashReceived: 100
  }));
  assert.throws(() => parseRecordWalkInSale({
    ...base,
    collectionChannel: "TREASURER",
    officialReceiptNumber: "OR-1",
    treasuryReceiptInspected: false
  }));
  assert.throws(() => parseRecordWalkInSale({
    ...base,
    collectionChannel: "TREASURER",
    officialReceiptNumber: "   ",
    treasuryReceiptInspected: true
  }));
});

test("Treasury OR numbers normalize the same way in TypeScript and PostgreSQL", async () => {
  const { cleanTreasuryOrNumber, normalizeTreasuryOrNumber, isTreasuryOrUniqueViolationTarget } = await import("../domain/treasury-official-receipt.js");
  const migration = source("prisma/migrations/20261006000000_add_walk_in_treasury_collection/migration.sql");

  assert.equal(normalizeTreasuryOrNumber(" or-0012 345 "), "OR0012345");
  assert.equal(normalizeTreasuryOrNumber("OR\t0012-345"), "OR0012345");
  assert.equal(normalizeTreasuryOrNumber(" - "), null);
  assert.equal(cleanTreasuryOrNumber("  or-0012   345 "), "OR-0012 345");
  assert.equal(cleanTreasuryOrNumber(""), null);
  assert.equal(isTreasuryOrUniqueViolationTarget(["normalized_official_receipt_number"]), true);
  assert.equal(isTreasuryOrUniqueViolationTarget("treasury_official_receipts_official_receipt_number_pkey"), true);
  assert.equal(isTreasuryOrUniqueViolationTarget(["client_sale_id"]), false);
  assert.match(migration, /UPPER\(REGEXP_REPLACE\(COALESCE\(value, ''\), '\[\[:space:\]-\]\+', '', 'g'\)\)/);
});

test("Treasury walk-in sales require an inspected OR, never record cash, and register the OR across channels", () => {
  const service = source("src/services/walk-in-sale.service.ts");
  const migration = source("prisma/migrations/20261006000000_add_walk_in_treasury_collection/migration.sql");
  const schema = source("prisma/schema.prisma");

  assert.match(service, /TREASURER_OR_REQUIRED/);
  assert.match(service, /TREASURER_OR_NOT_INSPECTED/);
  assert.match(service, /TREASURER_CASH_NOT_ALLOWED/);
  assert.match(service, /COMMISSARY_OR_NOT_ALLOWED/);
  assert.match(service, /TREASURER_OR_DUPLICATE/);
  assert.match(service, /tx\.treasuryOfficialReceipt\.findUnique/);
  assert.match(service, /treasuryVerifiedById: collection\.officialReceiptNumber \? input\.performedById : null/);
  // The OR check runs before any product row is locked or stock is deducted.
  assert.ok(service.indexOf("tx.treasuryOfficialReceipt.findUnique") < service.indexOf("lockProductForUpdate(tx, productId)"));
  assert.match(service, /collectionChannel,\s*officialReceiptNumber: normalizeTreasuryOrNumber\(input\.officialReceiptNumber\)/);
  assert.match(service, /treasuryReconciliationRequired: collectionChannel === "TREASURER" && row\.status === "VOIDED"/);
  assert.match(service, /publicVerificationUrl: publicVerificationUrl\(row\.publicVerificationTokenEncrypted\)/);

  assert.match(schema, /collectionChannel\s+CollectionChannel @default\(COMMISSARY\) @map\("collection_channel"\)/);
  assert.match(schema, /model TreasuryOfficialReceipt \{/);
  assert.match(migration, /walk_in_sales_collection_details_check/);
  assert.match(migration, /"collection_channel" = 'COMMISSARY'::"collection_channel"\s+AND "official_receipt_number" IS NULL/);
  assert.match(migration, /"collection_channel" = 'TREASURER'::"collection_channel"\s+AND NULLIF\(BTRIM\("official_receipt_number"\), ''\) IS NOT NULL/);
  assert.match(migration, /AND "cash_tendered" IS NULL\s+AND "change_due" IS NULL/);
  assert.match(migration, /AFTER INSERT OR UPDATE OF "official_receipt_number", "collection_channel" ON "payments"/);
  assert.match(migration, /AFTER INSERT OR UPDATE OF "official_receipt_number", "collection_channel" ON "walk_in_sales"/);
  assert.match(migration, /INSERT INTO "treasury_official_receipts"[\s\S]*FROM "payments" payment/);
});

test("reports and the sales ledger use each walk-in sale's own collection channel", () => {
  const report = source("src/services/report.service.ts");
  const ledger = source("src/services/sales-ledger.service.ts");

  assert.doesNotMatch(report, /'COMMISSARY'::text = \$\{options\.collectionChannel/);
  assert.match(report, /walk_sale\.collection_channel::text = \$\{options\.collectionChannel/);
  assert.match(report, /AS "walkInChannelGroups"/);
  assert.match(report, /AS "walkInTreasuryRows"/);
  assert.match(report, /cashChannelGroups: \[\.\.\.payload\.cashChannelGroups, \.\.\.payload\.walkInChannelGroups\]/);
  assert.match(report, /mergeChannelGroups\(payload\.collectionGroups, payload\.walkInChannelGroups\)/);
  assert.match(ledger, /receipt\.walkInSale\?\.collectionChannel \?\? "COMMISSARY"/);
  assert.doesNotMatch(ledger, /collectionLocation !== "TREASURER"/);
});

test("walk-in sale creation is idempotent per client sale key and cashier", () => {
  const routes = source("src/domain/walk-in-sale-schemas.ts");
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
  assert.match(service, /if \(!result\.replayed\) \{\s*if \(mappedReceipt\.studentId\) \{\s*await createNotificationBestEffort/);
});

test("walk-in buyers may use a typed name without a WESCOMM student account", () => {
  const routes = source("src/domain/walk-in-sale-schemas.ts");
  const service = source("src/services/walk-in-sale.service.ts");
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/20261004000000_allow_guest_walk_in_buyers/migration.sql");

  assert.match(routes, /buyerName: z\.string\(\)\.trim\(\)\.min\(2\)\.max\(120\)/);
  assert.match(routes, /studentId: z\.string\(\)\.uuid\(\)\.nullish\(\)/);
  assert.match(service, /buyerNameSnapshot: buyerName/);
  assert.match(service, /if \(mappedReceipt\.studentId\)/);
  assert.match(schema, /studentId\s+String\?\s+@map\("student_id"\)/);
  assert.match(schema, /buyerNameSnapshot\s+String\s+@map\("buyer_name_snapshot"\)/);
  assert.match(migration, /ALTER COLUMN "student_id" DROP NOT NULL/);
  assert.match(migration, /ADD COLUMN "buyer_name_snapshot" TEXT/);
  assert.match(migration, /receipts_reservation_requires_student_check/);
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
  assert.match(schema, /cashTendered\s+Decimal\?\s+@map\("cash_tendered"\)/);
  assert.match(schema, /voidReason\s+String\?\s+@map\("void_reason"\)/);
  assert.match(schema, /model WalkInSaleCostAllocation \{/);
  assert.match(migration, /CREATE TABLE "walk_in_sales"/);
  assert.match(migration, /"client_sale_id" VARCHAR\(64\) NOT NULL/);
  assert.match(migration, /"request_fingerprint" CHAR\(64\) NOT NULL/);
  assert.match(migration, /CREATE TABLE "walk_in_sale_cost_allocations"/);
  assert.match(migration, /REFERENCES "inventory_batches"\("id"\) ON DELETE RESTRICT/);
  assert.match(migration, /walk_in_sale_cost_allocations" ENABLE ROW LEVEL SECURITY/);
});
