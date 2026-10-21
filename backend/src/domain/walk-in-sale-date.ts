import { HttpError } from "../utils/http-error.js";

/**
 * Walk-in sales can be recorded after the fact, e.g. when paper records from
 * before the system went live are entered. The receipt is dated on the day of
 * the sale so daily reports place it correctly, while the receipt's createdAt
 * keeps the moment it was actually entered.
 */
export const WALK_IN_BACKDATE_MAX_DAYS = 90;

/** Tolerates small clock differences between the cashier's device and the server. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveWalkInSoldAt(soldAt: Date | null | undefined, now = new Date()) {
  if (!soldAt) return now;
  if (Number.isNaN(soldAt.getTime())) {
    throw new HttpError(400, "Sale date is invalid.", "INVALID_SOLD_AT");
  }
  if (soldAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    throw new HttpError(400, "Sale date cannot be in the future.", "SOLD_AT_IN_FUTURE");
  }
  if (soldAt.getTime() < now.getTime() - WALK_IN_BACKDATE_MAX_DAYS * DAY_MS) {
    throw new HttpError(
      400,
      `Sale date can be at most ${WALK_IN_BACKDATE_MAX_DAYS} days ago.`,
      "SOLD_AT_TOO_OLD"
    );
  }
  return soldAt.getTime() > now.getTime() ? now : soldAt;
}
