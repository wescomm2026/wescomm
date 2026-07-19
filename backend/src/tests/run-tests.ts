// Unit tests must not depend on a developer's .env file or real Supabase
// credentials. Set inert defaults before dynamically loading modules that
// initialize the application configuration at import time.
process.env.NODE_ENV = "test";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://wescomm-test.supabase.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "wescomm-ci-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "wescomm-ci-service-role-key";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/wescomm_test?schema=public";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;

await import("./auth-email-policy.test.js");
await import("./auth-method-policy.test.js");
await import("./rate-limit.test.js");
await import("./request-security.test.js");
await import("./profile-security.test.js");
await import("./restriction-transaction.test.js");
await import("./user-role-concurrency.test.js");
await import("./reservation-safety.test.js");
await import("./reservation-state.test.js");
await import("./security.test.js");
