import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../utils/http-error.js";

test("transient Supabase database failures become retryable 503 errors", () => {
  for (const error of [
    { code: "PGRST003", message: "pool timeout" },
    { code: "08006", message: "connection failure" },
    { code: "53300", message: "too many connections" },
    { httpStatus: 503, message: "upstream unavailable" },
    { statusCode: 504, message: "storage gateway timeout" },
    { message: "TypeError: fetch failed" }
  ]) {
    const mapped = HttpError.fromSupabase(error);
    assert.equal(mapped.status, 503);
    assert.equal(mapped.code, "DATABASE_TEMPORARILY_UNAVAILABLE");
    assert.equal(mapped.details?.retryable, true);
  }
});

test("non-transient Supabase failures remain internal errors", () => {
  const mapped = HttpError.fromSupabase({
    code: "42703",
    message: "column does not exist"
  });

  assert.equal(mapped.status, 500);
  assert.equal(mapped.message, "column does not exist");
  assert.equal(mapped.details, undefined);
});

test("Supabase rate limits preserve a retryable client-facing status", () => {
  const mapped = HttpError.fromSupabase({
    httpStatus: 429,
    message: "rate limit exceeded"
  });

  assert.equal(mapped.status, 429);
  assert.equal(mapped.code, "UPSTREAM_RATE_LIMITED");
});
