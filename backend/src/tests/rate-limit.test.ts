import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http-error.js";
import { createMemoryRateLimitStore, createRateLimiter, type RateLimitStore, userRateLimitKey } from "../middleware/rate-limit.js";

function createResponse() {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let body: unknown;

  const response = {
    locals: { requestId: "rate-limit-test" },
    setHeader(name: string, value: string) {
      headers.set(name, value);
      return this;
    },
    status(value: number) {
      statusCode = value;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    }
  } as unknown as Response;

  return {
    response,
    headers,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    }
  };
}

test("rate limiter permits the configured allowance and blocks the next request", async () => {
  const limiter = createRateLimiter({
    namespace: `test-${randomUUID()}`,
    windowMs: 60_000,
    max: 2,
    key: () => "same-user",
    store: createMemoryRateLimitStore()
  });
  const request = { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } } as Request;
  let nextCalls = 0;
  const next = (() => {
    nextCalls += 1;
  }) as NextFunction;

  const first = createResponse();
  const second = createResponse();
  const third = createResponse();
  await limiter(request, first.response, next);
  await limiter(request, second.response, next);
  await limiter(request, third.response, next);

  assert.equal(nextCalls, 2);
  assert.equal(third.statusCode, 429);
  assert.equal(third.headers.get("RateLimit-Remaining"), "0");
  assert.ok(Number(third.headers.get("Retry-After")) >= 1);
  assert.deepEqual(third.body, {
    error: "Too many requests. Please wait before trying again.",
    retryAfter: Number(third.headers.get("Retry-After")),
    requestId: "rate-limit-test"
  });
});

test("rate limiter fails closed when the shared counter store is unavailable", async () => {
  const unavailableStore: RateLimitStore = {
    async increment() {
      throw new Error("store unavailable");
    }
  };
  const limiter = createRateLimiter({
    namespace: `test-${randomUUID()}`,
    windowMs: 60_000,
    max: 2,
    store: unavailableStore
  });
  const request = { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } } as Request;
  const result = createResponse();
  let forwardedError: unknown;

  await limiter(request, result.response, ((error?: unknown) => {
    forwardedError = error;
  }) as NextFunction);

  assert.ok(forwardedError instanceof HttpError);
  assert.equal(forwardedError.status, 503);
  assert.equal(forwardedError.code, "RATE_LIMIT_STORE_UNAVAILABLE");
  assert.deepEqual(forwardedError.details, { retryable: true });
});

test("authenticated rate limits use the user id instead of a shared network address", () => {
  const request = {
    ip: "127.0.0.1",
    auth: { id: "student-id" },
    socket: { remoteAddress: "127.0.0.1" }
  } as unknown as Request;

  assert.equal(userRateLimitKey(request), "student-id");
});

test("Vercel and production use an atomic server-only PostgreSQL rate-limit store", () => {
  const middleware = readFileSync(path.resolve(process.cwd(), "src/middleware/rate-limit.ts"), "utf8");
  const migration = readFileSync(path.resolve(
    process.cwd(),
    "prisma/migrations/20260830010000_add_distributed_rate_limits/migration.sql"
  ), "utf8");

  assert.match(middleware, /process\.env\.NODE_ENV === "production" \|\| process\.env\.VERCEL === "1"/);
  assert.match(middleware, /ON CONFLICT \("key_hash"\) DO UPDATE/);
  assert.match(middleware, /createHash\("sha256"\)/);
  assert.match(migration, /CREATE TABLE "rate_limit_counters"/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL PRIVILEGES/);
});
