import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../utils/http-error.js";
import { pickupInstant, scheduleReviewReason, validatePickupSelection, type PickupPolicySnapshot } from "../domain/pickup-schedule.js";

const policy: PickupPolicySnapshot = {
  version: 4,
  minAdvanceDays: 1,
  maxAdvanceDays: 30,
  days: Array.from({ length: 7 }, (_, weekday) => ({ weekday, enabled: weekday >= 1 && weekday <= 5 })),
  timeSlots: [{ id: "slot-morning", label: "8:00 AM - 10:00 AM", startMinute: 480, endMinute: 600, isActive: true }],
  closures: [{ date: new Date("2026-09-01T00:00:00.000Z"), reason: "University holiday" }]
};
const now = new Date("2026-08-28T04:00:00.000Z"); // Friday noon in Manila.

function errorCode(operation: () => unknown) {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    return true;
  });
  try { operation(); } catch (error) { return (error as HttpError).code; }
  return undefined;
}

test("pickup selection derives exact Manila instants from the active immutable policy", () => {
  const selected = validatePickupSelection({ policy, policyVersion: 4, pickupDate: "2026-08-31", slotId: "slot-morning", now });
  assert.equal(selected.pickupStart.toISOString(), "2026-08-31T00:00:00.000Z");
  assert.equal(selected.pickupEnd.toISOString(), "2026-08-31T02:00:00.000Z");
  assert.equal(pickupInstant("2026-08-31", 780).toISOString(), "2026-08-31T05:00:00.000Z");
});

test("pickup validation rejects weekends, closures, stale versions, and inactive slots", () => {
  assert.equal(errorCode(() => validatePickupSelection({ policy, policyVersion: 4, pickupDate: "2026-08-29", slotId: "slot-morning", now })), "PICKUP_DAY_UNAVAILABLE");
  assert.equal(errorCode(() => validatePickupSelection({ policy, policyVersion: 4, pickupDate: "2026-09-01", slotId: "slot-morning", now })), "PICKUP_DATE_CLOSED");
  assert.equal(errorCode(() => validatePickupSelection({ policy, policyVersion: 3, pickupDate: "2026-08-31", slotId: "slot-morning", now })), "PICKUP_POLICY_CHANGED");
  assert.equal(errorCode(() => validatePickupSelection({ policy, policyVersion: 4, pickupDate: "2026-08-31", slotId: "missing", now })), "PICKUP_SLOT_UNAVAILABLE");
});

test("policy impact review flags incompatible existing schedules without rewriting them", () => {
  const originalStart = new Date("2026-09-01T00:00:00.000Z");
  const originalEnd = new Date("2026-09-01T02:00:00.000Z");
  assert.equal(scheduleReviewReason({ policy, pickupStart: originalStart, pickupEnd: originalEnd, now }), "Pickup date is closed: University holiday");
  assert.equal(originalStart.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(originalEnd.toISOString(), "2026-09-01T02:00:00.000Z");
});
