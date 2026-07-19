import assert from "node:assert/strict";
import {
  assertSafeProductionPublicFlags,
  isProductionDeploymentEnvironment,
  isVerifiedVercelProductionEnvironment
} from "../next.config.mjs";
import {
  TEMPORARY_PRODUCTION_STAFF_EMAIL,
  isTemporaryProductionStaffPasswordLoginAvailable,
  passwordLoginTarget
} from "../lib/password-login-policy.mjs";

const nowMs = Date.parse("2026-07-19T12:00:00.000Z");
const validTemporaryExpiration = new Date(nowMs + 60 * 60 * 1000).toISOString();

assert.equal(
  isProductionDeploymentEnvironment({ NEXT_PUBLIC_APP_ENV: "production" }),
  true,
  "NEXT_PUBLIC_APP_ENV must identify production deployments"
);
assert.equal(
  isVerifiedVercelProductionEnvironment({
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production"
  }),
  true,
  "temporary staff login must recognize only verified Vercel Production"
);
assert.equal(
  isProductionDeploymentEnvironment({ VERCEL: "1", VERCEL_ENV: "production" }),
  true,
  "VERCEL_ENV must identify production deployments even when the public flag is absent"
);
assert.equal(
  isProductionDeploymentEnvironment({ VERCEL: "1", VERCEL_TARGET_ENV: "production" }),
  true,
  "VERCEL_TARGET_ENV must identify production deployments"
);
assert.equal(
  isProductionDeploymentEnvironment({ NODE_ENV: "production", NEXT_PUBLIC_APP_ENV: "development", VERCEL: "1", VERCEL_ENV: "preview" }),
  false,
  "preview and development environments must remain non-production"
);
assert.equal(
  isProductionDeploymentEnvironment({ NODE_ENV: "production", VERCEL: "1", VERCEL_TARGET_ENV: "staging" }),
  true,
  "a custom target without an explicit Vercel Preview marker must fail closed"
);
assert.equal(
  isProductionDeploymentEnvironment({ NODE_ENV: "production", NEXT_PUBLIC_APP_ENV: "development" }),
  true,
  "a non-Vercel production build must fail closed even when a public label says development"
);
assert.equal(
  isProductionDeploymentEnvironment({ NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "production" }),
  true,
  "conflicting environment markers must be treated as production"
);

assert.doesNotThrow(() => {
  assertSafeProductionPublicFlags({
    VERCEL: "1",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_ENABLE_DEV_LOGIN: "false",
    NEXT_PUBLIC_E2E_TEST: "false"
  });
});
assert.doesNotThrow(() => {
  assertSafeProductionPublicFlags({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_ENABLE_DEV_LOGIN: "true",
    NEXT_PUBLIC_E2E_TEST: "false"
  });
});
assert.throws(
  () => assertSafeProductionPublicFlags({
    VERCEL: "1",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_ENABLE_DEV_LOGIN: "true"
  }),
  /NEXT_PUBLIC_ENABLE_DEV_LOGIN must be false/
);

assert.doesNotThrow(() => {
  assertSafeProductionPublicFlags({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production",
    NEXT_PUBLIC_ENABLE_DEV_LOGIN: "false",
    NEXT_PUBLIC_E2E_TEST: "false",
    NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: "true",
    NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: validTemporaryExpiration
  }, nowMs);
});
assert.throws(
  () => assertSafeProductionPublicFlags({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_TARGET_ENV: "preview",
    NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: "true",
    NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: validTemporaryExpiration
  }, nowMs),
  /requires verified Vercel Production/
);
assert.throws(
  () => assertSafeProductionPublicFlags({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production",
    NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: "true"
  }, nowMs),
  /requires a future ISO-8601 expiry/
);
assert.throws(
  () => assertSafeProductionPublicFlags({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production",
    NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: "true",
    NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: "July 20, 2026"
  }, nowMs),
  /requires a future ISO-8601 expiry/
);
assert.throws(
  () => assertSafeProductionPublicFlags({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production",
    NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: "true",
    NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: new Date(nowMs - 1).toISOString()
  }, nowMs),
  /requires a future ISO-8601 expiry/
);
assert.throws(
  () => assertSafeProductionPublicFlags({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production",
    NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN: "true",
    NEXT_PUBLIC_TEMP_PRODUCTION_STAFF_LOGIN_EXPIRES_AT: new Date(nowMs + 24 * 60 * 60 * 1000 + 1).toISOString()
  }, nowMs),
  /cannot be enabled for more than 24 hours/
);

assert.equal(isTemporaryProductionStaffPasswordLoginAvailable({
  email: TEMPORARY_PRODUCTION_STAFF_EMAIL,
  enabled: true,
  expiresAt: validTemporaryExpiration,
  nowMs
}), true);
assert.equal(isTemporaryProductionStaffPasswordLoginAvailable({
  email: "student@wesleyan.edu.ph",
  enabled: true,
  expiresAt: validTemporaryExpiration,
  nowMs
}), false);
assert.equal(passwordLoginTarget({
  email: TEMPORARY_PRODUCTION_STAFF_EMAIL,
  developmentEnabled: false,
  temporaryStaffEnabled: true,
  temporaryStaffExpiresAt: validTemporaryExpiration,
  nowMs
}), "temporary-staff-login", "Production staff must use the isolated temporary endpoint");
assert.equal(passwordLoginTarget({
  email: "student@wesleyan.edu.ph",
  developmentEnabled: false,
  temporaryStaffEnabled: true,
  temporaryStaffExpiresAt: validTemporaryExpiration,
  nowMs
}), null, "Production students must remain passwordless");
assert.equal(passwordLoginTarget({
  email: "admin@wesleyan.edu.ph",
  developmentEnabled: false,
  temporaryStaffEnabled: true,
  temporaryStaffExpiresAt: validTemporaryExpiration,
  nowMs
}), null, "Production admins must remain passwordless");
assert.equal(passwordLoginTarget({
  email: TEMPORARY_PRODUCTION_STAFF_EMAIL,
  developmentEnabled: false,
  temporaryStaffEnabled: true,
  temporaryStaffExpiresAt: new Date(nowMs - 1).toISOString(),
  nowMs
}), null, "Expired Production staff login must fail closed");
assert.equal(isTemporaryProductionStaffPasswordLoginAvailable({
  email: "admin@wesleyan.edu.ph",
  enabled: true,
  expiresAt: validTemporaryExpiration,
  nowMs
}), false);
assert.equal(isTemporaryProductionStaffPasswordLoginAvailable({
  email: TEMPORARY_PRODUCTION_STAFF_EMAIL,
  enabled: true,
  expiresAt: new Date(nowMs - 1).toISOString(),
  nowMs
}), false);
assert.throws(
  () => assertSafeProductionPublicFlags({
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_ENABLE_DEV_LOGIN: "true",
    NEXT_PUBLIC_E2E_TEST: "false"
  }),
  /NEXT_PUBLIC_ENABLE_DEV_LOGIN must be false/,
  "an unverified Preview label must not bypass a production build"
);
assert.throws(
  () => assertSafeProductionPublicFlags({
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_E2E_TEST: "true"
  }),
  /NEXT_PUBLIC_E2E_TEST must be false/
);

console.log("Next.js production environment safeguards passed.");
