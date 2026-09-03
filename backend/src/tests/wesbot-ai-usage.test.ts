import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
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

test("WesBot usage cost applies the lower configured cached-input rate", () => {
  const cost = estimateWesbotCostUsd({ inputTokens: 1_000, cachedInputTokens: 400, outputTokens: 350 });
  assert.ok(Math.abs(cost - 0.001067) < 0.000000001);
});

test("WesBot monthly usage boundaries follow Asia/Manila calendar months", () => {
  const range = wesbotUsageMonthRange(new Date("2026-08-31T23:00:00.000Z"));
  assert.equal(range.start.toISOString(), "2026-08-31T16:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-09-30T16:00:00.000Z");
});

test("WesBot budget health exposes clear warning and cutoff states", () => {
  assert.equal(wesbotBudgetHealth({ enabled: false, spentUsd: 0, budgetUsd: 10 }), "DISABLED");
  assert.equal(wesbotBudgetHealth({ enabled: true, spentUsd: 7.99, budgetUsd: 10 }), "HEALTHY");
  assert.equal(wesbotBudgetHealth({ enabled: true, spentUsd: 8, budgetUsd: 10 }), "WATCH");
  assert.equal(wesbotBudgetHealth({ enabled: true, spentUsd: 9, budgetUsd: 10 }), "CRITICAL");
  assert.equal(wesbotBudgetHealth({ enabled: true, spentUsd: 10, budgetUsd: 10 }), "PAUSED");
});

test("WesBot provider errors are categorized without storing provider messages", () => {
  assert.equal(wesbotAiErrorCode(new Error("429 RESOURCE_EXHAUSTED quota exceeded")), "RATE_LIMITED");
  assert.equal(wesbotAiErrorCode(new Error("Request timed out")), "TIMEOUT");
  assert.equal(wesbotAiErrorCode(new Error("Invalid API key")), "AUTHENTICATION");
  assert.equal(wesbotAiErrorCode(new Error("Unexpected response")), "PROVIDER_ERROR");
});

test("WesBot budget reservations are serialized and pricing is snapshotted per call", () => {
  const service = readFileSync(path.resolve(process.cwd(), "src/services/wesbot-ai-usage.service.ts"), "utf8");
  const migration = readFileSync(
    new URL("../../prisma/migrations/20260830120000_upgrade_wesbot_ai_budget_tracking/migration.sql", import.meta.url),
    "utf8"
  );
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /isolationLevel: "Serializable"/);
  assert.match(service, /committedUsd \+ reserveUsd > env\.WESBOT_MONTHLY_BUDGET_USD/);
  assert.match(migration, /"reserved_cost_usd" DECIMAL\(14, 8\)/);
  assert.match(migration, /"pricing_version" TEXT NOT NULL/);
});
