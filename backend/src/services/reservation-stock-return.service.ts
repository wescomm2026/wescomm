import { Prisma, type ProductStatus as PrismaProductStatus } from "@prisma/client";
import { deriveProductStatus } from "../domain/reservation-state.js";
import { resolveReservationVariantSelections } from "../domain/variant-stock.js";
import { type ProductStatus } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import { lockProductForUpdate } from "../utils/product-transaction.js";
import { createBackInStockNotificationsInTransaction } from "./wishlist-notification.service.js";

type Transaction = Prisma.TransactionClient;

/**
 * Puts the items of a picked-up (COMPLETED) reservation back on the shelf when its
 * receipt is voided: product, SKU, and option stock are restored, and the FIFO cost
 * allocations made at release are reversed so the units return to their original
 * delivery batches and drop out of COGS. Mirrors the walk-in sale void.
 *
 * Returns the number of units returned (0 when the reservation was never released).
 */
export async function returnCompletedReservationStockInTransaction(
  tx: Transaction,
  input: { reservationId: string; actorId: string; note: string }
) {
  const reservation = await tx.reservation.findUnique({
    where: { id: input.reservationId },
    select: {
      status: true,
      items: { select: { id: true, productId: true, skuId: true, quantity: true, variantSummary: true } }
    }
  });
  if (!reservation || reservation.status !== "COMPLETED" || !reservation.items.length) return 0;

  const productIds = Array.from(new Set(reservation.items.map((item) => item.productId))).sort();
  for (const productId of productIds) {
    const exists = await lockProductForUpdate(tx, productId);
    if (!exists) throw new HttpError(409, "A product on this receipt no longer exists, so its stock cannot be restored.", "RECEIPT_VOID_PRODUCT_MISSING");
  }

  const skuIds = Array.from(new Set(reservation.items.map((item) => item.skuId).filter((id): id is string => Boolean(id))));
  const [products, skus, variants] = await Promise.all([
    tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, stock: true, lowStockThreshold: true, status: true, isActive: true }
    }),
    skuIds.length
      ? tx.productSku.findMany({
          where: { id: { in: skuIds } },
          select: { id: true, productId: true, stock: true, optionValues: { select: { variantId: true } } }
        })
      : Promise.resolve([]),
    tx.productVariant.findMany({
      where: { productId: { in: productIds } },
      select: { id: true, productId: true, optionName: true, optionValue: true, stock: true }
    })
  ]);
  const skuById = new Map(skus.map((sku) => [sku.id, sku]));
  const now = new Date();
  const movements: Prisma.InventoryMovementCreateManyInput[] = [];

  const quantityByProduct = new Map<string, number>();
  for (const item of reservation.items) {
    quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) ?? 0) + item.quantity);
  }
  for (const product of products) {
    const quantity = quantityByProduct.get(product.id) ?? 0;
    const newStock = product.stock + quantity;
    const status = deriveProductStatus(newStock, product.lowStockThreshold, product.status as ProductStatus) as PrismaProductStatus;
    await tx.product.update({
      where: { id: product.id },
      data: { stock: newStock, status, updatedAt: now },
      select: { id: true }
    });
    const movement = await tx.inventoryMovement.create({
      data: {
        productId: product.id,
        type: "ADJUSTMENT",
        quantity,
        previousStock: product.stock,
        newStock,
        performedById: input.actorId,
        notes: input.note
      },
      select: { id: true }
    });
    await createBackInStockNotificationsInTransaction(tx, {
      productId: product.id,
      productName: product.name,
      previous: product,
      next: { ...product, stock: newStock, status },
      eventId: movement.id
    });
  }

  // Ready-made items tracked per size/option combination.
  const quantityBySku = new Map<string, number>();
  for (const item of reservation.items) {
    if (item.skuId) quantityBySku.set(item.skuId, (quantityBySku.get(item.skuId) ?? 0) + item.quantity);
  }
  const variantIncrements = new Map<string, number>();
  for (const [skuId, quantity] of quantityBySku) {
    const sku = skuById.get(skuId);
    if (!sku) throw new HttpError(409, "A sold size/option no longer exists, so its stock cannot be restored.", "RECEIPT_VOID_SKU_MISSING");
    await tx.productSku.update({
      where: { id: sku.id },
      data: { stock: { increment: quantity }, updatedAt: now },
      select: { id: true }
    });
    movements.push({
      productId: sku.productId,
      skuId: sku.id,
      type: "ADJUSTMENT",
      quantity,
      previousStock: sku.stock,
      newStock: sku.stock + quantity,
      performedById: input.actorId,
      notes: input.note
    });
    for (const link of sku.optionValues) {
      variantIncrements.set(link.variantId, (variantIncrements.get(link.variantId) ?? 0) + quantity);
    }
  }

  // Older reservations without a SKU record their options as a text summary.
  const variantsByProduct = new Map<string, typeof variants>();
  for (const variant of variants) {
    variantsByProduct.set(variant.productId, [...(variantsByProduct.get(variant.productId) ?? []), variant]);
  }
  for (const item of reservation.items) {
    if (item.skuId) continue;
    const resolution = resolveReservationVariantSelections({
      variants: variantsByProduct.get(item.productId) ?? [],
      summary: item.variantSummary,
      strict: false
    });
    for (const variant of resolution.selected) {
      variantIncrements.set(variant.id, (variantIncrements.get(variant.id) ?? 0) + item.quantity);
      movements.push({
        productId: variant.productId,
        variantId: variant.id,
        type: "ADJUSTMENT",
        quantity: item.quantity,
        previousStock: variant.stock,
        newStock: variant.stock + item.quantity,
        performedById: input.actorId,
        notes: `${input.note} (${variant.optionName}: ${variant.optionValue})`
      });
    }
  }
  for (const [variantId, quantity] of variantIncrements) {
    await tx.productVariant.update({
      where: { id: variantId },
      data: { stock: { increment: quantity }, updatedAt: now },
      select: { id: true }
    });
  }
  if (movements.length) await tx.inventoryMovement.createMany({ data: movements });

  const allocations = await tx.orderItemCostAllocation.findMany({
    where: { reservationItemId: { in: reservation.items.map((item) => item.id) }, reversedAt: null },
    select: { id: true, inventoryBatchId: true, quantity: true }
  });
  for (const allocation of allocations) {
    await tx.inventoryBatch.update({
      where: { id: allocation.inventoryBatchId },
      data: { quantityRemaining: { increment: allocation.quantity } },
      select: { id: true }
    });
    await tx.orderItemCostAllocation.update({
      where: { id: allocation.id },
      data: { reversedAt: now, reversalReason: input.note.slice(0, 500) },
      select: { id: true }
    });
  }

  return reservation.items.reduce((total, item) => total + item.quantity, 0);
}
