import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bulkConfirmationBlockReason, bulkConfirmationPreviewToken } from "../domain/reservation-bulk-confirmation.js";

test("bulk confirmation accepts only eligible pending reservations", () => {
  assert.equal(bulkConfirmationBlockReason({ status: "PENDING", pickupReviewStatus: "NONE", paymentMethod: "PAY_AT_COMMISSARY" }), null);
  assert.equal(bulkConfirmationBlockReason({ status: "CONFIRMED", pickupReviewStatus: "NONE", paymentMethod: "PAY_AT_COMMISSARY" }), "NOT_PENDING");
  assert.equal(bulkConfirmationBlockReason({ status: "PENDING", pickupReviewStatus: "NEEDS_REVIEW", paymentMethod: "PAY_AT_COMMISSARY" }), "SCHEDULE_REVIEW_REQUIRED");
  assert.equal(bulkConfirmationBlockReason({ status: "PENDING", pickupReviewStatus: "NONE", paymentMethod: "PAYMONGO_GCASH", paymentStatus: "AWAITING_PAYMENT" }), "ONLINE_PAYMENT_NOT_PAID");
  assert.equal(bulkConfirmationBlockReason({ status: "PENDING", pickupReviewStatus: "NONE", paymentMethod: "PAYMONGO_GCASH", paymentStatus: "PAID" }), null);
});

test("bulk confirmation preview tokens bind the oldest-first execution order and scope", () => {
  assert.notEqual(bulkConfirmationPreviewToken(["b", "a"]), bulkConfirmationPreviewToken(["a", "b"]));
  assert.notEqual(bulkConfirmationPreviewToken(["a", "b"]), bulkConfirmationPreviewToken(["a", "c"]));
});

test("filtered bulk previews select from eligible rows so permanent blockers cannot starve the queue", () => {
  const source = readFileSync(path.resolve(process.cwd(), "src/services/reservation.service.ts"), "utf8");
  assert.match(source, /where: selectedMode \? baseWhere : eligibleWhere/);
  assert.match(source, /take: selectedMode \? MAX_BULK_CONFIRMATIONS : MAX_BULK_CONFIRMATIONS \+ 1/);
});

test("student queue positions are schedule-scoped, eligibility-aware, and oldest-first", () => {
  const source = readFileSync(path.resolve(process.cwd(), "src/services/reservation.service.ts"), "utf8");
  assert.match(source, /reservationIds\.map\(\(reservationId\) => Prisma\.sql`\$\{reservationId\}::uuid`\)/);
  assert.match(source, /queued\.pickup_start = target\.pickup_start/);
  assert.match(source, /queued\.pickup_time_slot_id IS NOT DISTINCT FROM target\.pickup_time_slot_id/);
  assert.match(source, /queued\.pickup_review_status <> 'NEEDS_REVIEW'/);
  assert.match(source, /\(queued\.created_at, queued\.id\) <= \(target\.created_at, target\.id\)/);
});
