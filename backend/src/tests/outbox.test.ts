import assert from "node:assert/strict";
import test from "node:test";
import { outboxRetryDelayMs } from "../services/outbox.service.js";

test("outbox retries back off and cap at one hour", () => {
  assert.equal(outboxRetryDelayMs(1), 5_000);
  assert.equal(outboxRetryDelayMs(2), 10_000);
  assert.equal(outboxRetryDelayMs(20), 60 * 60 * 1000);
});
