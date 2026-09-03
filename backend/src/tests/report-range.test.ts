import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../utils/http-error.js";
import { resolveReportRange } from "../domain/report-range.js";

const now = new Date("2026-08-28T16:30:00.000Z"); // August 29 in Manila.

test("report presets use inclusive Manila dates and exclusive UTC boundaries", () => {
  const lastSeven = resolveReportRange({ preset: "LAST_7_DAYS", now });
  assert.equal(lastSeven.from, "2026-08-23");
  assert.equal(lastSeven.to, "2026-08-29");
  assert.equal(lastSeven.fromInclusive?.toISOString(), "2026-08-22T16:00:00.000Z");
  assert.equal(lastSeven.toExclusive.toISOString(), "2026-08-29T16:00:00.000Z");
  assert.equal(lastSeven.granularity, "DAILY");

  const lastMonth = resolveReportRange({ preset: "LAST_MONTH", now });
  assert.equal(lastMonth.from, "2026-07-01");
  assert.equal(lastMonth.to, "2026-07-31");
});

test("all-time and long custom reports automatically use monthly trends", () => {
  assert.equal(resolveReportRange({ preset: "ALL_TIME", now }).granularity, "MONTHLY");
  assert.equal(resolveReportRange({ preset: "CUSTOM", from: "2026-01-01", to: "2026-08-29", now }).granularity, "MONTHLY");
});

test("invalid or future custom report ranges are rejected as client errors", () => {
  for (const input of [
    { preset: "CUSTOM" as const, from: "2026-08-30", to: "2026-08-29", now },
    { preset: "CUSTOM" as const, from: "2026-08-01", to: "2026-08-30", now }
  ]) {
    assert.throws(() => resolveReportRange(input), (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === "INVALID_REPORT_RANGE");
  }
});
