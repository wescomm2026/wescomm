import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  process.cwd(),
  "prisma/migrations/20260826010000_refine_product_sale_mode_backfill/migration.sql"
);

test("V8.1 selling-mode refinement is transactional and non-destructive", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
});

test("V8.1 only demotes unconfigured non-uniform OPTIONS products without real choices", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /p\.sale_mode = 'OPTIONS'/);
  assert.match(sql, /p\.sku_inventory_enabled = false/);
  assert.match(sql, /FROM public\.product_skus ps[\s\S]*ps\.is_active = true/);
  assert.match(sql, /COUNT\(DISTINCT lower\(trim\(pv\.option_value\)\)\) > 1/);
  assert.match(sql, /lower\(trim\(c\.name\)\) IN \('uniform', 'uniforms'\)/);
  assert.match(sql, /SET sale_mode = 'SIMPLE'/);
});
