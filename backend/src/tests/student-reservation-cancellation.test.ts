import assert from "node:assert/strict";
import test from "node:test";
import { assertStudentCanCancelReservation } from "../domain/student-reservation-cancellation.js";
import { HttpError } from "../utils/http-error.js";

const baseInput = {
  studentId: "student-1",
  reservationStudentId: "student-1",
  currentStatus: "PENDING" as const,
  nextStatus: "CANCELLED" as const,
  paymentMethod: "PAY_AT_COMMISSARY" as const,
  paymentStatus: null
};

function hasHttpError(status: number, code: string) {
  return (error: unknown) => (
    error instanceof HttpError && error.status === status && error.code === code
  );
}

test("students may cancel only their own pending reservation without a paid GCash issue", () => {
  assert.doesNotThrow(() => assertStudentCanCancelReservation(baseInput));
  assert.doesNotThrow(() => assertStudentCanCancelReservation({
    ...baseInput,
    paymentMethod: "PAYMONGO_GCASH",
    paymentStatus: "AWAITING_PAYMENT"
  }));
  assert.doesNotThrow(() => assertStudentCanCancelReservation({
    ...baseInput,
    paymentMethod: "PAYMONGO_GCASH",
    paymentStatus: "EXPIRED"
  }));
});

test("pending paid GCash reservations require staff refund handling", () => {
  for (const paymentStatus of ["PAID", "REFUND_REVIEW_REQUIRED", "PARTIALLY_REFUNDED"] as const) {
    assert.throws(
      () => assertStudentCanCancelReservation({
        ...baseInput,
        paymentMethod: "PAYMONGO_GCASH",
        paymentStatus
      }),
      hasHttpError(409, "ONLINE_PAYMENT_REFUND_REQUIRED")
    );
  }
});

test("confirmed and ready reservations cannot be self-cancelled", () => {
  for (const currentStatus of ["CONFIRMED", "READY_FOR_PICKUP"] as const) {
    assert.throws(
      () => assertStudentCanCancelReservation({ ...baseInput, currentStatus }),
      hasHttpError(409, "STUDENT_CANCELLATION_REQUIRES_STAFF")
    );
  }
});

test("student cancellation does not reveal or modify another student's reservation", () => {
  assert.throws(
    () => assertStudentCanCancelReservation({
      ...baseInput,
      reservationStudentId: "student-2"
    }),
    hasHttpError(404, "RESERVATION_NOT_FOUND")
  );
});
