import type {
  OnlinePaymentStatus,
  PaymentMethod,
  ReservationStatus
} from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import { assertPaymentAllowsReservationTransition } from "./online-payment.js";

export function assertStudentCanCancelReservation(input: {
  studentId: string;
  reservationStudentId: string;
  currentStatus: ReservationStatus;
  nextStatus: ReservationStatus;
  paymentMethod: PaymentMethod;
  paymentStatus?: OnlinePaymentStatus | null;
}) {
  if (input.studentId !== input.reservationStudentId) {
    throw new HttpError(404, "Reservation not found.", "RESERVATION_NOT_FOUND");
  }

  if (input.nextStatus !== "CANCELLED" || input.currentStatus !== "PENDING") {
    throw new HttpError(
      409,
      "Students can only cancel their own reservation while it is pending. Confirmed reservations must be handled by staff or an administrator.",
      "STUDENT_CANCELLATION_REQUIRES_STAFF"
    );
  }

  assertPaymentAllowsReservationTransition({
    paymentMethod: input.paymentMethod,
    paymentStatus: input.paymentStatus,
    nextReservationStatus: "CANCELLED"
  });
}
