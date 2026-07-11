import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { createRateLimiter, userRateLimitKey } from "../middleware/rate-limit.js";

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

test("rate limiter permits the configured allowance and blocks the next request", () => {
  const limiter = createRateLimiter({
    namespace: `test-${randomUUID()}`,
    windowMs: 60_000,
    max: 2,
    key: () => "same-user"
  });
  const request = { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } } as Request;
  let nextCalls = 0;
  const next = (() => {
    nextCalls += 1;
  }) as NextFunction;

  const first = createResponse();
  const second = createResponse();
  const third = createResponse();
  limiter(request, first.response, next);
  limiter(request, second.response, next);
  limiter(request, third.response, next);

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

test("authenticated rate limits use the user id instead of a shared network address", () => {
  const request = {
    ip: "127.0.0.1",
    auth: { id: "student-id" },
    socket: { remoteAddress: "127.0.0.1" }
  } as unknown as Request;

  assert.equal(userRateLimitKey(request), "student-id");
});
