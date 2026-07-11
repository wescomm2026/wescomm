import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateNoShowPolicy,
  getNoShowEligibleAt,
  getRestrictionEndDate,
  isNoShowEligible
} from "../domain/reservation-policy.js";
import {
  hashReservationRequest,
  reservationIdempotencyExpiry
} from "../utils/reservation-idempotency.js";

const pickupEnd = new Date("2026-07-10T02:00:00.000Z");

test("no-show review stays locked until the complete 24-hour grace period passes", () => {
  const eligibleAt = getNoShowEligibleAt(pickupEnd);
  assert.equal(eligibleAt.toISOString(), "2026-07-11T02:00:00.000Z");
  assert.equal(isNoShowEligible(pickupEnd, new Date("2026-07-11T01:59:59.999Z")), false);
  assert.equal(isNoShowEligible(pickupEnd, eligibleAt), true);
});

test("first and second consecutive no-shows remain warnings", () => {
  assert.deepEqual(
    evaluateNoShowPolicy({ consecutiveOffenses: 1, highestPreviousRestrictionLevel: 0, hasActiveRestriction: false }),
    { kind: "WARNING", warningNumber: 1 }
  );
  assert.deepEqual(
    evaluateNoShowPolicy({ consecutiveOffenses: 2, highestPreviousRestrictionLevel: 0, hasActiveRestriction: false }),
    { kind: "WARNING", warningNumber: 2 }
  );
});

test("third no-show starts level one and later incidents escalate without exceeding level three", () => {
  assert.deepEqual(
    evaluateNoShowPolicy({ consecutiveOffenses: 3, highestPreviousRestrictionLevel: 0, hasActiveRestriction: false }),
    { kind: "CREATE_RESTRICTION", level: 1 }
  );
  assert.deepEqual(
    evaluateNoShowPolicy({ consecutiveOffenses: 4, highestPreviousRestrictionLevel: 1, hasActiveRestriction: false }),
    { kind: "CREATE_RESTRICTION", level: 2 }
  );
  assert.deepEqual(
    evaluateNoShowPolicy({ consecutiveOffenses: 5, highestPreviousRestrictionLevel: 2, hasActiveRestriction: false }),
    { kind: "CREATE_RESTRICTION", level: 3 }
  );
  assert.deepEqual(
    evaluateNoShowPolicy({ consecutiveOffenses: 6, highestPreviousRestrictionLevel: 3, hasActiveRestriction: false }),
    { kind: "CREATE_RESTRICTION", level: 3 }
  );
});

test("an existing active restriction prevents overlapping suspensions", () => {
  assert.deepEqual(
    evaluateNoShowPolicy({ consecutiveOffenses: 4, highestPreviousRestrictionLevel: 1, hasActiveRestriction: true }),
    { kind: "KEEP_ACTIVE_RESTRICTION" }
  );
});

test("restriction levels produce 7-day, 30-day, and admin-review windows", () => {
  const startsAt = new Date("2026-07-10T00:00:00.000Z");
  assert.equal(getRestrictionEndDate(1, startsAt)?.toISOString(), "2026-07-17T00:00:00.000Z");
  assert.equal(getRestrictionEndDate(2, startsAt)?.toISOString(), "2026-08-09T00:00:00.000Z");
  assert.equal(getRestrictionEndDate(3, startsAt), null);
});

test("invalid consecutive offense counts are rejected", () => {
  assert.throws(
    () => evaluateNoShowPolicy({ consecutiveOffenses: 0, highestPreviousRestrictionLevel: 0, hasActiveRestriction: false }),
    RangeError
  );
});

test("equivalent checkout payloads have the same hash even when item order changes", () => {
  const first = hashReservationRequest({
    paymentMethod: "PAY_AT_COMMISSARY",
    pickupStart: new Date("2026-07-12T02:00:00.000Z"),
    pickupEnd: new Date("2026-07-12T04:00:00.000Z"),
    items: [
      { productId: "11111111-1111-4111-8111-111111111111", variantSummary: "Size: Medium", quantity: 1 },
      { productId: "22222222-2222-4222-8222-222222222222", quantity: 2 }
    ]
  });
  const reordered = hashReservationRequest({
    paymentMethod: "PAY_AT_COMMISSARY",
    pickupStart: new Date("2026-07-12T02:00:00.000Z"),
    pickupEnd: new Date("2026-07-12T04:00:00.000Z"),
    items: [
      { productId: "22222222-2222-4222-8222-222222222222", quantity: 2 },
      { productId: "11111111-1111-4111-8111-111111111111", variantSummary: "Size: Medium", quantity: 1 }
    ]
  });

  assert.equal(first, reordered);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("changing quantity, pickup schedule, or item details changes the request hash", () => {
  const base = {
    paymentMethod: "PAY_AT_COMMISSARY",
    pickupStart: new Date("2026-07-12T02:00:00.000Z"),
    pickupEnd: new Date("2026-07-12T04:00:00.000Z"),
    items: [{ productId: "11111111-1111-4111-8111-111111111111", variantSummary: "Size: Medium", quantity: 1 }]
  };
  const original = hashReservationRequest(base);

  assert.notEqual(original, hashReservationRequest({ ...base, items: [{ ...base.items[0], quantity: 2 }] }));
  assert.notEqual(original, hashReservationRequest({ ...base, pickupEnd: new Date("2026-07-12T05:00:00.000Z") }));
  assert.notEqual(original, hashReservationRequest({ ...base, items: [{ ...base.items[0], variantSummary: "Size: Large" }] }));
});

test("checkout idempotency records use a 24-hour retention window", () => {
  const now = new Date("2026-07-10T00:00:00.000Z");
  assert.equal(reservationIdempotencyExpiry(now).toISOString(), "2026-07-11T00:00:00.000Z");
});
