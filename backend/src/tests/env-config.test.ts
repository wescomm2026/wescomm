import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const configModuleUrl = new URL("../config/env.js", import.meta.url).href;
const encryptionKey = Buffer.alloc(32, 7).toString("base64");

const safeProductionEnvironment = {
  ...process.env,
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
  FRONTEND_ORIGIN: "https://wescomm-qa.example",
  FRONTEND_ORIGINS: "https://wescomm-qa.example",
  AUTH_ALLOWED_EMAIL_DOMAINS: "wesleyan.edu.ph",
  AUTH_ALLOWED_AUTH_METHODS: "otp,magiclink,email/signup,token_refresh",
  AUTH_ENABLE_DEV_LOGIN: "true",
  AUTH_DEV_LOGIN_PASSWORD: "preview-only-password",
  DATA_ENCRYPTION_CURRENT_VERSION: "v1",
  DATA_ENCRYPTION_KEYS: `v1:${encryptionKey}`,
  NEXT_PUBLIC_SUPABASE_URL: "https://wescomm-qa.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "qa-public-key",
  SUPABASE_SERVICE_ROLE_KEY: "qa-service-role-key",
  DATABASE_URL: "postgresql://postgres:postgres@example.invalid:5432/postgres?sslmode=require",
  DIRECT_URL: "postgresql://postgres:postgres@example.invalid:5432/postgres?sslmode=require",
  PAYMONGO_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "",
  PAYMONGO_WEBHOOK_SECRET: "",
  PAYMONGO_LIVEMODE: "false",
  PAYMONGO_RETURN_ORIGIN: "",
  PAYMENT_MAINTENANCE_SECRET: "wescomm-maintenance-secret-at-least-32-characters"
};

