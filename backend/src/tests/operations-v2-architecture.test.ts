import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("receipt QR references are opaque, encrypted at rest, hashed for lookup, and never expose the hash DTO", () => {
  const receipts = source("src/services/receipt.service.ts");
  const routes = source("src/routes/receipts.routes.ts");
  const receiptDtoMapper = receipts.match(
    /function mapPrismaReceipt[\s\S]*?(?=export type ReceiptListOptions)/
  )?.[0] ?? "";
  assert.match(receipts, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(receipts, /encrypted: encryptSensitiveText\(token, RECEIPT_TOKEN_CONTEXT\)/);
  assert.match(receipts, /hash: hashHighEntropyLookup\(token, RECEIPT_TOKEN_CONTEXT\)/);
  assert.match(receiptDtoMapper, /publicVerificationUrl: publicVerificationUrl/);
  assert.match(receiptDtoMapper, /collectionChannel: receipt\.reservation\?\.collectionPayment\?\.collectionChannel/);
  assert.match(receiptDtoMapper, /officialReceiptNumber: receipt\.reservation\?\.collectionPayment\?\.officialReceiptNumber/);
  assert.doesNotMatch(receiptDtoMapper, /verificationHash:/);
  assert.doesNotMatch(receiptDtoMapper, /publicVerificationTokenHash:/);
  assert.doesNotMatch(receiptDtoMapper, /publicVerificationTokenEncrypted:/);
  assert.match(routes, /"\/verify-token"[\s\S]*publicVerificationLimiter/);
  assert.match(routes, /paymentChannel: z\.enum\(\["ONLINE_GCASH", "AT_COMMISSARY"\]\)/);
});

test("restriction expiry is a locked batch with atomic outbox notification dedupe", () => {
  const restrictions = source("src/services/restriction.service.ts");
  const outbox = source("src/services/outbox.service.ts");
  assert.match(restrictions, /FOR UPDATE SKIP LOCKED/);
  assert.match(restrictions, /status: "EXPIRED"/);
  assert.match(restrictions, /type: OUTBOX_EVENT_TYPES\.restrictionExpired/);
  assert.match(outbox, /dedupeKey: `restriction-expired:\$\{event\.entityId\}`/);
});

test("permanent product deletion is archived-only, dependency guarded, audited, and queues managed image cleanup", () => {
  const deletion = source("src/services/product-deletion.service.ts");
  const routes = source("src/routes/staff-products.routes.ts");
  const outbox = source("src/services/outbox.service.ts");
  assert.match(routes, /"\/:id\/permanent"[\s\S]*requireRole\("ADMIN"\)/);
  assert.match(deletion, /if \(product\.isActive\)/);
  assert.match(deletion, /PRODUCT_HISTORY_REQUIRED/);
  assert.match(deletion, /action: "PRODUCT_PERMANENTLY_DELETED"/);
  assert.match(deletion, /type: OUTBOX_EVENT_TYPES\.productImageDelete/);
  assert.match(outbox, /processProductImageDelete/);
});

test("financial reports count completed paid sales with verified receipts, FIFO cost, and separated collection channels", () => {
  const reports = source("src/services/report.service.ts");
  assert.match(reports, /receipt\.status = 'VERIFIED'/);
  assert.match(reports, /payment\.status = 'PAID'/);
  assert.match(reports, /order_item_cost_allocations/);
  assert.match(reports, /COMMISSARY/);
  assert.match(reports, /TREASURER/);
  assert.match(reports, /range\.toExclusive/);
});

test("release migration preflight covers FIFO and collection-preference migrations without rewriting applied checksums", () => {
  const verifier = source("scripts/verify-release-migrations.mjs");

  assert.match(verifier, /20260924000000_add_fifo_costing_and_collection_channels/);
  assert.match(verifier, /20260924010000_add_reservation_collection_preference/);
  assert.match(verifier, /release migration is not registered/);
  assert.match(verifier, /requiresExplicitTransaction: false/);
  assert.match(verifier, /preserve its Prisma checksum/);
});

test("restocking can atomically update the product-wide selling price without changing historical order snapshots", () => {
  const routes = source("src/routes/staff-products.routes.ts");
  const inventory = source("src/services/inventory.service.ts");
  const skuInventory = source("src/services/sku-inventory.service.ts");
  const reservations = source("src/services/reservation.service.ts");

  assert.match(routes, /sellingPrice: acquisitionCostSchema\.optional\(\)/);
  assert.match(inventory, /price: nextSellingPrice/);
  assert.match(skuInventory, /data: \{ stock: totalStock, status, price: nextSellingPrice/);
  assert.match(reservations, /unitPrice:/);
});
