import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TEMPORARY_STAFF_LOGIN_WINDOW_MS,
  TEMPORARY_PRODUCTION_STAFF_EMAIL,
  assertSafeTemporaryStaffLoginEnvironment,
  isTemporaryProductionStaffIdentity,
  temporaryStaffLoginExpirationMs
} from "../domain/temporary-staff-login-policy.js";

const NOW_MS = Date.parse("2026-07-19T12:00:00.000Z");
const validExpiration = new Date(NOW_MS + 60 * 60 * 1000).toISOString();
const validEnvironment = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_TARGET_ENV: "production",
  AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: true,
  AUTH_TEMP_PRODUCTION_STAFF_LOGIN_PASSWORD: "temporary-production-password",
  AUTH_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: validExpiration,
  NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: true,
  NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: validExpiration
};

test("temporary staff login accepts only a synchronized verified Production window", () => {
  assert.doesNotThrow(() => assertSafeTemporaryStaffLoginEnvironment(validEnvironment, NOW_MS));
  assert.equal(temporaryStaffLoginExpirationMs(validEnvironment, NOW_MS), Date.parse(validExpiration));
});

test("temporary staff login fails closed for mismatched, unverified, weak, or oversized configuration", () => {
  assert.throws(() => assertSafeTemporaryStaffLoginEnvironment({
    ...validEnvironment,
    NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: false
  }, NOW_MS), /flags must be enabled together/);

  assert.throws(() => assertSafeTemporaryStaffLoginEnvironment({
    ...validEnvironment,
    VERCEL_ENV: "preview"
  }, NOW_MS), /requires verified Vercel Production/);

  assert.throws(() => assertSafeTemporaryStaffLoginEnvironment({
    ...validEnvironment,
    AUTH_TEMP_PRODUCTION_STAFF_LOGIN_PASSWORD: "too-short"
  }, NOW_MS), /at least 20 characters/);

  assert.throws(() => assertSafeTemporaryStaffLoginEnvironment({
    ...validEnvironment,
    AUTH_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: "July 20, 2026",
    NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: "July 20, 2026"
  }, NOW_MS), /valid ISO-8601 timestamp/);

  assert.throws(() => assertSafeTemporaryStaffLoginEnvironment({
    ...validEnvironment,
    NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: new Date(NOW_MS + 2 * 60 * 60 * 1000).toISOString()
  }, NOW_MS), /expiry values must be present and identical/);

  const tooFar = new Date(NOW_MS + MAX_TEMPORARY_STAFF_LOGIN_WINDOW_MS + 1).toISOString();
  assert.throws(() => assertSafeTemporaryStaffLoginEnvironment({
    ...validEnvironment,
    AUTH_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: tooFar,
    NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: tooFar
  }, NOW_MS), /cannot be enabled for more than 24 hours/);
});

test("an expired window keeps configuration loadable but denies new password logins", () => {
  const expired = new Date(NOW_MS - 1).toISOString();
  const environment = {
    ...validEnvironment,
    AUTH_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: expired,
    NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: expired
  };

  assert.doesNotThrow(() => assertSafeTemporaryStaffLoginEnvironment(environment, NOW_MS));
  assert.equal(temporaryStaffLoginExpirationMs(environment, NOW_MS), null);
});

test("temporary Production identity is the exact staff email with the STAFF role", () => {
  assert.equal(isTemporaryProductionStaffIdentity(TEMPORARY_PRODUCTION_STAFF_EMAIL, "STAFF"), true);
  assert.equal(isTemporaryProductionStaffIdentity("student@wesleyan.edu.ph", "STAFF"), false);
  assert.equal(isTemporaryProductionStaffIdentity(TEMPORARY_PRODUCTION_STAFF_EMAIL, "ADMIN"), false);
});
