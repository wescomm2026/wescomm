import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeDevelopmentLoginEnvironment,
  isProductionDeploymentEnvironment,
  isVerifiedVercelProductionEnvironment
} from "../domain/deployment-environment.js";

test("production runtimes fail closed when no hosting environment is available", () => {
  assert.equal(isProductionDeploymentEnvironment({ NODE_ENV: "production" }), true);
  assert.equal(isProductionDeploymentEnvironment({ NODE_ENV: "development" }), false);
});

test("Vercel production is always treated as production", () => {
  assert.equal(isProductionDeploymentEnvironment({
    NODE_ENV: "development",
    VERCEL: "1",
    VERCEL_ENV: "production"
  }), true);
  assert.equal(isProductionDeploymentEnvironment({
    NODE_ENV: "development",
    VERCEL: "1",
    VERCEL_TARGET_ENV: "production"
  }), true);
  assert.equal(isVerifiedVercelProductionEnvironment({
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production"
  }), true);
  assert.equal(isVerifiedVercelProductionEnvironment({
    VERCEL: "1",
    VERCEL_ENV: "production"
  }), false);
});

test("Vercel preview and custom staging remain non-production with production Node builds", () => {
  assert.equal(isProductionDeploymentEnvironment({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "preview"
  }), false);
  assert.equal(isProductionDeploymentEnvironment({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_TARGET_ENV: "staging"
  }), false);
});

test("unverified Vercel labels cannot bypass a production runtime", () => {
  assert.equal(isProductionDeploymentEnvironment({
    NODE_ENV: "production",
    VERCEL_ENV: "preview"
  }), true);
  assert.equal(isProductionDeploymentEnvironment({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_TARGET_ENV: "staging"
  }), true);
  assert.equal(isProductionDeploymentEnvironment({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_TARGET_ENV: "production"
  }), true);
});

test("test password login is allowed only outside production with a strong secret", () => {
  assert.doesNotThrow(() => assertSafeDevelopmentLoginEnvironment({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    AUTH_ENABLE_DEV_LOGIN: true,
    AUTH_DEV_LOGIN_PASSWORD: "preview-only-password"
  }));

  assert.throws(() => assertSafeDevelopmentLoginEnvironment({
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    AUTH_ENABLE_DEV_LOGIN: true,
    AUTH_DEV_LOGIN_PASSWORD: "production-password"
  }), /must be false in production deployments/);

  assert.throws(() => assertSafeDevelopmentLoginEnvironment({
    NODE_ENV: "development",
    AUTH_ENABLE_DEV_LOGIN: true,
    AUTH_DEV_LOGIN_PASSWORD: "too-short"
  }), /at least 12 characters/);

  assert.throws(() => assertSafeDevelopmentLoginEnvironment({
    NODE_ENV: "development",
    AUTH_ENABLE_DEV_LOGIN: true,
    AUTH_DEV_LOGIN_PASSWORD: "            "
  }), /at least 12 characters/);
});
