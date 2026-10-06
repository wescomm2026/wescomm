import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildInventoryReport, compareSizeLabels, type InventoryReportProductRow } from "../domain/inventory-report.js";

function row(overrides: Partial<InventoryReportProductRow>): InventoryReportProductRow {
  return {
    id: overrides.name ?? "id",
    name: "Item",
    saleMode: "SIMPLE",
    skuInventoryEnabled: false,
    price: 100,
    stock: 0,
    unverifiedCostQuantity: 0,
    category: { name: "Uniforms", slug: "uniforms" },
    skus: [],
    ...overrides
  };
}

const sizes = (pairs: Array<[string, number]>) => pairs.map(([value, stock]) => ({ stock, options: [{ optionName: "Size", optionValue: value }] }));

test("sizes print children's numbers first, then XS to 5XL", () => {
  assert.deepEqual(
    ["2XL", "#12", "M", "XS", "#8", "Large", "5XL", "S", "#20", "XL"].sort(compareSizeLabels),
    ["#8", "#12", "#20", "XS", "S", "M", "Large", "XL", "2XL", "5XL"]
  );
});

test("inventory report groups by category with size lines, subtotals, and grand totals", () => {
  const report = buildInventoryReport([
    row({ name: "PE T-shirt (Elementary)", saleMode: "OPTIONS", skuInventoryEnabled: true, price: 0, unverifiedCostQuantity: 12, skus: sizes([["M", 1], ["#8", 9], ["XS", 2], ["#12", 0]]) }),
    row({ name: "HS Male Uniform Cloth", saleMode: "CLOTH_ONLY", stock: 457 }),
    row({ name: "ID Lace", stock: 1500, category: { name: "ID Accessories", slug: "id-accessories" } }),
    row({ name: "Old Sized Item", saleMode: "OPTIONS", skuInventoryEnabled: false, stock: 4 })
  ], { generatedAt: new Date("2026-10-07T01:00:00.000Z"), generatedBy: "QA Commissary Staff" });

  assert.deepEqual(report.categories.map((category) => [category.name, category.total]), [["ID Accessories", 1500], ["Uniforms", 473]]);
  const uniforms = report.categories[1];
  assert.deepEqual(uniforms.items.map((item) => item.name), ["HS Male Uniform Cloth", "Old Sized Item", "PE T-shirt (Elementary)"]);
  const shirt = uniforms.items[2];
  assert.equal(shirt.total, 12);
  assert.deepEqual(shirt.lines, [{ label: "#8", stock: 9 }, { label: "#12", stock: 0 }, { label: "XS", stock: 2 }, { label: "M", stock: 1 }]);
  assert.equal(shirt.needsPrice, true);
  assert.equal(uniforms.items[1].setupRequired, true);
  assert.deepEqual(uniforms.items[0].lines, []);
  assert.deepEqual(report.totals, { products: 4, lines: 7, units: 1973, needsPrice: 1, unverifiedCostUnits: 12 });
  assert.equal(report.generatedBy, "QA Commissary Staff");
});

test("inventory report can hide zero stock and narrow to one category", () => {
  const rows = [
    row({ name: "Sized", saleMode: "OPTIONS", skuInventoryEnabled: true, skus: sizes([["S", 0], ["M", 3]]) }),
    row({ name: "Empty Cloth", saleMode: "CLOTH_ONLY", stock: 0 }),
    row({ name: "WUP Pin", stock: 200, category: { name: "Paraphernalia", slug: "paraphernalia" } })
  ];
  const nonZero = buildInventoryReport(rows, { generatedAt: new Date(), generatedBy: null, includeZeroStock: false });
  assert.deepEqual(nonZero.categories.flatMap((category) => category.items.map((item) => item.name)), ["WUP Pin", "Sized"]);
  assert.deepEqual(nonZero.categories[1].items[0].lines, [{ label: "M", stock: 3 }]);

  const paraphernalia = buildInventoryReport(rows, { generatedAt: new Date(), generatedBy: null, categorySlug: "paraphernalia" });
  assert.deepEqual(paraphernalia.categories.map((category) => category.slug), ["paraphernalia"]);
  assert.equal(paraphernalia.totals.units, 200);
});

test("the inventory report route is staff-only and registered before product id routes", () => {
  const routes = readFileSync(path.resolve(process.cwd(), "src/routes/staff-products.routes.ts"), "utf8");
  assert.ok(routes.indexOf('"/inventory-report"') > routes.indexOf('staffProductsRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"))'));
  assert.ok(routes.indexOf('"/inventory-report"') < routes.indexOf('staffProductsRoutes.get(\n  "/:id"'));
});
