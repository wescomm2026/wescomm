import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeStagingMutationEnvironment,
  databaseProjectRefFromUrl,
  resolveStagingProjectTarget,
  supabaseProjectRefFromUrl
} from "../domain/staging-data-policy.js";

const stagingRef = "stagingproject123456";
const productionRef = "productionproject123";

function safeEnvironment() {
  return {
    WESCOMM_ENV: "staging",
    STAGING_SUPABASE_PROJECT_REF: stagingRef,
    PRODUCTION_SUPABASE_PROJECT_REF: productionRef,
    DATABASE_URL: `postgresql://postgres.${stagingRef}:secret@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require`,
    DIRECT_URL: `postgresql://postgres.${stagingRef}:secret@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require`,
    NEXT_PUBLIC_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
    NODE_ENV: "development"
  };
}

test("staging target accepts one explicitly isolated Supabase project", () => {
  const target = resolveStagingProjectTarget(safeEnvironment());
  assert.equal(target.stagingProjectRef, stagingRef);
  assert.equal(target.productionProjectRef, productionRef);
});

test("staging target rejects any Production project credential", () => {
  const environment = safeEnvironment();
  environment.DATABASE_URL = `postgresql://postgres.${productionRef}:secret@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require`;
  assert.throws(() => resolveStagingProjectTarget(environment), /must all target the declared Staging project/);
});

test("staging mutations fail closed on production process labels", () => {
  const environment = { ...safeEnvironment(), VERCEL_ENV: "production" };
  assert.throws(() => assertSafeStagingMutationEnvironment(environment), /marked as production/);
});

test("a production Node build remains safe when the verified deployment target is Preview", () => {
  const environment = {
    ...safeEnvironment(),
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    VERCEL_TARGET_ENV: "preview"
  };
  assert.equal(assertSafeStagingMutationEnvironment(environment).stagingProjectRef, stagingRef);
});

test("project references are derived from direct and pooler URLs", () => {
  assert.equal(supabaseProjectRefFromUrl(`https://${stagingRef}.supabase.co`), stagingRef);
  assert.equal(
    databaseProjectRefFromUrl(`postgresql://postgres.${stagingRef}:secret@pooler.supabase.com:6543/postgres`),
    stagingRef
  );
  assert.equal(
    databaseProjectRefFromUrl(`postgresql://postgres:secret@db.${stagingRef}.supabase.co:5432/postgres`),
    stagingRef
  );
});
