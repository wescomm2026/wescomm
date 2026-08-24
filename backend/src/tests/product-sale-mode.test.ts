import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  process.cwd(),
  "prisma/migrations/20260826000000_add_product_sale_mode/migration.sql"
);
const schemaPath = path.resolve(process.cwd(), "prisma/schema.prisma");

test("selling-mode migration is transactional and non-destructive", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /CREATE TYPE public\.product_sale_mode AS ENUM \('SIMPLE', 'CLOTH_ONLY', 'OPTIONS'\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS sale_mode public\.product_sale_mode NOT NULL DEFAULT 'SIMPLE'/);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
});

test("selling-mode migration preserves reconciled SKU products and classifies uniform cloth explicitly", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /WHEN p\.sku_inventory_enabled THEN 'OPTIONS'/);
  assert.match(sql, /physical education\|elementary pe/);
  assert.match(sql, /THEN 'CLOTH_ONLY'::public\.product_sale_mode/);
  assert.match(sql, /FROM public\.product_variants pv[\s\S]*THEN 'OPTIONS'/);
});

test("Prisma maps selling mode to the database enum and column", () => {
  const schema = readFileSync(schemaPath, "utf8");

  assert.match(schema, /enum ProductSaleMode \{[\s\S]*SIMPLE[\s\S]*CLOTH_ONLY[\s\S]*OPTIONS[\s\S]*@@map\("product_sale_mode"\)/);
  assert.match(schema, /saleMode\s+ProductSaleMode\s+@default\(SIMPLE\)\s+@map\("sale_mode"\)/);
});
