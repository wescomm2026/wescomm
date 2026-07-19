import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAuthenticationMethods,
  normalizeAllowedAuthMethods,
  readAuthenticationMethods
} from "../domain/auth-method-policy.js";

const passwordlessMethods = normalizeAllowedAuthMethods(" otp, magiclink,email/signup,token_refresh,OTP ");

test("allowed auth methods are normalized and deduplicated", () => {
  assert.deepEqual(passwordlessMethods, ["otp", "magiclink", "email/signup", "token_refresh"]);
  assert.deepEqual(readAuthenticationMethods([
    { method: "OTP", timestamp: 1 },
    "token_refresh"
  ]), ["otp", "token_refresh"]);
});

test("passwordless OTP and refreshed OTP sessions pass the auth-method policy", () => {
  assert.equal(evaluateAuthenticationMethods([{ method: "otp" }], passwordlessMethods).allowed, true);
  assert.equal(evaluateAuthenticationMethods([{ method: "email/signup" }], passwordlessMethods).allowed, true);
  assert.equal(evaluateAuthenticationMethods([
    { method: "otp" },
    { method: "token_refresh" }
  ], passwordlessMethods).allowed, true);
});

test("password, missing, malformed, and unlisted auth methods fail closed", () => {
  assert.equal(evaluateAuthenticationMethods([{ method: "password" }], passwordlessMethods).reason, "PASSWORD");
  assert.equal(evaluateAuthenticationMethods(undefined, passwordlessMethods).reason, "MISSING");
  assert.equal(evaluateAuthenticationMethods([{ timestamp: 1 }], passwordlessMethods).reason, "MISSING");
  assert.equal(evaluateAuthenticationMethods([{ method: "oauth" }], passwordlessMethods).reason, "NOT_ALLOWED");
  assert.equal(
    evaluateAuthenticationMethods([{ method: "token_refresh" }], passwordlessMethods).reason,
    "MISSING_PRIMARY"
  );
});
