import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGcashAmountCentavos,
  assertOnlinePaymentTransition,
  assertPaymentAllowsReservationTransition,
  canSafelyRecoverPaymongoCreate,
  createProviderIdempotencyKey,
  GCASH_MAX_AMOUNT_CENTAVOS,
  GCASH_MIN_AMOUNT_CENTAVOS,
  PAYMONGO_CREATE_RECOVERY_SAFETY_MARGIN_MS,
  PAYMONGO_CREATE_RECOVERY_WINDOW_MS,
  PAYMONGO_PROVIDER_IDEMPOTENCY_WINDOW_MS,
  paymentCanResume,
  paymentCanRetry,
  phpDecimalToCentavos
} from "../domain/online-payment.js";
import { HttpError } from "../utils/http-error.js";

function hasHttpError(status: number, code: string) {
  return (error: unknown) => (
    error instanceof HttpError && error.status === status && error.code === code
  );
}

test("PHP decimal amounts convert to centavos without floating-point arithmetic", () => {
  assert.equal(phpDecimalToCentavos("0"), 0);
  assert.equal(phpDecimalToCentavos("1"), 100);
  assert.equal(phpDecimalToCentavos("1.2"), 120);
  assert.equal(phpDecimalToCentavos("1.23"), 123);
  assert.equal(phpDecimalToCentavos(100_000), 10_000_000);
  assert.equal(phpDecimalToCentavos({ toString: () => "42.05" }), 4_205);
});

test("PHP decimal conversion rejects ambiguous, negative, and unsafe amounts", () => {
  for (const invalid of ["-1", "+1", "1.", ".50", "1.001", "1e2", "PHP 1.00", ""]) {
    assert.throws(() => phpDecimalToCentavos(invalid), RangeError, invalid);
  }

  assert.throws(() => phpDecimalToCentavos(Number.NaN), /finite decimal value/);
  assert.throws(() => phpDecimalToCentavos(Number.POSITIVE_INFINITY), /finite decimal value/);
  assert.throws(() => phpDecimalToCentavos("90071992547409.92"), /too large to process safely/);
});

test("GCash amount limits are enforced in integer centavos", () => {
  assert.doesNotThrow(() => assertGcashAmountCentavos(GCASH_MIN_AMOUNT_CENTAVOS));
  assert.doesNotThrow(() => assertGcashAmountCentavos(GCASH_MAX_AMOUNT_CENTAVOS));

  assert.throws(
    () => assertGcashAmountCentavos(GCASH_MIN_AMOUNT_CENTAVOS - 1),
    hasHttpError(400, "GCASH_AMOUNT_OUT_OF_RANGE")
  );
  assert.throws(
    () => assertGcashAmountCentavos(GCASH_MAX_AMOUNT_CENTAVOS + 1),
    hasHttpError(400, "GCASH_AMOUNT_OUT_OF_RANGE")
  );
  assert.throws(
    () => assertGcashAmountCentavos(100.5),
    hasHttpError(400, "INVALID_PAYMENT_AMOUNT")
  );
  assert.throws(
    () => assertGcashAmountCentavos(Number.MAX_SAFE_INTEGER + 1),
    hasHttpError(400, "INVALID_PAYMENT_AMOUNT")
  );
});

test("provider idempotency keys are stable, scoped, and do not expose identifiers", () => {
  const input = {
    studentId: "student-secret-id",
    reservationId: "reservation-secret-id",
    requestKey: "browser-request-key"
  };
  const first = createProviderIdempotencyKey(input);
  const second = createProviderIdempotencyKey(input);

  assert.equal(first, second);
  assert.match(first, /^wescomm-checkout-[0-9a-f]{64}$/);
  assert.equal(first.includes(input.studentId), false);
  assert.equal(first.includes(input.reservationId), false);
  assert.notEqual(first, createProviderIdempotencyKey({ ...input, requestKey: "different-request" }));
  assert.notEqual(first, createProviderIdempotencyKey({ ...input, reservationId: "different-reservation" }));
});

test("unknown checkout creation is recovered only inside the conservative 23-hour window", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  assert.equal(PAYMONGO_PROVIDER_IDEMPOTENCY_WINDOW_MS, 24 * 60 * 60 * 1000);
  assert.equal(PAYMONGO_CREATE_RECOVERY_SAFETY_MARGIN_MS, 60 * 60 * 1000);
  assert.equal(PAYMONGO_CREATE_RECOVERY_WINDOW_MS, 23 * 60 * 60 * 1000);
  assert.equal(
    canSafelyRecoverPaymongoCreate(new Date(now.getTime() - PAYMONGO_CREATE_RECOVERY_WINDOW_MS + 1), now),
    true
  );
  assert.equal(
    canSafelyRecoverPaymongoCreate(new Date(now.getTime() - PAYMONGO_CREATE_RECOVERY_WINDOW_MS), now),
    false
  );
  assert.equal(canSafelyRecoverPaymongoCreate(new Date(now.getTime() + 1), now), false);
});

