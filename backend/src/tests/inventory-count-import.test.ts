import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  importWriteRefusal,
  planInventoryImport,
  planProductImport,
  productTotal,
  resolveImportTarget,
  validateInventoryDataset,
  type CatalogProductSnapshot,
  type InventoryCountDataset,
  type InventoryCountProduct
} from "../domain/inventory-count-import.js";

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

const dataset = JSON.parse(source("datasets/inventory/2026-09-ending-inventory.json")) as InventoryCountDataset;

function product(key: string) {
  const found = dataset.products.find((entry) => entry.key === key);
  assert.ok(found, `missing ${key}`);
  return found;
}

function snapshot(overrides: Partial<CatalogProductSnapshot> = {}): CatalogProductSnapshot {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Existing",
    isActive: true,
    saleMode: "SIMPLE",
    skuInventoryEnabled: false,
    stock: 0,
    imageUrl: null,
    normalizedAliases: [],
    variants: [],
    activeSkus: [],
    activeReservationCount: 0,
    ...overrides
  };
}

function sizeSkus(item: InventoryCountProduct, stock = (line: InventoryCountProduct["lines"][number]) => line.count) {
  return item.lines.map((line, index) => ({
    id: `00000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
    stock: stock(line),
    options: [{ optionName: item.optionName!, optionValue: line.option! }]
  }));
}

test("September 2026 count sheet transcription is valid and matches the sheet totals", () => {
  assert.deepEqual(validateInventoryDataset(dataset), []);
  assert.equal(dataset.products.length, 25);
  const totals = Object.fromEntries(dataset.products.map((entry) => [entry.key, productTotal(entry)]));
  assert.equal(totals["pe-tshirt-elementary"], 30);
  assert.equal(totals["jogging-pants-elementary"], 105);
  assert.equal(totals["pe-tshirt-hs-shs"], 528);
  assert.equal(totals["jogging-pants-hs-shs"], 500);
  assert.equal(totals["pe-tshirt-college"], 551);
  assert.equal(totals["jogging-pants-college"], 700);
  assert.equal(totals["pe-shorts-college"], 31);
  assert.equal(totals["moss-green-polo-shirt"], 348);
  assert.equal(totals["id-lace"], 1500);
  assert.equal(totals["college-gs-sash"], 575);
  assert.equal(totals["wup-pin"], 200);
  const clothTotal = dataset.products
    .filter((entry) => entry.saleMode === "CLOTH_ONLY")
    .reduce((total, entry) => total + productTotal(entry), 0);
  assert.equal(clothTotal, 5128);
  assert.equal(product("cloth-elementary").countMissingOnSheet, true);
});

test("dataset validation rejects duplicate sizes, bad counts, and double-claimed existing products", () => {
  const broken: InventoryCountDataset = {
    ...dataset,
    products: [
      { ...product("pe-shorts-college"), lines: [{ sheet: "A", option: "M", count: 1 }, { sheet: "B", option: "m", count: -2 }] },
      { ...product("wup-pin"), matchExisting: ["Shared Name"] },
      { ...product("college-gs-sash"), matchExisting: ["Shared Name"] }
    ]
  };
  const errors = validateInventoryDataset(broken).join("\n");
  assert.match(errors, /option m appears twice/i);
  assert.match(errors, /must be a whole number/);
  assert.match(errors, /already claimed/);
});

test("new sheet items are created unpriced with their sizes and sheet wording as aliases", () => {
  const plan = planProductImport(product("pe-tshirt-hs-shs"), []);
  assert.equal(plan.matched, null);
  assert.deepEqual(plan.steps.map((step) => step.type), ["CREATE", "SET_SIZES", "ADD_ALIASES"]);
  const sizes = plan.steps.find((step) => step.type === "SET_SIZES");
  assert.ok(sizes && sizes.type === "SET_SIZES");
  assert.deepEqual(sizes.sizes.map((size) => `${size.option}=${size.count}`), ["S=94", "M=154", "L=131", "XL=74", "2XL=55", "3XL=20"]);

  const emptyCloth = planProductImport(product("cloth-elementary"), []);
  assert.deepEqual(emptyCloth.steps.map((step) => step.type), ["CREATE", "ADD_ALIASES"]);
  assert.match(emptyCloth.warnings.join(" "), /No count on the sheet/);
});

test("an existing item is renamed, its old stock cleared, and rebuilt with the sheet sizes", () => {
  const elementary = product("pe-tshirt-elementary");
  const plan = planProductImport(elementary, [snapshot({
    name: "Elementary PE Shirt",
    saleMode: "OPTIONS",
    skuInventoryEnabled: true,
    stock: 110,
    imageUrl: "/assets/wup shop assets/elem pe shirt.png",
    activeSkus: [{ id: "sku-small", stock: 110, options: [{ optionName: "Size", optionValue: "Small" }] }]
  })]);
  assert.deepEqual(plan.steps.map((step) => step.type), ["RENAME", "ZERO_STOCK", "SET_SIZES", "ADD_ALIASES"]);
  const aliases = plan.steps.find((step) => step.type === "ADD_ALIASES");
  assert.ok(aliases && aliases.type === "ADD_ALIASES");
  assert.ok(aliases.aliases.includes("Elementary PE Shirt"), "the old name stays searchable");

  const cloth = planProductImport(product("jogging-pants-elementary"), [snapshot({ name: "Elementary PE Jogging Pants", saleMode: "CLOTH_ONLY", imageUrl: "/assets/uniforms.svg" })]);
  assert.deepEqual(cloth.steps.map((step) => step.type), ["RENAME", "CHANGE_SALE_MODE", "SET_SIZES", "SET_IMAGE", "ADD_ALIASES"]);
});

test("re-running the import after it was applied changes nothing", () => {
  const college = product("pe-tshirt-college");
  const applied = snapshot({
    name: college.name,
    saleMode: "OPTIONS",
    skuInventoryEnabled: true,
    stock: 551,
    imageUrl: college.imageUrl!,
    normalizedAliases: college.lines.map((line) => line.sheet.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()),
    activeSkus: sizeSkus(college)
  });
  assert.deepEqual(planProductImport(college, [applied]).steps, []);

  const recount = planProductImport(college, [{ ...applied, activeSkus: sizeSkus(college, (line) => line.option === "M" ? 100 : line.count) }]);
  assert.deepEqual(recount.steps, [{ type: "SET_SIZE_COUNTS", changes: [{ option: "M", from: 100, to: 109 }] }]);

  const lace = product("id-lace");
  assert.deepEqual(planProductImport(lace, [snapshot({ name: "ID Lace", stock: 1500, imageUrl: lace.imageUrl!, normalizedAliases: [] })]).steps, []);
});

test("a staff rename after the import is still recognised through the stored sheet aliases", () => {
  const shorts = product("pe-shorts-college");
  const renamed = snapshot({
    name: "College PE Shorts",
    saleMode: "OPTIONS",
    skuInventoryEnabled: true,
    stock: 31,
    normalizedAliases: shorts.lines.map((line) => line.sheet.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()),
    activeSkus: sizeSkus(shorts)
  });
  const plan = planProductImport(shorts, [renamed]);
  assert.equal(plan.matched?.name, "College PE Shorts");
  assert.deepEqual(plan.steps, [], "a later staff rename is kept");
});

test("the import never guesses: ambiguous matches, name clashes, and active reservations are blocked", () => {
  const college = product("pe-tshirt-college");
  const ambiguous = planProductImport(college, [
    snapshot({ id: "00000000-0000-4000-8000-0000000000a1", name: "PE Uniform Shirt" }),
    snapshot({ id: "00000000-0000-4000-8000-0000000000a2", name: "PE Shirt" })
  ]);
  assert.match(ambiguous.blockedReason ?? "", /more than one existing product/);

  const busy = planProductImport(product("id-lace"), [snapshot({ name: "Wesleyan ID Lace", stock: 4, activeReservationCount: 2 })]);
  assert.match(busy.blockedReason ?? "", /2 active reservation/);

  const plans = planInventoryImport({ ...dataset, products: [product("pe-tshirt-college")] }, [
    snapshot({ id: "00000000-0000-4000-8000-0000000000b1", name: "PE Uniform Shirt" }),
    snapshot({ id: "00000000-0000-4000-8000-0000000000b2", name: "PE T-shirt (College)" })
  ]);
  assert.ok(plans[0].blockedReason);

  const review = planProductImport(product("cloth-nursing-female"), [snapshot({ name: "Nursing Women's Uniform", saleMode: "CLOTH_ONLY" })]);
  assert.equal(review.matched, null, "review candidates are reported, not merged");
  assert.deepEqual(review.reviewCandidatesFound, ["Nursing Women's Uniform"]);
});

test("the import writes only to local or Staging databases unless Production is confirmed by reference", () => {
  const refs = { stagingProjectRef: "stagingref", productionProjectRef: "prodref" };
  const local = resolveImportTarget({ databaseUrl: "postgresql://postgres:postgres@127.0.0.1:55432/wescomm_ci", ...refs });
  assert.equal(local.kind, "LOCAL");
  assert.equal(importWriteRefusal(local, undefined), null);

  const staging = resolveImportTarget({ databaseUrl: "postgresql://postgres.stagingref:x@aws-0.pooler.supabase.com:5432/postgres", ...refs });
  assert.equal(staging.kind, "STAGING");
  assert.equal(importWriteRefusal(staging, undefined), null);

  const production = resolveImportTarget({ databaseUrl: "postgresql://postgres.prodref:x@aws-1.pooler.supabase.com:5432/postgres", ...refs });
  assert.equal(production.kind, "PRODUCTION");
  assert.match(importWriteRefusal(production, undefined) ?? "", /--confirm-production prodref/);
  assert.match(importWriteRefusal(production, "stagingref") ?? "", /Refusing/);
  assert.equal(importWriteRefusal(production, "prodref"), null);

  const unknown = resolveImportTarget({ databaseUrl: "postgresql://postgres.otherref:x@aws-1.pooler.supabase.com:5432/postgres", ...refs });
  assert.match(importWriteRefusal(unknown, "otherref") ?? "", /Refusing/);
});

test("unpriced products stay out of the student shop and cannot be reserved or sold", () => {
  const products = source("src/services/product.service.ts");
  const reservations = source("src/services/reservation.service.ts");
  const walkIn = source("src/services/walk-in-sale.service.ts");
  assert.match(products, /const where: Prisma\.ProductWhereInput = \{ isActive: true, price: \{ gt: 0 \} \};/);
  assert.match(reservations, /Number\(product\.price\) <= 0[\s\S]{0,160}PRODUCT_PRICE_REQUIRED/);
  assert.match(walkIn, /Number\(product\.price\) <= 0[\s\S]{0,180}PRODUCT_PRICE_REQUIRED/);
});
