import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_SESSION_TRANSACTION_OPTIONS,
  authSessionIssueError,
  authSessionExpiration,
  isAuthSessionProfileAllowed,
  isTemporaryStaffSessionToken
} from "../services/auth-session.service.js";
import { HttpError } from "../utils/http-error.js";

test("session issuance has a bounded pool wait and remote-database execution budget", () => {
  assert.deepEqual(AUTH_SESSION_TRANSACTION_OPTIONS, {
    maxWait: 10_000,
    timeout: 20_000
  });
  assert.equal(Object.isFrozen(AUTH_SESSION_TRANSACTION_OPTIONS), true);
});

test("temporary sessions are capped without extending the configured session TTL", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const thirtyMinuteCap = new Date(now.getTime() + 30 * 60 * 1000);

  assert.equal(
    authSessionExpiration(now, 24 * 7, thirtyMinuteCap).toISOString(),
    thirtyMinuteCap.toISOString()
  );
  assert.equal(
    authSessionExpiration(now, 1, new Date(now.getTime() + 2 * 60 * 60 * 1000)).toISOString(),
    new Date(now.getTime() + 60 * 60 * 1000).toISOString()
  );
});

test("transient database failures during session issuance become a retryable 503", () => {
  const error = authSessionIssueError({ code: "P1001" });
  assert.equal(error instanceof HttpError, true);
  assert.equal((error as HttpError).status, 503);
  assert.equal((error as HttpError).code, "AUTH_SESSION_UNAVAILABLE");

  const nonTransient = new Error("schema error");
  assert.equal(authSessionIssueError(nonTransient), nonTransient);
});

test("temporary staff session tokens keep an active STAFF-only role ceiling", () => {
  const temporaryToken = "tmp_staff.random-secret-token";
  assert.equal(isTemporaryStaffSessionToken(temporaryToken), true);
  assert.equal(isTemporaryStaffSessionToken("standard-random-secret-token"), false);

  assert.equal(isAuthSessionProfileAllowed(
    temporaryToken,
    { email: "staff@wesleyan.edu.ph", role: "STAFF" },
    true
  ), true);
  assert.equal(isAuthSessionProfileAllowed(
    temporaryToken,
    { email: "staff@wesleyan.edu.ph", role: "ADMIN" },
    true
  ), false);
  assert.equal(isAuthSessionProfileAllowed(
    temporaryToken,
    { email: "staff@wesleyan.edu.ph", role: "STAFF" },
    false
  ), false);
  assert.equal(isAuthSessionProfileAllowed(
    "standard-random-secret-token",
    { email: "staff@wesleyan.edu.ph", role: "ADMIN" },
    false
  ), true);
});
