// Unit tests must not depend on a developer's .env file or real Supabase
// credentials. Set inert defaults before dynamically loading modules that
// initialize the application configuration at import time.
process.env.NODE_ENV = "test";
process.env.DOTENV_CONFIG_PATH = "__wescomm_unit_test_no_env_file__";
const runDatabaseIntegrationTests = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const requiredDatabaseConfirmation = "I_CONFIRM_LOCAL_WESCOMM_TEST_DATABASE";
const inertDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:1/wescomm_unit_test?schema=public";

function isolatedIntegrationDatabaseUrl() {
  if (!runDatabaseIntegrationTests) return inertDatabaseUrl;
  if (process.env.WESCOMM_RUN_ISOLATED_DB_TESTS !== requiredDatabaseConfirmation) {
    throw new Error("Database integration tests require the explicit isolated-database confirmation.");
  }
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value) throw new Error("Database integration tests require TEST_DATABASE_URL.");

  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, "")).toLowerCase();
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname.toLowerCase())
    || !databaseName.includes("wescomm")
    || !/(^|[_-])(test|ci|sandbox)([_-]|$)/.test(databaseName)
    || (parsed.searchParams.get("schema") ?? "public") !== "public"
  ) {
    throw new Error("Database integration tests accept only a local WESCOMM test/ci/sandbox database in public schema.");
  }
  return value;
}

// Always replace inherited shell/.env service values. Unit tests point at an
// unreachable loopback port; explicitly opted-in integration tests use only
// the separately named and validated TEST_DATABASE_URL.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "wescomm-unit-test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "wescomm-unit-test-service-role-key";
process.env.DATABASE_URL = isolatedIntegrationDatabaseUrl();
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.FRONTEND_ORIGIN = "http://127.0.0.1:3000";
process.env.FRONTEND_ORIGINS = "http://127.0.0.1:3000";
process.env.AUTH_ENABLE_DEV_LOGIN = "false";
process.env.AUTH_DEV_LOGIN_PASSWORD = "wescomm-ci-test-password";
process.env.AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN = "false";
process.env.NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN = "false";
process.env.PAYMONGO_ENABLED = "false";
process.env.PAYMONGO_SECRET_KEY = "";
process.env.PAYMONGO_WEBHOOK_SECRET = "";
process.env.PAYMONGO_LIVEMODE = "false";
process.env.PAYMONGO_RETURN_ORIGIN = "http://127.0.0.1:3000";
process.env.PAYMONGO_CHECKOUT_TTL_MINUTES = "30";
process.env.PAYMENT_MAINTENANCE_SECRET = "";
process.env.VAPID_PUBLIC_KEY = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.DATA_ENCRYPTION_KEYS = "v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.DATA_ENCRYPTION_CURRENT_VERSION = "v1";
process.env.WESBOT_ENABLED = "false";
process.env.WESBOT_AI_ENABLED = "false";
process.env.WESBOT_AI_REWRITE_ENABLED = "false";
process.env.WESBOT_SEMANTIC_MODE = "off";
process.env.WESBOT_AI_TIMEOUT_MS = "12000";
process.env.WESBOT_MODEL = "gemini-3.5-flash-lite";
process.env.WESBOT_BUDGET_ENFORCEMENT_ENABLED = "true";
process.env.WESBOT_MONTHLY_BUDGET_USD = "10";
process.env.WESBOT_REQUEST_RESERVE_USD = "0.01";
process.env.WESBOT_PRICING_VERSION = "gemini-3.5-flash-lite-standard-2026-08";
process.env.WESBOT_INPUT_USD_PER_1M_TOKENS = "0.30";
process.env.WESBOT_CACHED_INPUT_USD_PER_1M_TOKENS = "0.03";
process.env.WESBOT_OUTPUT_USD_PER_1M_TOKENS = "2.50";
process.env.GEMINI_API_KEY = "";

await import("./auth-email-policy.test.js");
await import("./auth-method-policy.test.js");
await import("./auth-session.test.js");
await import("./session-exchange-security.test.js");
await import("./deployment-environment.test.js");
await import("./env-config.test.js");
await import("./product-pricing.test.js");
await import("./temporary-staff-login-policy.test.js");
await import("./rate-limit.test.js");
await import("./request-security.test.js");
await import("./profile-security.test.js");
await import("./policy-acceptance.test.js");
await import("./database-url.test.js");
await import("./http-error.test.js");
await import("./public-error.test.js");
await import("./api-contract.test.js");
await import("./supabase-fetch.test.js");
await import("./prisma-retry.test.js");
await import("./cursor-pagination.test.js");
await import("./outbox.test.js");
await import("./realtime-pagination-architecture.test.js");
await import("./performance-architecture.test.js");
await import("./inventory-live-availability.test.js");
await import("./variant-stock.test.js");
await import("./sku-inventory.test.js");
await import("./inventory-safety-v9.test.js");
await import("./restriction-transaction.test.js");
await import("./user-role-concurrency.test.js");
await import("./reservation-safety.test.js");
await import("./pickup-schedule.test.js");
await import("./reservation-state.test.js");
await import("./student-reservation-cancellation.test.js");
await import("./wesbot.test.js");
await import("./wesbot-ai-usage.test.js");
await import("./public-receipt.test.js");
await import("./receipt-integrity.test.js");
await import("./report-range.test.js");
await import("./operations-v2-architecture.test.js");
await import("./operations-lifecycle-architecture.test.js");
await import("./conversation-retention.test.js");
await import("./online-payment.test.js");
await import("./paymongo-webhook.test.js");
await import("./paymongo-payment-validation.test.js");
await import("./paymongo-lifecycle-safety.test.js");
await import("./paymongo-migration.test.js");
await import("./paymongo-client.test.js");
await import("./paymongo-security.test.js");
await import("./wishlist-migration.test.js");
await import("./wishlist-policy.test.js");
await import("./wishlist-notification.test.js");
await import("./wishlist-service.test.js");
if (process.env.RUN_DATABASE_INTEGRATION_TESTS === "true") {
  await import("./rate-limit-postgres.integration.test.js");
  await import("./receipt-postgres.integration.test.js");
  await import("./wishlist-postgres.integration.test.js");
  await import("./conversation-archive-postgres.integration.test.js");
  await import("./conversation-message-edit-postgres.integration.test.js");
}
await import("./security.test.js");
