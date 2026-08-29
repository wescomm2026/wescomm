import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("reservation receipts are unique and guarded by a duplicate-data migration preflight", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/20260830000000_enforce_reservation_receipt_integrity/migration.sql");
  const receiptModel = schema.match(/model Receipt \{([\s\S]*?)\n\}/)?.[1];

  assert.ok(receiptModel, "Receipt model was not found in prisma/schema.prisma");
  assert.match(receiptModel, /reservationId\s+String\?\s+@unique\s+@map\("reservation_id"\)/);
  assert.doesNotMatch(receiptModel, /@@index\(\[reservationId\]\)/);
  assert.match(migration, /HAVING COUNT\(\*\) > 1/);
  assert.match(migration, /reservation\.status <> 'COMPLETED'/);
  assert.match(migration, /receipt\.student_id <> reservation\.student_id/);
  assert.match(migration, /receipt\.total_amount IS DISTINCT FROM reservation\.total_amount/);
  assert.match(migration, /receipt\.payment_method IS DISTINCT FROM reservation\.payment_method/);
  assert.match(migration, /CREATE UNIQUE INDEX "receipts_reservation_id_key"/);
});

test("completion creates or repairs its receipt inside the serializable reservation transaction", () => {
  const reservations = source("src/services/reservation.service.ts");
  const receipts = source("src/services/receipt.service.ts");
  const outbox = source("src/services/outbox.service.ts");

  assert.match(reservations, /prisma\.\$transaction\([\s\S]*ensureReceiptForCompletedReservationInTransaction\(tx/);
  assert.doesNotMatch(reservations, /createReceiptForReservation/);
  assert.match(receipts, /tx\.receipt\.upsert\([\s\S]*where: \{ reservationId: input\.reservation\.id \}/);
  assert.match(receipts, /type: OUTBOX_EVENT_TYPES\.receiptCreated/);
  assert.match(outbox, /receiptCreated: "RECEIPT_CREATED"/);
  assert.match(outbox, /processReceiptCreated/);
});

test("the unsafe generic manual receipt endpoint and client-owned receipt fields are removed", () => {
  const route = source("src/routes/receipts.routes.ts");
  const service = source("src/services/receipt.service.ts");

  assert.doesNotMatch(route, /createReceiptSchema|receiptsRoutes\.post\(\s*"\/"/);
  assert.doesNotMatch(service, /export async function createReceipt\(/);
  assert.doesNotMatch(service, /\.from\("receipts"\)[\s\S]{0,300}\.insert\(/);
});
