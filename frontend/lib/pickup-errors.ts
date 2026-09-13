import { BackendApiError } from "@/lib/api";

export const PICKUP_RECOVERY_CODES = new Set([
  "PICKUP_POLICY_CHANGED",
  "PICKUP_DATE_CLOSED",
  "PICKUP_DATE_OUTSIDE_POLICY",
  "PICKUP_DAY_UNAVAILABLE",
  "PICKUP_SLOT_UNAVAILABLE",
  "PICKUP_SLOT_FULL",
  "PICKUP_SLOT_EXPIRED",
  "PICKUP_POLICY_UNAVAILABLE"
]);

export function isPickupRecoveryError(error: unknown): error is BackendApiError {
  return error instanceof BackendApiError
    && typeof error.code === "string"
    && PICKUP_RECOVERY_CODES.has(error.code);
}

export function pickupRecoveryMessage(error: BackendApiError) {
  if (error.code === "PICKUP_SLOT_EXPIRED") {
    return "That pickup time has already started. Please choose a later time.";
  }
  if (error.code === "PICKUP_POLICY_UNAVAILABLE") {
    return "Pickup scheduling is temporarily unavailable. Please try again later.";
  }
  return "Pickup availability changed. Please choose another date and time.";
}