test("online payment status transitions are monotonic and idempotent", () => {
  assert.doesNotThrow(() => assertOnlinePaymentTransition("INITIALIZING", "AWAITING_PAYMENT"));
  assert.doesNotThrow(() => assertOnlinePaymentTransition("AWAITING_PAYMENT", "PAID"));
  assert.doesNotThrow(() => assertOnlinePaymentTransition("CANCELLED", "REFUND_REVIEW_REQUIRED"));
  assert.doesNotThrow(() => assertOnlinePaymentTransition("PAID", "PAID"));
  assert.doesNotThrow(() => assertOnlinePaymentTransition("REFUND_REVIEW_REQUIRED", "PARTIALLY_REFUNDED"));
  assert.doesNotThrow(() => assertOnlinePaymentTransition("PARTIALLY_REFUNDED", "REFUNDED"));
  assert.doesNotThrow(() => assertOnlinePaymentTransition("EXPIRED", "AWAITING_PAYMENT"));
  assert.doesNotThrow(() => assertOnlinePaymentTransition("EXPIRED", "CANCELLED"));
  assert.doesNotThrow(() => assertOnlinePaymentTransition("REFUNDED", "REFUND_REVIEW_REQUIRED"));

  for (const [previous, next] of [
    ["PAID", "AWAITING_PAYMENT"],
    ["REFUNDED", "PAID"],
    ["CANCELLED", "INITIALIZING"]
  ] as const) {
    assert.throws(
      () => assertOnlinePaymentTransition(previous, next),
      hasHttpError(409, "ONLINE_PAYMENT_STATUS_CONFLICT")
    );
  }
});

test("online GCash must be paid before reservation fulfillment", () => {
  for (const nextReservationStatus of ["CONFIRMED", "READY_FOR_PICKUP", "COMPLETED"] as const) {
    assert.throws(
      () => assertPaymentAllowsReservationTransition({
        paymentMethod: "PAYMONGO_GCASH",
        paymentStatus: "AWAITING_PAYMENT",
        nextReservationStatus
      }),
      hasHttpError(409, "ONLINE_PAYMENT_REQUIRED")
    );

    assert.doesNotThrow(() => assertPaymentAllowsReservationTransition({
      paymentMethod: "PAYMONGO_GCASH",
      paymentStatus: "PAID",
      nextReservationStatus
    }));
  }

  assert.doesNotThrow(() => assertPaymentAllowsReservationTransition({
    paymentMethod: "PAY_AT_COMMISSARY",
    paymentStatus: null,
    nextReservationStatus: "CONFIRMED"
  }));
});

test("paid online reservations require the refund workflow before cancellation", () => {
  for (const paymentStatus of ["PAID", "REFUND_REVIEW_REQUIRED", "PARTIALLY_REFUNDED"] as const) {
    assert.throws(
      () => assertPaymentAllowsReservationTransition({
        paymentMethod: "PAYMONGO_GCASH",
        paymentStatus,
        nextReservationStatus: "CANCELLED"
      }),
      hasHttpError(409, "ONLINE_PAYMENT_REFUND_REQUIRED")
    );
  }

  for (const paymentStatus of ["INITIALIZING", "AWAITING_PAYMENT", "EXPIRED", "CANCELLED", "REFUNDED"] as const) {
    assert.doesNotThrow(() => assertPaymentAllowsReservationTransition({
      paymentMethod: "PAYMONGO_GCASH",
      paymentStatus,
      nextReservationStatus: "CANCELLED"
    }));
  }
});

test("checkout resume and retry flags expose only actionable states", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  const futureExpiry = new Date(now.getTime() + 60_000);
  const pastExpiry = new Date(now.getTime() - 1);
  assert.equal(paymentCanResume("AWAITING_PAYMENT", "https://checkout.paymongo.com/example", futureExpiry, now), true);
  assert.equal(paymentCanResume("AWAITING_PAYMENT", "https://checkout.paymongo.com/example", pastExpiry, now), false);
  assert.equal(paymentCanResume("AWAITING_PAYMENT", "https://checkout.paymongo.com/example", null, now), false);
  assert.equal(paymentCanResume("AWAITING_PAYMENT", null, futureExpiry, now), false);
  assert.equal(paymentCanResume("PAID", "https://checkout.paymongo.com/example", futureExpiry, now), false);
  assert.equal(paymentCanRetry("INITIALIZING"), true);
  assert.equal(paymentCanRetry("EXPIRED"), true);
  assert.equal(paymentCanRetry("AWAITING_PAYMENT"), false);
  assert.equal(paymentCanRetry("PAID"), false);
});
