import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { getInventoryProduct, listInventory } from "../services/inventory.service.js";
import { verifyOpeningBatchCosts } from "../services/inventory-cost.service.js";
import { reconcileProductSkuInventory } from "../services/sku-inventory.service.js";
import { recordWalkInSale, voidWalkInSale } from "../services/walk-in-sale.service.js";

type Product = NonNullable<Awaited<ReturnType<typeof getInventoryProduct>>>;

async function withZeroStockSizes(run: (fixture: { actorId: string; product: Product }) => Promise<void>) {
  const suffix = randomUUID();
  const actorId = randomUUID();
  const categoryName = `Rebuild cost ${suffix}`;
  let productId: string | undefined;
  try {
    await prisma.profile.create({
      data: { id: actorId, fullName: "Rebuild cost QA staff", email: `rebuild-${suffix}@example.invalid`, role: "STAFF" }
    });
    // Match createProduct's zero-stock, one-option-group result without using
    // the hosted Supabase category/name lookups in this isolated PostgreSQL test.
    const category = await prisma.category.create({ data: { name: categoryName, slug: `rebuild-cost-${suffix}` } });
    const created = await prisma.product.create({
      data: {
        name: `Zero-stock sized product ${suffix}`, categoryId: category.id,
        price: 350, saleMode: "OPTIONS", stock: 0, status: "OUT_OF_STOCK", skuInventoryEnabled: true,
        variants: { create: [
          { optionName: "Size", optionValue: "S", stock: 0, lowStockThreshold: 1 },
          { optionName: "Size", optionValue: "M", stock: 0, lowStockThreshold: 1 }
        ] }
      },
      include: { variants: true }
    });
    productId = created.id;
    for (const variant of created.variants) {
      await prisma.productSku.create({ data: {
        productId, code: `REBUILD-${randomUUID()}`, stock: 0, lowStockThreshold: 1,
        optionValues: { create: [{ variantId: variant.id }] }
      } });
    }
    const product = await getInventoryProduct(productId);
    assert.ok(product);
    assert.equal(product.skuInventoryEnabled, true);
    await run({ actorId, product });
  } finally {
    if (productId) {
      const items = await prisma.walkInSaleItem.findMany({ where: { productId }, select: { receiptId: true } });
      const receiptIds = [...new Set(items.map((item) => item.receiptId))];
      await prisma.realtimeEvent.deleteMany({ where: { entityId: { in: [productId, ...receiptIds] } } });
      await prisma.outboxEvent.deleteMany({ where: { entityId: { in: [productId, ...receiptIds] } } });
      await prisma.receipt.deleteMany({ where: { id: { in: receiptIds } } });
      await prisma.inventoryBatch.deleteMany({ where: { productId } });
      await prisma.product.deleteMany({ where: { id: productId } });
    }
    await prisma.category.deleteMany({ where: { name: categoryName } });
    await prisma.auditLog.deleteMany({ where: { actorId } });
    await prisma.notification.deleteMany({ where: { userId: actorId } });
    await prisma.profile.deleteMany({ where: { id: actorId } });
  }
}

function rejectsUnverifiedCost(error: unknown) {
  return error instanceof HttpError && error.status === 409 && error.code === "UNVERIFIED_BATCH_COST";
}

