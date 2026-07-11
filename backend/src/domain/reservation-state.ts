import type { ProductStatus, ReservationStatus } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";

const reservationLabels: Record<ReservationStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  READY_FOR_PICKUP: "Ready for pick-up",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show"
};

const allowedReservationTransitions: Record<ReservationStatus, readonly ReservationStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["READY_FOR_PICKUP", "CANCELLED"],
  READY_FOR_PICKUP: ["COMPLETED", "CANCELLED", "NO_SHOW"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: []
};

export function reservationStatusLabel(status: ReservationStatus) {
  return reservationLabels[status];
}

export function assertReservationTransition(previousStatus: ReservationStatus, nextStatus: ReservationStatus) {
  if (previousStatus === nextStatus) return;

  if (!allowedReservationTransitions[previousStatus].includes(nextStatus)) {
    throw new HttpError(
      400,
      `Reservation cannot move from ${reservationStatusLabel(previousStatus)} to ${reservationStatusLabel(nextStatus)}.`
    );
  }
}

export function deriveProductStatus(
  stock: number,
  attentionLevel: number,
  fallbackStatus: ProductStatus
): ProductStatus {
  if (stock <= 0) return "OUT_OF_STOCK";
  if (stock <= attentionLevel) return "RESTOCK_SOON";
  if (fallbackStatus === "OUT_OF_STOCK" || fallbackStatus === "RESTOCK_SOON") return "IN_STOCK";
  return fallbackStatus;
}
