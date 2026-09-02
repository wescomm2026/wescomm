import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  ACCOUNT_POLICY_VERSION,
  CHECKOUT_POLICY_VERSION,
  assertCurrentAccountPolicyAcceptance,
  assertCurrentCheckoutPolicyAcceptance
} from "../domain/policy-acceptance.js";
import { HttpError } from "../utils/http-error.js";

function expectPolicyAcceptanceRequired(action: () => unknown, expectedVersion: string) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 428);
    assert.equal(error.code, "POLICY_ACCEPTANCE_REQUIRED");
    assert.equal(error.details?.expectedVersion, expectedVersion);
    return true;
  });
}

test("current account policy acceptance is accepted", () => {
  assert.equal(
    assertCurrentAccountPolicyAcceptance({ accepted: true, version: ACCOUNT_POLICY_VERSION }),
    ACCOUNT_POLICY_VERSION
  );
});

test("missing or stale account policy acceptance is rejected", () => {
  expectPolicyAcceptanceRequired(() => assertCurrentAccountPolicyAcceptance(undefined), ACCOUNT_POLICY_VERSION);
  expectPolicyAcceptanceRequired(
    () => assertCurrentAccountPolicyAcceptance({ accepted: false, version: ACCOUNT_POLICY_VERSION }),
    ACCOUNT_POLICY_VERSION
  );
  expectPolicyAcceptanceRequired(
    () => assertCurrentAccountPolicyAcceptance({ accepted: true, version: "2026-08-01" }),
    ACCOUNT_POLICY_VERSION
  );
});

test("current checkout policy acceptance is accepted", () => {
  assert.equal(
    assertCurrentCheckoutPolicyAcceptance({ accepted: true, version: CHECKOUT_POLICY_VERSION }),
    CHECKOUT_POLICY_VERSION
  );
});

test("missing or stale checkout policy acceptance is rejected", () => {
  expectPolicyAcceptanceRequired(() => assertCurrentCheckoutPolicyAcceptance(undefined), CHECKOUT_POLICY_VERSION);
  expectPolicyAcceptanceRequired(
    () => assertCurrentCheckoutPolicyAcceptance({ accepted: false, version: CHECKOUT_POLICY_VERSION }),
    CHECKOUT_POLICY_VERSION
  );
  expectPolicyAcceptanceRequired(
    () => assertCurrentCheckoutPolicyAcceptance({ accepted: true, version: "2026-08-01" }),
    CHECKOUT_POLICY_VERSION
  );
});

test("frontend and backend policy versions stay synchronized", () => {
  const frontendPolicySource = readFileSync(
    path.resolve(process.cwd(), "../frontend/lib/policy-consent.ts"),
    "utf8"
  );

  assert.match(
    frontendPolicySource,
    new RegExp(`ACCOUNT_POLICY_VERSION\\s*=\\s*["']${ACCOUNT_POLICY_VERSION}["']`)
  );
  assert.match(
    frontendPolicySource,
    new RegExp(`CHECKOUT_POLICY_VERSION\\s*=\\s*["']${CHECKOUT_POLICY_VERSION}["']`)
  );
});