test("PostgreSQL gives rebuilt zero-stock sizes cost batches and requires verification before a sale", async () => {
  await withZeroStockSizes(async ({ actorId, product }) => {
    const oldSku = product.skus[0];
    const history = await prisma.inventoryBatch.create({
      data: {
        productId: product.id, skuId: oldSku.id, batchCode: `HISTORY-${randomUUID()}`,
        quantityReceived: 2, quantityRemaining: 0, unitCost: 90, costVerified: true,
        receivedAt: new Date("2026-09-01T00:00:00Z"), createdById: actorId
      }
    });
    const rebuilt = await reconcileProductSkuInventory({
      productId: product.id,
      skus: product.variants.map((variant) => ({ variantIds: [variant.id], stock: 3 })),
      performedById: actorId,
      notes: "Count three units of each previously empty size."
    });
    assert.equal(rebuilt.stock, 6);
    assert.equal(rebuilt.unverifiedCostQuantity, 6);
    const needsCost = await listInventory({ productId: product.id, needs: "COST" });
    assert.ok(needsCost.items.some((item) => item.id === product.id));
    const opening = await prisma.inventoryBatch.findMany({ where: { productId: product.id, quantityRemaining: { gt: 0 } } });
    assert.equal(opening.length, 2);
    assert.deepEqual(opening.map((batch) => batch.quantityRemaining).sort(), [3, 3]);
    assert.ok(opening.every((batch) => !batch.costVerified && Number(batch.unitCost) === 0));
    assert.deepEqual(new Set(opening.map((batch) => batch.skuId)), new Set(rebuilt.skus.map((sku) => sku.id)));
    const old = await prisma.inventoryBatch.findUniqueOrThrow({ where: { id: history.id } });
    assert.equal(old.quantityRemaining, 0);
    assert.equal(Number(old.unitCost), 90);
    assert.equal(old.skuId, oldSku.id);

    const sale = {
      items: [{ productId: product.id, skuId: rebuilt.skus[0].id, quantity: 1 }],
      buyerName: "Rebuild cost integration buyer", cashReceived: 500,
      clientSaleId: randomUUID(), performedById: actorId
    };
    await assert.rejects(recordWalkInSale(sale), rejectsUnverifiedCost);
    assert.equal((await getInventoryProduct(product.id))!.stock, 6);
    assert.equal(await prisma.walkInSale.count({ where: { clientSaleId: sale.clientSaleId } }), 0);
    await verifyOpeningBatchCosts({ productId: product.id, batchIds: opening.map((batch) => batch.id), unitCost: 150, actorId });
    const saved = await recordWalkInSale(sale);
    assert.equal(Number(saved.receipt.totalAmount), 350);
    const costs = await prisma.walkInSaleCostAllocation.findMany({ where: { item: { receiptId: saved.receipt.id } } });
    assert.equal(costs.length, 1);
    assert.equal(costs[0].quantity, 1);
    assert.equal(Number(costs[0].unitCost), 150);
    await voidWalkInSale({ receiptId: saved.receipt.id, reason: "Integration test stock restoration", voidedById: actorId, actorRole: "STAFF" });
    assert.equal((await getInventoryProduct(product.id))!.stock, 6);
    assert.equal((await prisma.inventoryBatch.aggregate({ where: { productId: product.id }, _sum: { quantityRemaining: true } }))._sum.quantityRemaining, 6);
  });
});

test("PostgreSQL refuses a legacy sized sale with stock but no cost batches without deducting stock", async () => {
  await withZeroStockSizes(async ({ actorId, product }) => {
    // Reproduce records already affected by the old rebuild: a positive size
    // balance exists, but there is no opening cost layer to allocate.
    const sku = product.skus[0];
    await prisma.product.update({ where: { id: product.id }, data: { stock: 1, status: "IN_STOCK" } });
    await prisma.productSku.update({ where: { id: sku.id }, data: { stock: 1 } });
    await prisma.productVariant.updateMany({ where: { id: { in: sku.variantIds } }, data: { stock: 1 } });
    const clientSaleId = randomUUID();
    await assert.rejects(recordWalkInSale({
      items: [{ productId: product.id, skuId: sku.id, quantity: 1 }],
      buyerName: "Legacy missing-cost integration buyer", cashReceived: 500,
      clientSaleId, performedById: actorId
    }), rejectsUnverifiedCost);
    assert.equal((await getInventoryProduct(product.id))!.stock, 1);
    assert.equal((await prisma.productSku.findUniqueOrThrow({ where: { id: sku.id } })).stock, 1);
    assert.equal(await prisma.walkInSale.count({ where: { clientSaleId } }), 0);
  });
});
