import { HttpError } from "../utils/http-error.js";

/**
 * Commissary rule: a sale can be cancelled (voided) within 2 days, e.g. when a
 * student bought the wrong size. The window closes at the end of the second
 * calendar day after the sale, Philippine time: a sale on Oct 7 can be voided
 * until Oct 9, 11:59 PM. After that only an admin may void, with a reason.
 */
export const RECEIPT_VOID_WINDOW_DAYS = 2;

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The first instant after the void window (start of day soldDate + 3, Manila). */
export function receiptVoidDeadline(soldAt: Date, windowDays = RECEIPT_VOID_WINDOW_DAYS) {
  const manila = new Date(soldAt.getTime() + MANILA_OFFSET_MS);
  const manilaMidnightUtc = Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), manila.getUTCDate());
  return new Date(manilaMidnightUtc + (windowDays + 1) * DAY_MS - MANILA_OFFSET_MS);
}

/** Last displayable moment of the window (11:59 PM Manila on the final day). */
export function receiptVoidableUntil(soldAt: Date) {
  return new Date(receiptVoidDeadline(soldAt).getTime() - 60_000);
}

export function isWithinReceiptVoidWindow(soldAt: Date, now = new Date()) {
  return now.getTime() < receiptVoidDeadline(soldAt).getTime();
}

function formatManila(value: Date) {
  return value.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function assertReceiptVoidAllowed(input: { actorRole: string | null | undefined; soldAt: Date; now?: Date }) {
  if (input.actorRole === "ADMIN") return;
  if (isWithinReceiptVoidWindow(input.soldAt, input.now)) return;
  throw new HttpError(
    403,
    `The ${RECEIPT_VOID_WINDOW_DAYS}-day void period for this sale ended ${formatManila(receiptVoidableUntil(input.soldAt))}. Ask an admin to void it.`,
    "RECEIPT_VOID_WINDOW_CLOSED",
    { voidableUntil: receiptVoidableUntil(input.soldAt).toISOString() }
  );
}
