export const MANILA_TIME_ZONE = "Asia/Manila";

export function manilaDateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function calendarDayDifference(fromDateKey: string, toDateKey: string) {
  const from = new Date(`${fromDateKey}T00:00:00Z`).getTime();
  const to = new Date(`${toDateKey}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}
