import assert from "node:assert/strict";
import test from "node:test";
import { manilaMonthStart, summarizeReceiptCounts, summarizeReservationCounts } from "../domain/student-overview.js";

test("manila month start uses Philippine time, not UTC", () => {
  // 2026-10-31T17:00Z is already November 1 in Manila.
  assert.equal(manilaMonthStart(new Date("2026-10-31T17:00:00.000Z")).toISOString(), "2026-10-31T16:00:00.000Z");
  assert.equal(manilaMonthStart(new Date("2026-10-15T03:00:00.000Z")).toISOString(), "2026-09-30T16:00:00.000Z");
});

test("reservation counts fill missing statuses and total active work", () => {
  const counts = summarizeReservationCounts([
    { status: "PENDING", _count: { _all: 2 } },
    { status: "READY_FOR_PICKUP", _count: { _all: 1 } },
    { status: "COMPLETED", _count: { _all: 5 } }
  ]);
  assert.equal(counts.CONFIRMED, 0);
  assert.equal(counts.NO_SHOW, 0);
  assert.equal(counts.active, 3);
  assert.equal(counts.total, 8);
});

test("receipt counts include every status", () => {
  const counts = summarizeReceiptCounts([{ status: "VERIFIED", _count: { _all: 4 } }]);
  assert.deepEqual(counts, { PENDING: 0, VERIFIED: 4, VOIDED: 0, total: 4 });
});
