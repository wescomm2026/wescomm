import { HttpError } from "../utils/http-error.js";

export const SALES_REPORT_PERIODS = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type SalesReportPeriod = (typeof SALES_REPORT_PERIODS)[number];

export const SALES_REPORT_CHANNELS = ["ALL", "RESERVATION", "WALK_IN"] as const;
export type SalesReportChannel = (typeof SALES_REPORT_CHANNELS)[number];

export const SALES_REPORT_LOCATIONS = ["ALL", "COMMISSARY", "TREASURER"] as const;
export type SalesReportLocation = (typeof SALES_REPORT_LOCATIONS)[number];

export const SALES_REPORT_TIMEZONE = "Asia/Manila";

export const MAX_SALES_LEDGER_RECEIPTS = 2_000;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertDateKey(value: string, field: string) {
  if (!DATE_KEY_PATTERN.test(value)) throw new HttpError(400, `${field} must use YYYY-MM-DD.`, "INVALID_SALES_REPORT_RANGE");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${field} is not a valid calendar date.`, "INVALID_SALES_REPORT_RANGE");
  }
  return value;
}

export function salesReportDateKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: SALES_REPORT_TIMEZONE
  }).format(value);
}

export function addSalesLedgerDays(dateKey: string, days: number) {
  const date = new Date(`${assertDateKey(dateKey, "date")}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function manilaMidnight(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+08:00`);
}

function manilaWeekday(dateKey: string) {
  // Manila noon is always the same calendar day as the date key, so the UTC
  // weekday of that instant equals the weekday observed in Asia/Manila.
  return new Date(`${dateKey}T12:00:00+08:00`).getUTCDay();
}

function formatDateLabel(dateKey: string, options: Intl.DateTimeFormatOptions) {
  return new Date(`${dateKey}T12:00:00+08:00`).toLocaleDateString("en-PH", {
    ...options,
    timeZone: SALES_REPORT_TIMEZONE
  });
}

function salesLedgerRangeLabel(period: SalesReportPeriod, fromKey: string, toKey: string) {
  if (period === "DAILY") {
    return formatDateLabel(fromKey, { month: "long", day: "numeric", year: "numeric" });
  }
  if (period === "MONTHLY") {
    return formatDateLabel(fromKey, { month: "long", year: "numeric" });
  }
  const lastKey = addSalesLedgerDays(toKey, -1);
  const fromLabel = formatDateLabel(fromKey, { month: "short", day: "numeric" });
  const toLabel = formatDateLabel(lastKey, { month: "short", day: "numeric", year: "numeric" });
  return `${fromLabel} \u2013 ${toLabel}`;
}

export type SalesLedgerRangeInput = {
  period: SalesReportPeriod;
  anchor: string;
  now?: Date | string;
};

export type ResolvedSalesLedgerRange = {
  period: SalesReportPeriod;
  anchor: string;
  fromKey: string;
  toKey: string;
  fromInclusive: Date;
  toExclusive: Date;
  label: string;
};

export function resolveSalesLedgerRange(input: SalesLedgerRangeInput): ResolvedSalesLedgerRange {
  const anchor = assertDateKey(input.anchor, "anchor");
  const todayKey = salesReportDateKey(input.now ? new Date(input.now) : new Date());
  if (anchor > todayKey) {
    throw new HttpError(400, "The report anchor date cannot be in the future.", "INVALID_SALES_REPORT_RANGE");
  }

  let fromKey: string;
  let toKey: string;

  switch (input.period) {
    case "DAILY":
      fromKey = anchor;
      toKey = addSalesLedgerDays(anchor, 1);
      break;
    case "WEEKLY": {
      const daysSinceMonday = (manilaWeekday(anchor) + 6) % 7;
      fromKey = addSalesLedgerDays(anchor, -daysSinceMonday);
      toKey = addSalesLedgerDays(fromKey, 7);
      break;
    }
    case "MONTHLY": {
      fromKey = `${anchor.slice(0, 7)}-01`;
      const nextMonth = new Date(`${fromKey}T00:00:00Z`);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      toKey = nextMonth.toISOString().slice(0, 10);
      break;
    }
  }

  return {
    period: input.period,
    anchor,
    fromKey,
    toKey,
    fromInclusive: manilaMidnight(fromKey),
    toExclusive: manilaMidnight(toKey),
    label: salesLedgerRangeLabel(input.period, fromKey, toKey)
  };
}
