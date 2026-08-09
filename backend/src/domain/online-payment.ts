import { createHash } from "node:crypto";
import type { OnlinePaymentStatus, PaymentMethod, ReservationStatus } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";

export const GCASH_MIN_AMOUNT_CENTAVOS = 100;
export const GCASH_MAX_AMOUNT_CENTAVOS = 10_000_000;
export const PAYMONGO_PROVIDER_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PAYMONGO_CREATE_RECOVERY_SAFETY_MARGIN_MS = 60 * 60 * 1000;
export const PAYMONGO_CREATE_RECOVERY_WINDOW_MS =
  PAYMONGO_PROVIDER_IDEMPOTENCY_WINDOW_MS - PAYMONGO_CREATE_RECOVERY_SAFETY_MARGIN_MS;

export function canSafelyRecoverPaymongoCreate(createdAt: Date, now = new Date()) {
  const ageMs = now.getTime() - createdAt.getTime();
  return ageMs >= 0 && ageMs < PAYMONGO_CREATE_RECOVERY_WINDOW_MS;
}

const allowedTransitions: Record<OnlinePaymentStatus, readonly OnlinePaymentStatus[]> = {
  INITIALIZING: ["AWAITING_PAYMENT", "PAID", "EXPIRED", "CANCELLED", "REFUND_REVIEW_REQUIRED"],
  AWAITING_PAYMENT: ["PAID", "EXPIRED", "CANCELLED", "REFUND_REVIEW_REQUIRED"],
  PAID: ["REFUND_REVIEW_REQUIRED"],
  EXPIRED: ["AWAITING_PAYMENT", "CANCELLED", "REFUND_REVIEW_REQUIRED"],
  CANCELLED: ["REFUND_REVIEW_REQUIRED"],
  REFUND_REVIEW_REQUIRED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["REFUND_REVIEW_REQUIRED", "REFUNDED"],
  REFUNDED: ["REFUND_REVIEW_REQUIRED"]
};

function decimalText(value: string | number | { toString(): string }) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError("Payment amount must be a finite decimal value.");
  }
  return String(value).trim();
}

export function phpDecimalToCentavos(value: string | number | { toString(): string }) {
  const text = decimalText(value);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new RangeError("PHP amounts must be non-negative and have no more than two decimal places.");

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  const centavos = whole * 100n + fraction;
  if (centavos > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Payment amount is too large to process safely.");
  }

  return Number(centavos);
}

export function assertGcashAmountCentavos(amountCentavos: number) {
  if (!Number.isSafeInteger(amountCentavos)) {
    throw new HttpError(400, "GCash amount must be a whole number of centavos.", "INVALID_PAYMENT_AMOUNT");
  }
  if (amountCentavos < GCASH_MIN_AMOUNT_CENTAVOS || amountCentavos > GCASH_MAX_AMOUNT_CENTAVOS) {
    throw new HttpError(
      400,
      "GCash payments must be between PHP 1.00 and PHP 100,000.00.",
      "GCASH_AMOUNT_OUT_OF_RANGE"
    );
  }
}

export function createProviderIdempotencyKey(input: {
  studentId: string;
  reservationId: string;
  requestKey: string;
  attemptId?: string;
}) {
  const digest = createHash("sha256")
    .update(`wescomm-paymongo-checkout-v2\u0000${input.studentId}\u0000${input.reservationId}\u0000${input.requestKey}\u0000${input.attemptId ?? "legacy"}`)
    .digest("hex");
  return `wescomm-checkout-${digest}`;
}

export function assertOnlinePaymentTransition(previous: OnlinePaymentStatus, next: OnlinePaymentStatus) {
  if (previous === next) return;
  if (!allowedTransitions[previous].includes(next)) {
    throw new HttpError(
      409,
      `Online payment cannot move from ${previous} to ${next}.`,
      "ONLINE_PAYMENT_STATUS_CONFLICT"
    );
  }
}

export function assertPaymentAllowsReservationTransition(input: {
  paymentMethod: PaymentMethod;
  paymentStatus?: OnlinePaymentStatus | null;
  nextReservationStatus: ReservationStatus;
}) {
  if (input.paymentMethod !== "PAYMONGO_GCASH") return;

  const forwardStatuses: readonly ReservationStatus[] = ["CONFIRMED", "READY_FOR_PICKUP", "COMPLETED"];
  if (forwardStatuses.includes(input.nextReservationStatus) && input.paymentStatus !== "PAID") {
    throw new HttpError(
      409,
      "This reservation must have a confirmed GCash payment before fulfillment can continue.",
      "ONLINE_PAYMENT_REQUIRED"
    );
  }

  if (
    input.nextReservationStatus === "CANCELLED" &&
    ["PAID", "REFUND_REVIEW_REQUIRED", "PARTIALLY_REFUNDED"].includes(input.paymentStatus ?? "")
  ) {
    throw new HttpError(
      409,
      "This paid reservation requires an approved refund before it can be cancelled.",
      "ONLINE_PAYMENT_REFUND_REQUIRED"
    );
  }
}

export function paymentCanResume(
  status: OnlinePaymentStatus,
  checkoutUrl: string | null | undefined,
  checkoutExpiresAt: Date | string | null | undefined,
  now = new Date()
) {
  const expiryMs = checkoutExpiresAt instanceof Date
    ? checkoutExpiresAt.getTime()
    : typeof checkoutExpiresAt === "string" ? Date.parse(checkoutExpiresAt) : Number.NaN;
  return status === "AWAITING_PAYMENT"
    && Boolean(checkoutUrl)
    && Number.isFinite(expiryMs)
    && expiryMs > now.getTime();
}

export function paymentCanRetry(status: OnlinePaymentStatus) {
  return status === "INITIALIZING" || status === "EXPIRED";
}
