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

test("revenue reports count verified receipts only and apply the selected range to trends and categories", () => {
  const reports = source("src/services/report.service.ts");
  assert.match(reports, /WHERE status = 'VERIFIED'/);
  assert.match(reports, /COALESCE\(verified_at, issued_at\)/);
  assert.match(reports, /ONLINE_GCASH/);
  assert.match(reports, /AT_COMMISSARY/);
  assert.match(reports, /range\.toExclusive/);
});
