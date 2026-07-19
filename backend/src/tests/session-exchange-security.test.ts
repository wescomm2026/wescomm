import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { requireBearerSessionExchange } from "../middleware/require-bearer-session-exchange.js";
import { HttpError } from "../utils/http-error.js";

function evaluateExchange(method: "COOKIE" | "BEARER") {
  let result: unknown = Symbol("not-called");
  const request = { auth: { method } } as AuthenticatedRequest;
  const next = ((error?: unknown) => {
    result = error;
  }) as NextFunction;

  requireBearerSessionExchange(request, {} as Response, next);
  return result;
}

test("cookie sessions cannot be exchanged for a new standard session", () => {
  const result = evaluateExchange("COOKIE");
  assert.equal(result instanceof HttpError, true);
  assert.equal((result as HttpError).status, 403);
  assert.equal((result as HttpError).code, "BEARER_SESSION_REQUIRED");
});

test("approved bearer authentication may create a standard session", () => {
  assert.equal(evaluateExchange("BEARER"), undefined);
});
