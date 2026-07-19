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
  DIRECT_URL: "postgresql://postgres:postgres@example.invalid:5432/postgres?sslmode=require"
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
