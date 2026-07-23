import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  process.cwd(),
  "prisma/migrations/20260723000000_add_wishlist_back_in_stock/migration.sql"
);

test("wishlist migration keeps direct browser database access closed", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /ADD VALUE IF NOT EXISTS 'BACK_IN_STOCK'/);
  assert.match(sql, /CREATE TABLE "wishlist_items"/);
  assert.match(sql, /PRIMARY KEY \("user_id", "product_id"\)/);
  assert.match(sql, /CREATE UNIQUE INDEX "notifications_dedupe_key_key"/);
  assert.match(sql, /CREATE INDEX "notifications_user_id_created_at_idx"[\s\S]*\("user_id", "created_at" DESC\)/);
  assert.match(sql, /ALTER TABLE public\.wishlist_items ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.wishlist_items FROM PUBLIC/);
  assert.match(sql, /ARRAY\['anon', 'authenticated'\]/);
  assert.match(sql, /GRANT ALL PRIVILEGES ON TABLE public\.wishlist_items TO service_role/);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
});
