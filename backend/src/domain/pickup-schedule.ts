import { HttpError } from "../utils/http-error.js";

export const PICKUP_TIMEZONE = "Asia/Manila";

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type PickupPolicySnapshot = {
  version: number;
  minAdvanceDays: number;
  maxAdvanceDays: number;
  days: Array<{ weekday: number; enabled: boolean }>;
  timeSlots: Array<{
    id: string;
    label: string;
    startMinute: number;
    endMinute: number;
    isActive: boolean;
    capacity?: number | null;
  }>;
  closures: Array<{ date: Date; reason: string }>;
};

export function manilaDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PICKUP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function parsePickupDateKey(value: string) {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) throw new HttpError(400, "Pickup date must use YYYY-MM-DD.", "INVALID_PICKUP_DATE");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year
    || normalized.getUTCMonth() !== month - 1
    || normalized.getUTCDate() !== day
  ) {
    throw new HttpError(400, "Pickup date is not a valid calendar date.", "INVALID_PICKUP_DATE");
  }
  return { year, month, day, normalized };
}

export function addCalendarDays(dateKey: string, days: number) {
  const { normalized } = parsePickupDateKey(dateKey);
  normalized.setUTCDate(normalized.getUTCDate() + days);
  return normalized.toISOString().slice(0, 10);
}

export function pickupWeekday(dateKey: string) {
  return parsePickupDateKey(dateKey).normalized.getUTCDay();
}

export function pickupDateColumnKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function pickupInstant(dateKey: string, minute: number) {
  const { year, month, day } = parsePickupDateKey(dateKey);
  const hour = Math.floor(minute / 60);
  const minuteOfHour = minute % 60;
  // Asia/Manila is UTC+08:00 and has no daylight-saving transitions.
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minuteOfHour));
}

export function validatePickupSelection(input: {
  policy: PickupPolicySnapshot;
  policyVersion: number;
  pickupDate: string;
  slotId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (input.policy.version !== input.policyVersion) {
    throw new HttpError(
      409,
      "The pickup schedule changed. Refresh the available dates and choose again.",
      "PICKUP_POLICY_CHANGED",
      { currentPolicyVersion: input.policy.version }
    );
  }

  parsePickupDateKey(input.pickupDate);
  const today = manilaDateKey(now);
  const minDate = addCalendarDays(today, input.policy.minAdvanceDays);
  const maxDate = addCalendarDays(today, input.policy.maxAdvanceDays);
  if (input.pickupDate < minDate || input.pickupDate > maxDate) {
    throw new HttpError(
      400,
      `Pickup date must be from ${minDate} through ${maxDate}.`,
      "PICKUP_DATE_OUTSIDE_POLICY",
      { minDate, maxDate }
    );
  }

  const weekday = pickupWeekday(input.pickupDate);
  if (!input.policy.days.some((day) => day.weekday === weekday && day.enabled)) {
    throw new HttpError(400, "Pickup is not available on the selected weekday.", "PICKUP_DAY_UNAVAILABLE");
  }

  const closure = input.policy.closures.find((entry) => pickupDateColumnKey(entry.date) === input.pickupDate);
  if (closure) {
    throw new HttpError(400, `Pickup is closed on this date: ${closure.reason}`, "PICKUP_DATE_CLOSED");
  }

  const slot = input.policy.timeSlots.find((entry) => entry.id === input.slotId && entry.isActive);
  if (!slot) {
    throw new HttpError(400, "The selected pickup time is no longer available.", "PICKUP_SLOT_UNAVAILABLE");
  }

  return {
    pickupStart: pickupInstant(input.pickupDate, slot.startMinute),
    pickupEnd: pickupInstant(input.pickupDate, slot.endMinute),
    slot,
    minDate,
    maxDate
  };
}

export function scheduleReviewReason(input: {
  policy: PickupPolicySnapshot;
  pickupStart: Date | null;
  pickupEnd: Date | null;
  now?: Date;
}) {
  if (!input.pickupStart || !input.pickupEnd) return "Reservation has no complete pickup schedule.";
  const dateKey = manilaDateKey(input.pickupStart);
  const weekday = pickupWeekday(dateKey);
  if (!input.policy.days.some((day) => day.weekday === weekday && day.enabled)) {
    return "Pickup weekday is disabled by the current policy.";
  }
  const closure = input.policy.closures.find((entry) => pickupDateColumnKey(entry.date) === dateKey);
  if (closure) return `Pickup date is closed: ${closure.reason}`;

  const today = manilaDateKey(input.now ?? new Date());
  const minDate = addCalendarDays(today, input.policy.minAdvanceDays);
  const maxDate = addCalendarDays(today, input.policy.maxAdvanceDays);
  if (dateKey < minDate || dateKey > maxDate) return "Pickup date is outside the current advance-day limits.";

  const startMinute = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: PICKUP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(input.pickupStart).find((part) => part.type === "hour")?.value ?? 0) * 60
    + Number(new Intl.DateTimeFormat("en-US", {
      timeZone: PICKUP_TIMEZONE,
      minute: "2-digit"
    }).formatToParts(input.pickupStart).find((part) => part.type === "minute")?.value ?? 0);
  const endParts = new Intl.DateTimeFormat("en-US", {
    timeZone: PICKUP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(input.pickupEnd);
  const endMinute = Number(endParts.find((part) => part.type === "hour")?.value ?? 0) * 60
    + Number(endParts.find((part) => part.type === "minute")?.value ?? 0);
  if (!input.policy.timeSlots.some((slot) => slot.isActive && slot.startMinute === startMinute && slot.endMinute === endMinute)) {
    return "Pickup time slot is inactive or no longer configured.";
  }
  return null;
}
