import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  process.cwd(),
  "prisma/migrations/20260907030000_backfill_department_product_audiences/migration.sql"
);
const shopPath = path.resolve(process.cwd(), "../frontend/components/ui/StudentShopExperience.tsx");

test("department product backfill is exact, non-destructive, and invalidates shared cache", () => {
  const sql = readFileSync(migrationPath, "utf8");

  for (const [product, department] of [
    ["CBA Women's Uniform Set", "CBA"],
    ["Elementary PE Uniform Set", "ELEM"],
    ["Senior High Boys Uniform Set", "HS"],
    ["Nursing Uniform Set", "CON"],
    ["Med Tech Uniform Set", "CAMS"],
    ["WUP Criminology Uniform", "CCJE"]
  ]) {
    assert.match(sql, new RegExp(`\\('${product.replaceAll("'", "''").replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}', '${department}'\\)`));
  }

  assert.match(sql, /product\."audience_scope" = 'ALL_STUDENTS'/);
  assert.match(sql, /NOT EXISTS[\s\S]*FROM "product_departments" AS existing/);
  assert.match(sql, /ON CONFLICT \("product_id", "department_id"\) DO NOTHING/);
  assert.match(sql, /SET "audience_scope" = 'SPECIFIC_DEPARTMENTS'/);
  assert.match(sql, /system\.cache-revision\.products/);
  assert.doesNotMatch(sql, /LIKE|ILIKE/);
});

test("student shop prioritizes and identifies the signed-in student's department products", () => {
  const source = readFileSync(shopPath, "utf8");

  assert.match(source, /isDepartmentRecommendation\(product, user\?\.departmentId\)/);
  assert.match(source, /return 100/);
  assert.match(source, /Recommended for your department/);
  assert.match(source, /For your department/);
});
