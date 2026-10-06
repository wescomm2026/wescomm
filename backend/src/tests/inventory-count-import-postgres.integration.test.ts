import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import type { InventoryCountDataset } from "../domain/inventory-count-import.js";
import { prisma } from "../lib/prisma.js";
import { applyInventoryCountImport, planInventoryCountImport } from "../services/inventory-count-import.service.js";
import { listProducts } from "../services/product.service.js";
import { reconcileProductSkuInventory } from "../services/sku-inventory.service.js";
import { recordWalkInSale } from "../services/walk-in-sale.service.js";
import { HttpError } from "../utils/http-error.js";

test("PostgreSQL applies an inventory count through the inventory services and is idempotent", async () => {
  const suffix = randomUUID().slice(0, 8);
  const actorId = randomUUID();
  const categorySlug = `count-import-${suffix}`;
  const names = {
    legacyShirt: `Legacy Shirt ${suffix}`,
    shirt: `Import Shirt ${suffix}`,
    cloth: `Import Cloth ${suffix}`,
    legacyLace: `Legacy Lace ${suffix}`,
    lace: `Import Lace ${suffix}`
  };
  const dataset: InventoryCountDataset = {
    version: "2026-09",
    title: `Integration count ${suffix}`,
    countedAt: "2026-09-30",
    sources: ["integration test"],
    categories: [{ name: `Count Import ${suffix}`, slug: categorySlug }],
    products: [
      {
        key: "shirt",
        name: names.shirt,
        category: categorySlug,
        saleMode: "OPTIONS",
        optionName: "Size",
        matchExisting: [names.legacyShirt],
        lines: [
          { sheet: `Shirt ${suffix}, #8`, option: "#8", count: 2 },
          { sheet: `Shirt ${suffix}, S`, option: "S", count: 3 },
          { sheet: `Shirt ${suffix}, M`, option: "M", count: 0 }
        ]
      },
      { key: "cloth", name: names.cloth, category: categorySlug, saleMode: "CLOTH_ONLY", lines: [{ sheet: `Cloth ${suffix}`, count: 5 }] },
      { key: "lace", name: names.lace, category: categorySlug, saleMode: "SIMPLE", matchExisting: [names.legacyLace], lines: [{ sheet: `Lace ${suffix}`, count: 7 }] }
    ]
  };
  const productIds: string[] = [];

  try {
    await prisma.profile.create({
      data: { id: actorId, fullName: "Count Import Staff", email: `count-import-${suffix}@example.invalid`, role: "STAFF" }
    });
    const category = await prisma.category.create({ data: { name: dataset.categories[0].name, slug: categorySlug } });
    const legacyShirt = await prisma.product.create({
      data: { name: names.legacyShirt, categoryId: category.id, price: 300, stock: 0, status: "OUT_OF_STOCK", saleMode: "OPTIONS" },
      select: { id: true }
    });
    const legacyLace = await prisma.product.create({
      data: {
        name: names.legacyLace,
        categoryId: category.id,
        price: 175,
        stock: 0,
        status: "OUT_OF_STOCK",
        saleMode: "OPTIONS",
        variants: { create: [{ optionName: "Clip", optionValue: "Metal" }, { optionName: "Clip", optionValue: "Plastic" }] }
      },
      select: { id: true }
    });
    productIds.push(legacyShirt.id, legacyLace.id);
    // The legacy shirt already tracks 4 pcs of Large with a cost batch.
    await reconcileProductSkuInventory({
      productId: legacyShirt.id,
      optionGroups: [{ key: "size", optionName: "Size", values: [{ key: "large", optionValue: "Large" }] }],
      skus: [{ optionValueKeys: ["large"], stock: 4 }],
      performedById: actorId
    });

    const result = await applyInventoryCountImport(dataset, actorId);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.skipped, []);
    assert.equal(result.applied.length, 3);
    const clothId = result.applied.find((entry) => entry.key === "cloth")!.productId;
    productIds.push(clothId);

    const shirt = await prisma.product.findUniqueOrThrow({
      where: { id: legacyShirt.id },
      select: {
        name: true,
        stock: true,
        price: true,
        skuInventoryEnabled: true,
        aliases: { select: { alias: true } },
        skus: { where: { isActive: true }, select: { stock: true, optionValues: { select: { variant: { select: { optionValue: true } } } } } }
      }
    });
    assert.equal(shirt.name, names.shirt);
    assert.equal(shirt.stock, 5);
    assert.equal(Number(shirt.price), 300, "an existing price is kept");
    assert.equal(shirt.skuInventoryEnabled, true);
    assert.deepEqual(
      Object.fromEntries(shirt.skus.map((sku) => [sku.optionValues[0].variant.optionValue, sku.stock])),
      { "#8": 2, S: 3, M: 0 }
    );
    assert.ok(shirt.aliases.some((alias) => alias.alias === names.legacyShirt), "the old name stays searchable");
    const shirtOpenBatches = await prisma.inventoryBatch.aggregate({
      where: { productId: legacyShirt.id, quantityRemaining: { gt: 0 } },
      _sum: { quantityRemaining: true }
    });
    assert.equal(shirtOpenBatches._sum.quantityRemaining, 5, "the old Large balance was cleared, only the counted stock remains");
    assert.equal(await prisma.inventoryBatch.count({ where: { productId: legacyShirt.id, quantityRemaining: { gt: 0 }, costVerified: true } }), 0);

    const cloth = await prisma.product.findUniqueOrThrow({ where: { id: clothId }, select: { price: true, stock: true, saleMode: true } });
    assert.equal(Number(cloth.price), 0);
    assert.equal(cloth.stock, 5);
    assert.equal(cloth.saleMode, "CLOTH_ONLY");
    assert.equal(await prisma.inventoryMovement.count({ where: { productId: clothId } }), 1);

    const lace = await prisma.product.findUniqueOrThrow({ where: { id: legacyLace.id }, select: { name: true, saleMode: true, stock: true } });
    assert.deepEqual(lace, { name: names.lace, saleMode: "SIMPLE", stock: 7 });

    const rerun = await planInventoryCountImport(dataset);
    assert.deepEqual(rerun.map((plan) => [plan.key, plan.steps.length, plan.blockedReason]), [["shirt", 0, null], ["cloth", 0, null], ["lace", 0, null]]);

    const shop = await listProducts({ query: suffix });
    assert.ok(!shop.some((item) => item.id === clothId), "an unpriced product is not listed to students");
    assert.ok(shop.some((item) => item.id === legacyShirt.id));

    const sale = { items: [{ productId: clothId, quantity: 1 }], buyerName: "Count Buyer", cashReceived: 500, performedById: actorId };
    await assert.rejects(
      recordWalkInSale({ ...sale, clientSaleId: randomUUID() }),
      (error: unknown) => error instanceof HttpError && error.code === "PRODUCT_PRICE_REQUIRED"
    );
    await prisma.product.update({ where: { id: clothId }, data: { price: new Prisma.Decimal(250) } });
    await assert.rejects(
      recordWalkInSale({ ...sale, clientSaleId: randomUUID() }),
      (error: unknown) => error instanceof HttpError && error.code === "UNVERIFIED_BATCH_COST",
      "counted stock cannot be sold until staff verify its unit cost"
    );
  } finally {
    await prisma.inventoryBatch.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.category.deleteMany({ where: { slug: categorySlug } });
    await prisma.auditLog.deleteMany({ where: { actorId } });
    await prisma.profile.deleteMany({ where: { id: actorId } });
  }
});
