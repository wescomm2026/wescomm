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
  isProductionDeploymentEnvironment({ VERCEL_ENV: "production" }),
  true,
  "VERCEL_ENV must identify production deployments even when the public flag is absent"
);
assert.equal(
  isProductionDeploymentEnvironment({ NEXT_PUBLIC_APP_ENV: "development", VERCEL_ENV: "preview" }),
  false,
  "preview and development environments must remain non-production"
);

assert.doesNotThrow(() => {
  assertSafeProductionPublicFlags({
    VERCEL_ENV: "production",
    NEXT_PUBLIC_ENABLE_DEV_LOGIN: "false",
    NEXT_PUBLIC_E2E_TEST: "false"
  });
});
assert.throws(
  () => assertSafeProductionPublicFlags({
    VERCEL_ENV: "production",
    NEXT_PUBLIC_ENABLE_DEV_LOGIN: "true"
  }),
  /NEXT_PUBLIC_ENABLE_DEV_LOGIN must be false/
);
assert.throws(
  () => assertSafeProductionPublicFlags({
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_E2E_TEST: "true"
  }),
  /NEXT_PUBLIC_E2E_TEST must be false/
);

console.log("Next.js production environment safeguards passed.");
