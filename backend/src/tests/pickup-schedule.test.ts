import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../utils/http-error.js";
import { pickupInstant, scheduleReviewReason, validatePickupSelection, type PickupPolicySnapshot } from "../domain/pickup-schedule.js";
import { findAutomaticPickupDestination, serializePublicPolicy } from "../services/pickup-policy.service.js";
import { pickupCapacitySnapshot, pickupWindowKey } from "../services/pickup-capacity.service.js";

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

test("policy impact review identifies incompatible existing schedules", () => {
  const originalStart = new Date("2026-09-01T00:00:00.000Z");
  const originalEnd = new Date("2026-09-01T02:00:00.000Z");
  assert.equal(scheduleReviewReason({ policy, pickupStart: originalStart, pickupEnd: originalEnd, now }), "Pickup date is closed: University holiday");
  assert.equal(originalStart.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(originalEnd.toISOString(), "2026-09-01T02:00:00.000Z");
});

test("closure auto-rescheduling preserves the time window and skips unavailable days", () => {
  const nextDay = findAutomaticPickupDestination(policy, {
    pickupStart: new Date("2026-09-01T00:00:00.000Z"),
    pickupEnd: new Date("2026-09-01T02:00:00.000Z")
  }, now);
  assert.equal(nextDay?.pickupStart.toISOString(), "2026-09-02T00:00:00.000Z");
  assert.equal(nextDay?.pickupEnd.toISOString(), "2026-09-02T02:00:00.000Z");
  assert.equal(nextDay?.slot.id, "slot-morning");

  const fridayClosedPolicy = {
    ...policy,
    closures: [{ date: new Date("2026-09-04T00:00:00.000Z"), reason: "Campus closure" }]
  };
  const afterWeekend = findAutomaticPickupDestination(fridayClosedPolicy, {
    pickupStart: new Date("2026-09-04T00:00:00.000Z"),
    pickupEnd: new Date("2026-09-04T02:00:00.000Z")
  }, now);
  assert.equal(afterWeekend?.pickupStart.toISOString(), "2026-09-07T00:00:00.000Z");
});

test("closure auto-rescheduling returns no destination outside the booking window", () => {
  const narrowPolicy = { ...policy, maxAdvanceDays: 3 };
  const destination = findAutomaticPickupDestination(narrowPolicy, {
    pickupStart: new Date("2026-08-31T00:00:00.000Z"),
    pickupEnd: new Date("2026-08-31T02:00:00.000Z")
  }, now);
  assert.equal(destination, null);
});

test("closure auto-rescheduling skips a full matching time on the next open date", () => {
  const capacityPolicy: PickupPolicySnapshot = {
    ...policy,
    timeSlots: policy.timeSlots.map((slot) => ({ ...slot, capacity: 1 }))
  };
  const fullStart = pickupInstant("2026-09-02", 480);
  const fullEnd = pickupInstant("2026-09-02", 600);
  const destination = findAutomaticPickupDestination(capacityPolicy, {
    pickupStart: new Date("2026-09-01T00:00:00.000Z"),
    pickupEnd: new Date("2026-09-01T02:00:00.000Z")
  }, now, new Map([[pickupWindowKey(fullStart, fullEnd), 1]]));

  assert.equal(destination?.pickupStart.toISOString(), "2026-09-03T00:00:00.000Z");
  assert.equal(destination?.slot.id, "slot-morning");
});

test("capacity snapshots preserve unlimited slots and clamp full-slot remaining counts", () => {
  assert.deepEqual(pickupCapacitySnapshot(null, 12), {
    capacity: null,
    booked: 12,
    remaining: null,
    isFull: false
  });
  assert.deepEqual(pickupCapacitySnapshot(2, 3), {
    capacity: 2,
    booked: 3,
    remaining: 0,
    isFull: true
  });
});

test("public pickup availability excludes staff metadata and inactive windows", () => {
  const serialized = serializePublicPolicy({
    id: "00000000-0000-4000-8000-000000000001",
    version: 4,
    timezone: "Asia/Manila",
    minAdvanceDays: 1,
    maxAdvanceDays: 30,
    effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
    isActive: true,
    reason: "Internal schedule change note",
    createdById: "00000000-0000-4000-8000-000000000002",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    createdBy: {
      id: "00000000-0000-4000-8000-000000000002",
      fullName: "Private Staff Name",
      email: "private.staff@wesleyan.edu.ph"
    },
    days: policy.days,
    timeSlots: [
      { id: "active", label: "Morning", startMinute: 480, endMinute: 600, isActive: true, sortOrder: 0, capacity: 20 },
      { id: "inactive", label: "Internal retired slot", startMinute: 600, endMinute: 720, isActive: false, sortOrder: 1, capacity: null }
    ],
    closures: [{ id: "closure", date: new Date("2026-09-01T00:00:00.000Z"), reason: "University holiday" }]
  }, now);

  assert.equal("createdBy" in serialized, false);
  assert.equal("createdById" in serialized, false);
  assert.equal("reason" in serialized, false);
  assert.equal("createdAt" in serialized, false);
  assert.deepEqual(serialized.timeSlots.map((slot) => slot.id), ["active"]);
  assert.equal(serialized.timeSlots[0].capacity, 20);
});
