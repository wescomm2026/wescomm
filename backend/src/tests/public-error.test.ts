import assert from "node:assert/strict";
import test from "node:test";
import { publicErrorDetails, publicErrorMessage } from "../utils/public-error.js";

test("public errors replace infrastructure wording with plain language", () => {
  assert.equal(
    publicErrorMessage({ status: 500, message: "Database connection failed." }),
    "WESCOMM could not complete this request right now. Please try again."
  );
  assert.equal(
    publicErrorMessage({ status: 400, message: "Invalid PayMongo checkout session identifier." }),
    "Some information is missing or invalid. Review your entries and try again."
  );
  assert.equal(
    publicErrorMessage({ status: 404, message: "Route not found." }),
    "We could not find what you requested."
  );
});

test("public errors preserve safe and actionable business messages", () => {
  assert.equal(
    publicErrorMessage({ status: 409, message: "This reservation is already paid." }),
    "This reservation is already paid."
  );
  assert.equal(
    publicErrorMessage({ status: 400, message: "Product category is required." }),
    "Product category is required."
  );
});

test("public errors turn authentication internals into clear access guidance", () => {
  assert.equal(
    publicErrorMessage({ status: 401, message: "Invalid or expired token." }),
    "Your session has expired. Sign in again to continue."
  );
  assert.equal(
    publicErrorMessage({ status: 403, message: "User profile was not found." }),
    "You do not have permission to perform this action."
  );
  assert.equal(
    publicErrorMessage({ status: 403, message: "Use an approved school account email domain: wesleyan.edu.ph." }),
    "Use an approved school account email domain: wesleyan.edu.ph."
  );
});

test("public errors map technical codes to stakeholder actions", () => {
  assert.equal(
    publicErrorMessage({
      status: 400,
      code: "SKU_AWARE_STOCK_UPDATE_REQUIRED",
      message: "Use Update stock to change SKU inventory totals."
    }),
    "Update stock by size or option combination."
  );
  assert.equal(
    publicErrorMessage({
      status: 409,
      code: "INVALID_CURSOR",
      message: "The pagination cursor is invalid or expired."
    }),
    "This list changed while you were viewing it. Refresh the page and try again."
  );
  assert.equal(
    publicErrorMessage({
      status: 428,
      code: "POLICY_ACCEPTANCE_REQUIRED",
      message: "stale version"
    }),
    "Review and accept the current WESCOMM policies before continuing."
  );
});

test("public error details expose retry guidance only", () => {
  assert.deepEqual(
    publicErrorDetails({ retryable: true, providerCheckoutSessionId: "cs_private", outcomeUnknown: true }),
    { retryable: true }
  );
  assert.equal(publicErrorDetails({ providerCheckoutSessionId: "cs_private" }), undefined);
});
