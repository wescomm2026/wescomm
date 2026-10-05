import { createHash } from "node:crypto";
import type { OnlinePaymentStatus, PaymentMethod, ReservationStatus } from "../types/app.js";

export const MAX_BULK_CONFIRMATIONS = 100;

export type BulkConfirmationBlockReason =
  | "NOT_PENDING"
  | "SCHEDULE_REVIEW_REQUIRED"
  | "ONLINE_PAYMENT_NOT_PAID";

export function bulkConfirmationBlockReason(input: {
  status: ReservationStatus;
  pickupReviewStatus: string;
  paymentMethod: PaymentMethod;
  paymentStatus?: OnlinePaymentStatus | null;
}): BulkConfirmationBlockReason | null {
  if (input.status !== "PENDING") return "NOT_PENDING";
  if (input.pickupReviewStatus === "NEEDS_REVIEW") return "SCHEDULE_REVIEW_REQUIRED";
  if (input.paymentMethod === "PAYMONGO_GCASH" && input.paymentStatus !== "PAID") return "ONLINE_PAYMENT_NOT_PAID";
  return null;
}

export function bulkConfirmationPreviewToken(reservationIds: string[]) {
  // Keep the preview's oldest-first order bound to execution; the same set in a
  // different order is a different command.
  return createHash("sha256").update(reservationIds.join("\n")).digest("hex");
}

export function bulkConfirmationReasonLabel(reason: BulkConfirmationBlockReason) {
  return ({
    NOT_PENDING: "Status already changed",
    SCHEDULE_REVIEW_REQUIRED: "Pickup schedule needs review",
    ONLINE_PAYMENT_NOT_PAID: "Historical online payment is not confirmed"
  } as const)[reason];
}
