import assert from "node:assert/strict";
import {
  assertSafeProductionPublicFlags,
  isProductionDeploymentEnvironment
} from "../next.config.mjs";

assert.equal(
  isProductionDeploymentEnvironment({ NEXT_PUBLIC_APP_ENV: "production" }),
  true,
  "NEXT_PUBLIC_APP_ENV must identify production deployments"
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
