import assert from "node:assert/strict";
import { apiErrorMessage, userFacingErrorMessage } from "../lib/user-facing-error.ts";

assert.equal(
  apiErrorMessage({ status: 500, serverMessage: "Internal server error.", requestId: "req-123" }),
  "WESCOMM could not complete this request right now. Please try again. Support reference: req-123."
);
assert.equal(
  apiErrorMessage({ status: 401, serverMessage: "Invalid or expired token." }),
  "Your session has expired. Sign in again to continue."
);
assert.equal(
  apiErrorMessage({ status: 400, code: "SKU_AWARE_STOCK_UPDATE_REQUIRED", serverMessage: "Use SKU inventory." }),
  "Update stock by size or option combination."
);
assert.equal(
  apiErrorMessage({ status: 409, serverMessage: "This reservation is already paid." }),
  "This reservation is already paid."
);
assert.equal(
  apiErrorMessage({ status: 428, code: "POLICY_ACCEPTANCE_REQUIRED", serverMessage: "stale version" }),
  "Review and accept the current WESCOMM policies before continuing."
);
assert.equal(
  userFacingErrorMessage(new Error("Database schema failed."), "Unable to load this page."),
  "Unable to load this page."
);
assert.equal(
  userFacingErrorMessage(new Error("Please allow notifications in your browser settings."), "Unable to enable notifications."),
  "Please allow notifications in your browser settings."
);

console.log("User-facing error mapping tests passed.");
