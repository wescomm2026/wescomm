/**
 * Walk-in sales can be recorded after the fact (e.g. paper records from before
 * WESCOMM went live). Dates are Philippine calendar days; the backend accepts
 * up to WALK_IN_BACKDATE_MAX_DAYS in the past and stamps the receipt with it.
 */
export const WALK_IN_BACKDATE_MAX_DAYS = 90;
export const DEFAULT_PAST_SALE_TIME = "12:00";

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD for the Manila calendar day containing `now`. */
export function manilaDateKey(now = new Date()) {
  return new Date(now.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The earliest sale date the backend accepts, as YYYY-MM-DD (Manila). */
export function earliestPastSaleDate(now = new Date()) {
  // One day of margin so a date picked near midnight is never rejected.
  return manilaDateKey(new Date(now.getTime() - (WALK_IN_BACKDATE_MAX_DAYS - 1) * DAY_MS));
}

export type SaleDateStatus = "TODAY" | "PAST" | "FUTURE" | "TOO_OLD" | "INVALID";

function isCalendarDate(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  const parsed = new Date(`${dateKey}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dateKey;
}

/** Only TODAY and PAST can be saved; anything else must block the sale. */
export function saleDateStatus(dateKey: string, now = new Date()): SaleDateStatus {
  if (!isCalendarDate(dateKey)) return "INVALID";
  const today = manilaDateKey(now);
  if (dateKey === today) return "TODAY";
  if (dateKey > today) return "FUTURE";
  return dateKey >= earliestPastSaleDate(now) ? "PAST" : "TOO_OLD";
}

export function saleDateError(status: SaleDateStatus) {
  if (status === "FUTURE") return "The sale date cannot be in the future. Choose today or an earlier date.";
  if (status === "TOO_OLD") return `Choose a sale date within the last ${WALK_IN_BACKDATE_MAX_DAYS} days.`;
  if (status === "INVALID") return "Enter a complete sale date.";
  return "";
}

/**
 * The soldAt value to send: undefined for a sale happening today, an ISO
 * date-time for a past sale. A past sale with no known time defaults to noon
 * so it stays on the chosen day. Any other date throws rather than silently
 * becoming a sale for today.
 */
export function walkInSoldAt(dateKey: string, time: string, now = new Date()) {
  const status = saleDateStatus(dateKey, now);
  if (status === "TODAY") return undefined;
  if (status !== "PAST") throw new Error(saleDateError(status));
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : DEFAULT_PAST_SALE_TIME;
  return `${dateKey}T${clock}:00+08:00`;
}

export function formatSaleDateLabel(dateKey: string) {
  return new Date(`${dateKey}T12:00:00+08:00`).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

/** True when a receipt was entered on a later day than the sale it records. */
export function wasEnteredLater(receipt: { issuedAt: string; createdAt: string }) {
  return manilaDateKey(new Date(receipt.createdAt)) > manilaDateKey(new Date(receipt.issuedAt));
}
