import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateWesbotCostUsd,
  wesbotAiErrorCode,
  wesbotBudgetHealth,
  wesbotUsageMonthRange
} from "../services/wesbot-ai-usage.service.js";

test("WesBot usage cost follows the configured Gemini input and output rates", () => {
  const cost = estimateWesbotCostUsd({ inputTokens: 1_000, outputTokens: 350 });
  assert.ok(Math.abs(cost - 0.001175) < 0.000000001);
});

test("WesBot monthly usage boundaries follow Asia/Manila calendar months", () => {
  const range = wesbotUsageMonthRange(new Date("2026-08-31T23:00:00.000Z"));
  assert.equal(range.start.toISOString(), "2026-08-31T16:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-09-30T16:00:00.000Z");
});

test("WesBot budget health exposes clear warning and cutoff states", () => {
  assert.equal(wesbotBudgetHealth({ enabled: false, spentUsd: 0, budgetUsd: 5 }), "DISABLED");
  assert.equal(wesbotBudgetHealth({ enabled: true, spentUsd: 3.99, budgetUsd: 5 }), "HEALTHY");
  assert.equal(wesbotBudgetHealth({ enabled: true, spentUsd: 4, budgetUsd: 5 }), "WATCH");
  assert.equal(wesbotBudgetHealth({ enabled: true, spentUsd: 4.5, budgetUsd: 5 }), "CRITICAL");
  assert.equal(wesbotBudgetHealth({ enabled: true, spentUsd: 5, budgetUsd: 5 }), "PAUSED");
});

test("WesBot provider errors are categorized without storing provider messages", () => {
  assert.equal(wesbotAiErrorCode(new Error("429 RESOURCE_EXHAUSTED quota exceeded")), "RATE_LIMITED");
  assert.equal(wesbotAiErrorCode(new Error("Request timed out")), "TIMEOUT");
  assert.equal(wesbotAiErrorCode(new Error("Invalid API key")), "AUTHENTICATION");
  assert.equal(wesbotAiErrorCode(new Error("Unexpected response")), "PROVIDER_ERROR");
});
