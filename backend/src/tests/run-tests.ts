// Unit tests must not depend on a developer's .env file or real Supabase
// credentials. Set inert defaults before dynamically loading modules that
// initialize the application configuration at import time.
process.env.NODE_ENV = "test";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://wescomm-test.supabase.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "wescomm-ci-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "wescomm-ci-service-role-key";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/wescomm_test?schema=public";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.AUTH_ENABLE_DEV_LOGIN = "false";
process.env.AUTH_DEV_LOGIN_PASSWORD = "wescomm-ci-test-password";
process.env.AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN = "false";
process.env.NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN = "false";

await import("./auth-email-policy.test.js");
await import("./auth-method-policy.test.js");
await import("./auth-session.test.js");
await import("./session-exchange-security.test.js");
await import("./deployment-environment.test.js");
await import("./env-config.test.js");
await import("./temporary-staff-login-policy.test.js");
await import("./rate-limit.test.js");
await import("./request-security.test.js");
await import("./profile-security.test.js");
await import("./database-url.test.js");
await import("./http-error.test.js");
await import("./supabase-fetch.test.js");
await import("./prisma-retry.test.js");
await import("./restriction-transaction.test.js");
await import("./user-role-concurrency.test.js");
await import("./reservation-safety.test.js");
await import("./reservation-state.test.js");
await import("./wishlist-migration.test.js");
await import("./wishlist-policy.test.js");
await import("./wishlist-notification.test.js");
await import("./wishlist-service.test.js");
if (process.env.RUN_DATABASE_INTEGRATION_TESTS === "true") {
  await import("./wishlist-postgres.integration.test.js");
}
await import("./security.test.js");
