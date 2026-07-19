import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_SESSION_TRANSACTION_OPTIONS } from "../services/auth-session.service.js";

test("session issuance has a bounded pool wait and remote-database execution budget", () => {
  assert.deepEqual(AUTH_SESSION_TRANSACTION_OPTIONS, {
    maxWait: 10_000,
    timeout: 20_000
  });
  assert.equal(Object.isFrozen(AUTH_SESSION_TRANSACTION_OPTIONS), true);
});