function loadConfig(overrides: Record<string, string>) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const { env } = await import(${JSON.stringify(configModuleUrl)}); process.stdout.write(String(env.IS_PRODUCTION_DEPLOYMENT));`
    ],
    {
      env: { ...safeProductionEnvironment, ...overrides },
      encoding: "utf8"
    }
  );
}

test("the parsed Vercel Preview environment permits the isolated test login", () => {
  const result = loadConfig({ VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "false");
});

test("the parsed Vercel Production environment rejects the test login", () => {
  const result = loadConfig({ VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /AUTH_ENABLE_DEV_LOGIN must be false in production deployments/);
});

test("the parsed Vercel Production environment accepts only synchronized temporary staff login settings", () => {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const result = loadConfig({
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production",
    AUTH_ENABLE_DEV_LOGIN: "false",
    AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: "true",
    AUTH_TEMP_PRODUCTION_STAFF_LOGIN_PASSWORD: "temporary-production-password",
    AUTH_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: expiresAt,
    NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: "true",
    NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: expiresAt
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "true");
});

test("the parsed Vercel Production environment rejects a one-sided temporary staff login flag", () => {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const result = loadConfig({
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production",
    AUTH_ENABLE_DEV_LOGIN: "false",
    AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: "true",
    AUTH_TEMP_PRODUCTION_STAFF_LOGIN_PASSWORD: "temporary-production-password",
    AUTH_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: expiresAt,
    NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: "false",
    NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: expiresAt
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /flags must be enabled together/);
});

test("disabled PayMongo configuration does not require provider secrets", () => {
  const result = loadConfig({
    PAYMONGO_ENABLED: "false",
    PAYMONGO_SECRET_KEY: "",
    PAYMONGO_WEBHOOK_SECRET: "",
    PAYMONGO_LIVEMODE: "false"
  });

  assert.equal(result.status, 0, result.stderr);
});

test("database-grounded WesBot works without a Gemini credential", () => {
  const result = loadConfig({
    WESBOT_ENABLED: "true",
    WESBOT_AI_ENABLED: "false",
    GEMINI_API_KEY: ""
  });

  assert.equal(result.status, 0, result.stderr);
});

test("semantic routing and AI rewrites stay fail-closed behind the AI feature boundary", () => {
  const semanticWithoutAi = loadConfig({
    WESBOT_ENABLED: "true",
    WESBOT_AI_ENABLED: "false",
    WESBOT_SEMANTIC_MODE: "active"
  });
  assert.notEqual(semanticWithoutAi.status, 0);
  assert.match(`${semanticWithoutAi.stdout}\n${semanticWithoutAi.stderr}`, /WESBOT_SEMANTIC_MODE/);

  const rewriteWithoutAi = loadConfig({
    WESBOT_ENABLED: "true",
    WESBOT_AI_ENABLED: "false",
    WESBOT_AI_REWRITE_ENABLED: "true"
  });
  assert.notEqual(rewriteWithoutAi.status, 0);
  assert.match(`${rewriteWithoutAi.stdout}\n${rewriteWithoutAi.stderr}`, /WESBOT_AI_REWRITE_ENABLED/);

  const boundedTimeout = loadConfig({ WESBOT_AI_TIMEOUT_MS: "999" });
  assert.notEqual(boundedTimeout.status, 0);
});

test("optional WesBot AI polish fails closed without Gemini authentication", () => {
  const botDisabled = loadConfig({
    WESBOT_ENABLED: "false",
    WESBOT_AI_ENABLED: "true",
    GEMINI_API_KEY: "wesbot-test-key"
  });
  assert.notEqual(botDisabled.status, 0);
  assert.match(`${botDisabled.stdout}\n${botDisabled.stderr}`, /requires WESBOT_ENABLED/);

  const missingGemini = loadConfig({
    WESBOT_ENABLED: "true",
    WESBOT_AI_ENABLED: "true",
    GEMINI_API_KEY: ""
  });
  assert.notEqual(missingGemini.status, 0);
  assert.match(`${missingGemini.stdout}\n${missingGemini.stderr}`, /GEMINI_API_KEY is required/);

  const invalidModel = loadConfig({
    WESBOT_ENABLED: "true",
    WESBOT_AI_ENABLED: "true",
    WESBOT_MODEL: "invalid-model",
    GEMINI_API_KEY: "wesbot-test-key"
  });
  assert.notEqual(invalidModel.status, 0);
  assert.match(`${invalidModel.stdout}\n${invalidModel.stderr}`, /Gemini model identifier/);

  const authenticated = loadConfig({
    WESBOT_ENABLED: "true",
    WESBOT_AI_ENABLED: "true",
    WESBOT_MODEL: "gemini-3.5-flash-lite",
    GEMINI_API_KEY: "wesbot-test-key"
  });
  assert.equal(authenticated.status, 0, authenticated.stderr);
});

test("disabled checkout still validates webhook mode and any configured signing secret", () => {
  const weakSecret = loadConfig({
    PAYMONGO_ENABLED: "false",
    PAYMONGO_WEBHOOK_SECRET: "too-short"
  });
  assert.notEqual(weakSecret.status, 0);
  assert.match(`${weakSecret.stdout}\n${weakSecret.stderr}`, /at least 16 characters/);

  const previewLiveWebhook = loadConfig({
    PAYMONGO_ENABLED: "false",
    PAYMONGO_WEBHOOK_SECRET: "whsec_wescomm_live_example",
    PAYMONGO_LIVEMODE: "true"
  });
  assert.notEqual(previewLiveWebhook.status, 0);
  assert.match(`${previewLiveWebhook.stdout}\n${previewLiveWebhook.stderr}`, /allowed only in the production deployment/);
});

test("PayMongo test mode accepts only a test secret and a sufficiently long webhook secret", () => {
  const valid = loadConfig({
    PAYMONGO_ENABLED: "true",
    PAYMONGO_SECRET_KEY: "sk_test_wescomm_example",
    PAYMONGO_WEBHOOK_SECRET: "whsec_wescomm_test_example",
    PAYMONGO_LIVEMODE: "false"
  });
  assert.equal(valid.status, 0, valid.stderr);

  const wrongPrefix = loadConfig({
    PAYMONGO_ENABLED: "true",
    PAYMONGO_SECRET_KEY: "sk_live_wescomm_example",
    PAYMONGO_WEBHOOK_SECRET: "whsec_wescomm_test_example",
    PAYMONGO_LIVEMODE: "false"
  });
  assert.notEqual(wrongPrefix.status, 0);
  assert.match(`${wrongPrefix.stdout}\n${wrongPrefix.stderr}`, /must start with sk_test_/);
});

test("enabled PayMongo configuration fails closed when either secret is absent or weak", () => {
  const missingApiKey = loadConfig({
    PAYMONGO_ENABLED: "true",
    PAYMONGO_SECRET_KEY: "",
    PAYMONGO_WEBHOOK_SECRET: "whsec_wescomm_test_example"
  });
  assert.notEqual(missingApiKey.status, 0);
  assert.match(`${missingApiKey.stdout}\n${missingApiKey.stderr}`, /PAYMONGO_SECRET_KEY is required/);

  const weakWebhookSecret = loadConfig({
    PAYMONGO_ENABLED: "true",
    PAYMONGO_SECRET_KEY: "sk_test_wescomm_example",
    PAYMONGO_WEBHOOK_SECRET: "too-short"
  });
  assert.notEqual(weakWebhookSecret.status, 0);
  assert.match(`${weakWebhookSecret.stdout}\n${weakWebhookSecret.stderr}`, /at least 16 characters/);
});

test("production PayMongo fails closed without the external maintenance secret", () => {
  const missingMaintenanceSecret = loadConfig({
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production",
    AUTH_ENABLE_DEV_LOGIN: "false",
    PAYMONGO_ENABLED: "true",
    PAYMONGO_SECRET_KEY: "sk_test_wescomm_example",
    PAYMONGO_WEBHOOK_SECRET: "whsec_wescomm_test_example",
    PAYMONGO_LIVEMODE: "false",
    PAYMENT_MAINTENANCE_SECRET: ""
  });
  assert.notEqual(missingMaintenanceSecret.status, 0);
  assert.match(`${missingMaintenanceSecret.stdout}\n${missingMaintenanceSecret.stderr}`, /PAYMENT_MAINTENANCE_SECRET.*required/);

  const weakMaintenanceSecret = loadConfig({
    PAYMENT_MAINTENANCE_SECRET: "too-short"
  });
  assert.notEqual(weakMaintenanceSecret.status, 0);
  assert.match(`${weakMaintenanceSecret.stdout}\n${weakMaintenanceSecret.stderr}`, /at least 32 characters/);
});

test("PayMongo return URLs must be approved frontend origins without paths or query strings", () => {
  const outsideOrigin = loadConfig({
    PAYMONGO_RETURN_ORIGIN: "https://payments-attacker.example"
  });
  assert.notEqual(outsideOrigin.status, 0);
  assert.match(`${outsideOrigin.stdout}\n${outsideOrigin.stderr}`, /must match an origin in FRONTEND_ORIGINS/);

  const pathOrigin = loadConfig({
    FRONTEND_ORIGINS: "https://wescomm-qa.example",
    PAYMONGO_RETURN_ORIGIN: "https://wescomm-qa.example/redirect"
  });
  assert.notEqual(pathOrigin.status, 0);
  assert.match(`${pathOrigin.stdout}\n${pathOrigin.stderr}`, /must contain only an approved frontend origin/);
});

test("PayMongo live mode is rejected outside production and accepts the matching key in production", () => {
  const preview = loadConfig({
    PAYMONGO_ENABLED: "true",
    PAYMONGO_SECRET_KEY: "sk_live_wescomm_example",
    PAYMONGO_WEBHOOK_SECRET: "whsec_wescomm_live_example",
    PAYMONGO_LIVEMODE: "true"
  });
  assert.notEqual(preview.status, 0);
  assert.match(`${preview.stdout}\n${preview.stderr}`, /allowed only in the production deployment/);

  const production = loadConfig({
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production",
    AUTH_ENABLE_DEV_LOGIN: "false",
    AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: "false",
    NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: "false",
    PAYMONGO_ENABLED: "true",
    PAYMONGO_SECRET_KEY: "sk_live_wescomm_example",
    PAYMONGO_WEBHOOK_SECRET: "whsec_wescomm_live_example",
    PAYMONGO_LIVEMODE: "true"
  });
  assert.equal(production.status, 0, production.stderr);
  assert.equal(production.stdout, "true");
});
