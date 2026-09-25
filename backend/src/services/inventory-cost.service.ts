import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { HttpError } from "../utils/http-error.js";
import { prisma } from "../lib/prisma.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";

type Transaction = Prisma.TransactionClient;

export type RestockCostInput = {
  unitCost: number;
  receivedAt: Date;
  supplierNote?: string | null;
};

function batchCode(receivedAt: Date) {
  const date = receivedAt.toISOString().slice(0, 10).replaceAll("-", "");
  return `B-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function requireRestockCost(input: RestockCostInput) {
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0 || input.unitCost > 10_000_000) {
    throw new HttpError(400, "Unit acquisition cost must be from PHP 0.00 to PHP 10,000,000.00.", "INVALID_UNIT_COST");
  }
  if (Number(input.unitCost.toFixed(2)) !== input.unitCost) {
    throw new HttpError(400, "Unit acquisition cost may have at most two decimal places.", "INVALID_UNIT_COST");
  }
  if (Number.isNaN(input.receivedAt.getTime())) {
    throw new HttpError(400, "Date received is invalid.", "INVALID_RECEIVED_AT");
  }
}

export async function createInventoryBatchInTransaction(
  tx: Transaction,
  input: RestockCostInput & {
    productId: string;
    skuId?: string | null;
    quantity: number;
    createdById: string;
  }
) {
  if (input.quantity <= 0) return null;
  requireRestockCost(input);
  return tx.inventoryBatch.create({
    data: {
      batchCode: batchCode(input.receivedAt),
      productId: input.productId,
      skuId: input.skuId ?? null,
      quantityReceived: input.quantity,
      quantityRemaining: input.quantity,
      unitCost: new Prisma.Decimal(input.unitCost),
      costVerified: true,
      receivedAt: input.receivedAt,
      supplierNote: input.supplierNote?.trim() || null,
      createdById: input.createdById
    },
    select: { id: true, batchCode: true }
  });
}

export async function adjustInventoryBatchesInTransaction(
  tx: Transaction,
  input: {
    productId: string;
    skuId?: string | null;
    difference: number;
    createdById: string;
    note?: string | null;
  }
) {
  if (input.difference === 0) return;
  if (input.difference > 0) {
    await tx.inventoryBatch.create({
      data: {
        batchCode: batchCode(new Date()),
        productId: input.productId,
        skuId: input.skuId ?? null,
        quantityReceived: input.difference,
        quantityRemaining: input.difference,
        unitCost: new Prisma.Decimal(0),
        costVerified: false,
        receivedAt: new Date(),
        supplierNote: input.note?.trim() || "Positive stock-count adjustment; acquisition cost requires review.",
        createdById: input.createdById
      }
    });
    return;
  }

  let remaining = Math.abs(input.difference);
  const rows = await tx.$queryRaw<Array<{ id: string; quantity_remaining: number }>>(Prisma.sql`
    SELECT "id", "quantity_remaining"
    FROM "inventory_batches"
    WHERE "product_id" = ${input.productId}::uuid
      AND ${input.skuId ?? null}::uuid IS NOT DISTINCT FROM "sku_id"
      AND "quantity_remaining" > 0
    ORDER BY "received_at" ASC, "id" ASC
    FOR UPDATE
  `);
  const available = rows.reduce((sum, row) => sum + row.quantity_remaining, 0);
  if (available < remaining) {
    throw new HttpError(409, "Batch balances do not cover this stock correction. Review opening inventory costs first.", "BATCH_BALANCE_INSUFFICIENT");
  }
  for (const row of rows) {
    if (!remaining) break;
    const quantity = Math.min(remaining, row.quantity_remaining);
    await tx.inventoryBatch.update({ where: { id: row.id }, data: { quantityRemaining: { decrement: quantity } } });
    remaining -= quantity;
  }
}

export async function allocateFifoCostsInTransaction(
  tx: Transaction,
  items: Array<{ id: string; productId: string; skuId: string | null; quantity: number }>
) {
  for (const item of items) {
    const existing = await tx.orderItemCostAllocation.count({ where: { reservationItemId: item.id } });
    if (existing) continue;

    const batches = await tx.$queryRaw<Array<{
      id: string;
      quantity_remaining: number;
      unit_cost: Prisma.Decimal;
      cost_verified: boolean;
    }>>(Prisma.sql`
      SELECT "id", "quantity_remaining", "unit_cost", "cost_verified"
      FROM "inventory_batches"
      WHERE "product_id" = ${item.productId}::uuid
        AND ${item.skuId}::uuid IS NOT DISTINCT FROM "sku_id"
        AND "quantity_remaining" > 0
      ORDER BY "received_at" ASC, "id" ASC
      FOR UPDATE
    `);
    const available = batches.reduce((sum, batch) => sum + batch.quantity_remaining, 0);
    if (available < item.quantity) {
      throw new HttpError(
        409,
        "Cost batches do not cover the reserved quantity. Add or reconcile the opening inventory batch before releasing this order.",
        "FIFO_BATCH_STOCK_INSUFFICIENT"
      );
    }
    const requiredBatches = [] as typeof batches;
    let requiredQuantity = item.quantity;
    for (const batch of batches) {
      if (!requiredQuantity) break;
      requiredBatches.push(batch);
      requiredQuantity -= Math.min(requiredQuantity, batch.quantity_remaining);
    }
    if (requiredBatches.some((batch) => !batch.cost_verified)) {
      throw new HttpError(
        409,
        "This item has an opening inventory batch without a verified acquisition cost. Set its opening cost before releasing the order.",
        "UNVERIFIED_BATCH_COST"
      );
    }

    let remaining = item.quantity;
    for (const batch of batches) {
      if (!remaining) break;
      const quantity = Math.min(remaining, batch.quantity_remaining);
      await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: { quantityRemaining: { decrement: quantity } }
      });
      await tx.orderItemCostAllocation.create({
        data: {
          reservationItemId: item.id,
          inventoryBatchId: batch.id,
          quantity,
          unitCost: batch.unit_cost
        }
      });
      remaining -= quantity;
    }
  }
}

export async function listInventoryBatches(productId: string) {
  const batches = await prisma.inventoryBatch.findMany({
    where: { productId },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      batchCode: true,
      skuId: true,
      quantityReceived: true,
      quantityRemaining: true,
      unitCost: true,
      costVerified: true,
      receivedAt: true,
      supplierNote: true,
      sku: { select: { code: true, optionSnapshot: true } }
    }
  });
  const inventoryValue = batches.reduce((sum, batch) => sum + batch.quantityRemaining * Number(batch.unitCost), 0);
  const remainingQuantity = batches.reduce((sum, batch) => sum + batch.quantityRemaining, 0);
  const latest = batches.find((batch) => batch.costVerified);
  return {
    batches: batches.map((batch) => ({ ...batch, unitCost: batch.unitCost.toString(), receivedAt: batch.receivedAt.toISOString() })),
    summary: {
      latestCost: latest ? Number(latest.unitCost) : null,
      averageInventoryCost: remainingQuantity ? inventoryValue / remainingQuantity : null,
      inventoryValue,
      unverifiedQuantity: batches.filter((batch) => !batch.costVerified).reduce((sum, batch) => sum + batch.quantityRemaining, 0)
    }
  };
}

export async function verifyOpeningBatchCost(input: { productId: string; batchId: string; unitCost: number; actorId: string }) {
  requireRestockCost({ unitCost: input.unitCost, receivedAt: new Date() });
  const batch = await prisma.$transaction(async (tx) => {
    const current = await tx.inventoryBatch.findFirst({
      where: { id: input.batchId, productId: input.productId },
      select: { id: true, batchCode: true, costVerified: true, costAllocations: { take: 1, select: { id: true } } }
    });
    if (!current) throw new HttpError(404, "Inventory batch not found.");
    if (current.costVerified) throw new HttpError(409, "This batch cost has already been verified and is immutable.", "BATCH_COST_IMMUTABLE");
    if (current.costAllocations.length) throw new HttpError(409, "This opening batch was already used by a sale and requires an audited correction.", "BATCH_COST_ALREADY_ALLOCATED");
    return tx.inventoryBatch.update({
      where: { id: current.id },
      data: { unitCost: new Prisma.Decimal(input.unitCost), costVerified: true },
      select: { id: true, batchCode: true, unitCost: true }
    });
  });
  await safelyRecordAuditLog({
    actorId: input.actorId,
    action: "OPENING_BATCH_COST_VERIFIED",
    entityType: "inventory_batch",
    entityId: batch.id,
    summary: `Verified acquisition cost for ${batch.batchCode}.`,
    metadata: { productId: input.productId, unitCost: batch.unitCost.toString() }
  });
  return listInventoryBatches(input.productId);
}
