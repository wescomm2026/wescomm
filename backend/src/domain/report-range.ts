export const REPORT_RANGE_PRESETS = [
  "TODAY",
  "LAST_7_DAYS",
  "LAST_30_DAYS",
  "THIS_MONTH",
  "LAST_MONTH",
  "CUSTOM",
  "ALL_TIME"
] as const;

export type ReportRangePreset = (typeof REPORT_RANGE_PRESETS)[number];
export type ReportGranularity = "DAILY" | "MONTHLY";

export type ReportRangeInput = {
  preset?: ReportRangePreset;
  from?: string;
  to?: string;
  granularity?: "AUTO" | ReportGranularity;
  now?: Date;
};

export type ResolvedReportRange = {
  preset: ReportRangePreset;
  from: string | null;
  to: string;
  fromInclusive: Date | null;
  toExclusive: Date;
  granularity: ReportGranularity;
  label: string;
  cacheKey: string;
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertDateKey(value: string, field: string) {
  if (!DATE_KEY_PATTERN.test(value)) throw new HttpError(400, `${field} must use YYYY-MM-DD.`, "INVALID_REPORT_RANGE");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${field} is not a valid calendar date.`, "INVALID_REPORT_RANGE");
  }
  return value;
}

export function manilaReportDateKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila"
  }).format(value);
}

export function addReportCalendarDays(dateKey: string, days: number) {
  const date = new Date(`${assertDateKey(dateKey, "date")}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startOfMonth(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`;
}

function addMonths(dateKey: string, months: number) {
  const date = new Date(`${startOfMonth(dateKey)}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function manilaMidnight(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+08:00`);
}

function daySpan(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function rangeLabel(preset: ReportRangePreset, from: string | null, to: string) {
  const labels: Record<Exclude<ReportRangePreset, "CUSTOM">, string> = {
    TODAY: "Today",
    LAST_7_DAYS: "Last 7 Days",
    LAST_30_DAYS: "Last 30 Days",
    THIS_MONTH: "This Month",
    LAST_MONTH: "Last Month",
    ALL_TIME: "All Time"
  };
  return preset === "CUSTOM" ? `${from} to ${to}` : labels[preset];
}

export function resolveReportRange(input: ReportRangeInput = {}): ResolvedReportRange {
  const preset = input.preset ?? "LAST_30_DAYS";
  const today = manilaReportDateKey(input.now ?? new Date());
  let from: string | null;
  let to = today;

  switch (preset) {
    case "TODAY":
      from = today;
      break;
    case "LAST_7_DAYS":
      from = addReportCalendarDays(today, -6);
      break;
    case "LAST_30_DAYS":
      from = addReportCalendarDays(today, -29);
      break;
    case "THIS_MONTH":
      from = startOfMonth(today);
      break;
    case "LAST_MONTH":
      from = addMonths(today, -1);
      to = addReportCalendarDays(startOfMonth(today), -1);
      break;
    case "CUSTOM":
      if (!input.from || !input.to) throw new HttpError(400, "Custom reports require both from and to dates.", "INVALID_REPORT_RANGE");
      from = assertDateKey(input.from, "from");
      to = assertDateKey(input.to, "to");
      if (from > to) throw new HttpError(400, "The report start date cannot be after the end date.", "INVALID_REPORT_RANGE");
      if (to > today) throw new HttpError(400, "The report end date cannot be in the future.", "INVALID_REPORT_RANGE");
      if (daySpan(from, to) > 3_653) throw new HttpError(400, "Custom report ranges cannot exceed 10 years.", "INVALID_REPORT_RANGE");
      break;
    case "ALL_TIME":
      from = null;
      break;
  }

  const requestedGranularity = input.granularity ?? "AUTO";
  const granularity = requestedGranularity === "AUTO"
    ? (!from || daySpan(from, to) > 93 ? "MONTHLY" : "DAILY")
    : requestedGranularity;
  const toExclusiveKey = addReportCalendarDays(to, 1);

  return {
    preset,
    from,
    to,
    fromInclusive: from ? manilaMidnight(from) : null,
    toExclusive: manilaMidnight(toExclusiveKey),
    granularity,
    label: rangeLabel(preset, from, to),
    cacheKey: [preset, from ?? "beginning", to, granularity].join(":").toLowerCase()
  };
}
import { HttpError } from "../utils/http-error.js";
