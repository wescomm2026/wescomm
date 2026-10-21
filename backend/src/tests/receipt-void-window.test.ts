import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertReceiptVoidAllowed,
  isWithinReceiptVoidWindow,
  receiptVoidDeadline,
  receiptVoidableUntil
} from "../domain/receipt-void-window.js";
import { HttpError } from "../utils/http-error.js";

test("the void window closes at the end of the second day after the sale, Manila time", () => {
  // Oct 7, 2026 10:15 AM Manila = 02:15 UTC.
  const soldAt = new Date("2026-10-07T02:15:00.000Z");
  assert.equal(receiptVoidDeadline(soldAt).toISOString(), "2026-10-09T16:00:00.000Z"); // Oct 10 00:00 Manila
  assert.equal(receiptVoidableUntil(soldAt).toISOString(), "2026-10-09T15:59:00.000Z"); // Oct 9 11:59 PM Manila
  assert.equal(isWithinReceiptVoidWindow(soldAt, new Date("2026-10-09T15:59:59.000Z")), true);
  assert.equal(isWithinReceiptVoidWindow(soldAt, new Date("2026-10-09T16:00:00.000Z")), false);

  // A sale at 11:30 PM Manila on Oct 7 (15:30 UTC) still belongs to Oct 7.
  assert.equal(receiptVoidDeadline(new Date("2026-10-07T15:30:00.000Z")).toISOString(), "2026-10-09T16:00:00.000Z");
  // A sale at 12:30 AM Manila on Oct 8 (Oct 7 16:30 UTC) belongs to Oct 8.
  assert.equal(receiptVoidDeadline(new Date("2026-10-07T16:30:00.000Z")).toISOString(), "2026-10-10T16:00:00.000Z");
});

test("staff are refused after the window; admins may still void", () => {
  const soldAt = new Date("2026-10-01T02:00:00.000Z");
  const now = new Date("2026-10-07T02:00:00.000Z");
  assert.throws(
    () => assertReceiptVoidAllowed({ actorRole: "STAFF", soldAt, now }),
    (error: unknown) => error instanceof HttpError && error.status === 403 && error.code === "RECEIPT_VOID_WINDOW_CLOSED"
  );
  assert.doesNotThrow(() => assertReceiptVoidAllowed({ actorRole: "ADMIN", soldAt, now }));
  assert.doesNotThrow(() => assertReceiptVoidAllowed({ actorRole: "STAFF", soldAt: now, now }));
});

test("every void path enforces the window and restores stock", () => {
  const receiptService = readFileSync(path.resolve(process.cwd(), "src/services/receipt.service.ts"), "utf8");
  const walkInService = readFileSync(path.resolve(process.cwd(), "src/services/walk-in-sale.service.ts"), "utf8");
  const receiptsRoutes = readFileSync(path.resolve(process.cwd(), "src/routes/receipts.routes.ts"), "utf8");
  assert.match(receiptService, /assertReceiptVoidAllowed\(\{ actorRole: input\.actorRole, soldAt: current\.issuedAt \}\)/);
  assert.match(receiptService, /returnCompletedReservationStockInTransaction\(tx,/);
  assert.match(walkInService, /assertReceiptVoidAllowed\(\{ actorRole: input\.actorRole, soldAt: receipt\.issuedAt \}\)/);
  assert.match(receiptsRoutes, /isWalkInReceipt\(receiptId\)[\s\S]*voidWalkInSale\(/);
});
