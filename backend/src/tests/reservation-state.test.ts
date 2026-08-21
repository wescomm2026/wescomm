import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReservationTransition,
  deriveProductStatus,
  reservationStatusLabel
} from "../domain/reservation-state.js";
import { HttpError } from "../utils/http-error.js";

test("reservation workflow allows only the documented forward transitions", () => {
  assert.doesNotThrow(() => assertReservationTransition("PENDING", "CONFIRMED"));
  assert.doesNotThrow(() => assertReservationTransition("PENDING", "CANCELLED"));
  assert.doesNotThrow(() => assertReservationTransition("CONFIRMED", "READY_FOR_PICKUP"));
  assert.doesNotThrow(() => assertReservationTransition("CONFIRMED", "CANCELLED"));
  assert.doesNotThrow(() => assertReservationTransition("READY_FOR_PICKUP", "COMPLETED"));
  assert.doesNotThrow(() => assertReservationTransition("READY_FOR_PICKUP", "CANCELLED"));
  assert.doesNotThrow(() => assertReservationTransition("READY_FOR_PICKUP", "NO_SHOW"));
  assert.doesNotThrow(() => assertReservationTransition("COMPLETED", "COMPLETED"));
});

test("terminal and out-of-order reservation transitions are rejected", () => {
  assert.throws(
    () => assertReservationTransition("COMPLETED", "PENDING"),
    (error: unknown) => error instanceof HttpError && error.status === 400
  );
  assert.throws(
    () => assertReservationTransition("PENDING", "COMPLETED"),
    /Reservation cannot move from Pending to Completed/
  );
});

test("reservation status labels remain suitable for staff-facing errors", () => {
  assert.equal(reservationStatusLabel("READY_FOR_PICKUP"), "Ready for pick-up");
  assert.equal(reservationStatusLabel("NO_SHOW"), "No-show");
});

test("product status follows the available quantity and staff attention level", () => {
  assert.equal(deriveProductStatus(0, 10, "IN_STOCK"), "OUT_OF_STOCK");
  assert.equal(deriveProductStatus(10, 10, "IN_STOCK"), "RESTOCK_SOON");
  assert.equal(deriveProductStatus(11, 10, "RESTOCK_SOON"), "IN_STOCK");
  assert.equal(deriveProductStatus(20, 10, "ON_SALE"), "ON_SALE");
});
