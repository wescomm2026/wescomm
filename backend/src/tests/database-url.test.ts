import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeProductionDatabaseUrls,
  buildRuntimeDatabaseUrl
} from "../utils/database-url.js";

const transactionUrl =
  "postgresql://postgres.project:secret@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require";
const sessionUrl =
  "postgresql://postgres.project:secret@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require";
const supabaseUrl = "https://project.supabase.co";

test("serverless runtime URLs add conservative Prisma pool defaults", () => {
  const parsed = new URL(buildRuntimeDatabaseUrl(transactionUrl, true));

  assert.equal(parsed.searchParams.get("connection_limit"), "1");
  assert.equal(parsed.searchParams.get("pool_timeout"), "10");
  assert.equal(parsed.searchParams.get("connect_timeout"), "10");
  assert.equal(parsed.searchParams.get("pgbouncer"), "true");
  assert.equal(parsed.searchParams.get("sslmode"), "require");
});

test("explicit runtime pool tuning is preserved", () => {
  const tuned = `${transactionUrl}&connection_limit=2&pool_timeout=7&connect_timeout=4`;
  const parsed = new URL(buildRuntimeDatabaseUrl(tuned, true));

  assert.equal(parsed.searchParams.get("connection_limit"), "2");
  assert.equal(parsed.searchParams.get("pool_timeout"), "7");
  assert.equal(parsed.searchParams.get("connect_timeout"), "4");
});

test("non-serverless database URLs are not given serverless pool limits", () => {
  const parsed = new URL(buildRuntimeDatabaseUrl(transactionUrl, false));

  assert.equal(parsed.searchParams.has("connection_limit"), false);
  assert.equal(parsed.searchParams.has("pool_timeout"), false);
  assert.equal(parsed.searchParams.has("connect_timeout"), false);
});

test("valid Supabase transaction and session endpoints pass production checks", () => {
  assert.doesNotThrow(
    () => assertSafeProductionDatabaseUrls(transactionUrl, sessionUrl, supabaseUrl)
  );
});

test("Supabase session mode cannot be used as the production runtime URL", () => {
  assert.throws(
    () => assertSafeProductionDatabaseUrls(sessionUrl, sessionUrl, supabaseUrl),
    /transaction pooler on port 6543/
  );
});

test("Supabase direct mode cannot be used as the production runtime URL", () => {
  const directRuntime =
    "postgresql://postgres:secret@db.project.supabase.co:5432/postgres?sslmode=require";

  assert.throws(
    () => assertSafeProductionDatabaseUrls(directRuntime, directRuntime, supabaseUrl),
    /transaction pooler on port 6543/
  );
});

test("Supabase transaction mode requires Prisma's pgbouncer compatibility flag", () => {
  const missingPgbouncer =
    "postgresql://postgres.project:secret@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require";

  assert.throws(
    () => assertSafeProductionDatabaseUrls(missingPgbouncer, sessionUrl, supabaseUrl),
    /pgbouncer=true/
  );
});

test("runtime and administrative URLs must identify the same Supabase project", () => {
  const otherProjectSessionUrl =
    "postgresql://postgres.otherproject:secret@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require";

  assert.throws(
    () => assertSafeProductionDatabaseUrls(transactionUrl, otherProjectSessionUrl, supabaseUrl),
    /must target the same Supabase project/
  );
});

test("direct Supabase administrative endpoints cannot use a transaction-pooler port", () => {
  const wrongPortDirectUrl =
    "postgresql://postgres:secret@db.project.supabase.co:6543/postgres?sslmode=require";

  assert.throws(
    () => assertSafeProductionDatabaseUrls(
      transactionUrl,
      wrongPortDirectUrl,
      supabaseUrl
    ),
    /must use port 5432/
  );
});

test("database and Supabase API URLs must identify the same project", () => {
  assert.throws(
    () => assertSafeProductionDatabaseUrls(
      transactionUrl,
      sessionUrl,
      "https://otherproject.supabase.co"
    ),
    /must target the same Supabase project/
  );
});
