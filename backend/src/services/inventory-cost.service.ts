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

export async function allocateWalkInSaleCostsInTransaction(
  tx: Transaction,
  input: { walkInSaleItemId: string; productId: string; skuId: string | null; quantity: number; note?: string | null }
) {
  const batches = await tx.$queryRaw<Array<{
    id: string;
    quantity_remaining: number;
    unit_cost: Prisma.Decimal;
    cost_verified: boolean;
  }>>(Prisma.sql`
    SELECT "id", "quantity_remaining", "unit_cost", "cost_verified"
    FROM "inventory_batches"
    WHERE "product_id" = ${input.productId}::uuid
      AND ${input.skuId}::uuid IS NOT DISTINCT FROM "sku_id"
      AND "quantity_remaining" > 0
    ORDER BY "received_at" ASC, "id" ASC
    FOR UPDATE
  `);
  const available = batches.reduce((sum, batch) => sum + batch.quantity_remaining, 0);
  if (available < input.quantity) {
    throw new HttpError(
      409,
      "Cost batches do not cover this walk-in sale quantity. Reconcile opening inventory costs first.",
      "BATCH_BALANCE_INSUFFICIENT"
    );
  }

  const requiredBatches = [] as typeof batches;
  let requiredQuantity = input.quantity;
  for (const batch of batches) {
    if (!requiredQuantity) break;
    requiredBatches.push(batch);
    requiredQuantity -= Math.min(requiredQuantity, batch.quantity_remaining);
  }
  if (requiredBatches.some((batch) => !batch.cost_verified)) {
    throw new HttpError(
      409,
      "This item has an opening inventory batch without a verified acquisition cost. Set its opening cost before recording the sale.",
      "UNVERIFIED_BATCH_COST"
    );
  }

  let remaining = input.quantity;
  for (const batch of batches) {
    if (!remaining) break;
    const quantity = Math.min(remaining, batch.quantity_remaining);
    await tx.inventoryBatch.update({
      where: { id: batch.id },
      data: { quantityRemaining: { decrement: quantity } }
    });
    await tx.walkInSaleCostAllocation.create({
      data: {
        walkInSaleItemId: input.walkInSaleItemId,
        inventoryBatchId: batch.id,
        quantity,
        unitCost: batch.unit_cost
      },
      select: { id: true }
    });
    remaining -= quantity;
  }
}

export async function reverseWalkInSaleCostAllocationsInTransaction(
  tx: Transaction,
  input: { walkInSaleItemId: string }
) {
  const allocations = await tx.walkInSaleCostAllocation.findMany({
    where: { walkInSaleItemId: input.walkInSaleItemId, reversedAt: null },
    select: { id: true, inventoryBatchId: true, quantity: true }
  });
  const now = new Date();
  for (const allocation of allocations) {
    await tx.inventoryBatch.update({
      where: { id: allocation.inventoryBatchId },
      data: { quantityRemaining: { increment: allocation.quantity } }
    });
    await tx.walkInSaleCostAllocation.update({
      where: { id: allocation.id },
      data: { reversedAt: now },
      select: { id: true }
    });
  }
  return allocations.length;
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

/**
 * Saves the cost of one uncosted opening batch. The write is conditional, so a
 * cost saved meanwhile (e.g. by "Apply to all sizes") is never overwritten.
 */
export async function verifyOpeningBatchCostInTransaction(
  tx: Transaction,
  input: { productId: string; batchId: string; unitCost: number }
) {
  requireRestockCost({ unitCost: input.unitCost, receivedAt: new Date() });
  const current = await tx.inventoryBatch.findFirst({
    where: { id: input.batchId, productId: input.productId },
    select: {
      id: true,
      batchCode: true,
      costVerified: true,
      costAllocations: { take: 1, select: { id: true } },
      walkInAllocations: { take: 1, select: { id: true } }
    }
  });
  if (!current) throw new HttpError(404, "Inventory batch not found.");
  if (current.costVerified) throw new HttpError(409, "This batch cost has already been verified and is immutable.", "BATCH_COST_IMMUTABLE");
  if (current.costAllocations.length || current.walkInAllocations.length) {
    throw new HttpError(409, "This opening batch was already used by a sale and requires an audited correction.", "BATCH_COST_ALREADY_ALLOCATED");
  }
  const updated = await tx.inventoryBatch.updateMany({
    where: {
      id: current.id,
      productId: input.productId,
      costVerified: false,
      costAllocations: { none: {} },
      walkInAllocations: { none: {} }
    },
    data: { unitCost: new Prisma.Decimal(input.unitCost), costVerified: true }
  });
  // Another cashier saved or used this batch between the read and this write.
  if (updated.count !== 1) {
    throw new HttpError(
      409,
      "Another staff member saved this cost at the same time. Nothing was changed. Review the sizes and try again.",
      "BATCH_COST_CONFLICT"
    );
  }
  return { id: current.id, batchCode: current.batchCode, unitCost: new Prisma.Decimal(input.unitCost) };
}

export async function verifyOpeningBatchCost(input: { productId: string; batchId: string; unitCost: number; actorId: string }) {
  const batch = await prisma.$transaction((tx) => verifyOpeningBatchCostInTransaction(tx, input));
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

function batchSizeLabel(batch: { sku: { optionSnapshot: Prisma.JsonValue } | null }) {
  const options = Array.isArray(batch.sku?.optionSnapshot) ? batch.sku.optionSnapshot : [];
  const label = options
    .map((option) => (option && typeof option === "object" && "optionValue" in option ? String(option.optionValue) : ""))
    .filter(Boolean)
    .join(" · ");
  return label || "All units";
}

/**
 * Most items cost the same in every size, so staff can verify every uncosted
 * opening batch of a product (or the chosen ones) at one unit cost. All or
 * nothing: if any chosen batch was costed, used by a sale, or removed by
 * someone else in the meantime, nothing is saved and the conflict is reported.
 */
export async function verifyOpeningBatchCostsInTransaction(
  tx: Transaction,
  input: { productId: string; batchIds?: string[]; unitCost: number }
) {
  requireRestockCost({ unitCost: input.unitCost, receivedAt: new Date() });
  const requestedIds = input.batchIds ? [...new Set(input.batchIds)] : null;
  const candidates = await tx.inventoryBatch.findMany({
    where: {
      productId: input.productId,
      ...(requestedIds ? { id: { in: requestedIds } } : { costVerified: false })
    },
    select: {
      id: true,
      batchCode: true,
      costVerified: true,
      sku: { select: { optionSnapshot: true } },
      costAllocations: { take: 1, select: { id: true } },
      walkInAllocations: { take: 1, select: { id: true } }
    }
  });
  const foundIds = new Set(candidates.map((batch) => batch.id));
  const missing = requestedIds?.filter((id) => !foundIds.has(id)) ?? [];
  const conflicts = candidates.filter((batch) => batch.costVerified || batch.costAllocations.length || batch.walkInAllocations.length);
  if (missing.length || conflicts.length) {
    const sizes = conflicts.map(batchSizeLabel);
    throw new HttpError(
      409,
      sizes.length
        ? `The cost for ${sizes.join(", ")} was already saved or used by a sale. Nothing was changed. Review the sizes and try again.`
        : "Some sizes changed while you were working. Nothing was changed. Review the sizes and try again.",
      "BATCH_COST_CONFLICT",
      { conflictingBatchIds: conflicts.map((batch) => batch.id), missingBatchIds: missing }
    );
  }
  if (!candidates.length) {
    throw new HttpError(409, "There are no uncosted batches left to update for this product.", "NO_PENDING_BATCH_COSTS");
  }
  const updated = await tx.inventoryBatch.updateMany({
    where: {
      id: { in: candidates.map((batch) => batch.id) },
      productId: input.productId,
      costVerified: false,
      costAllocations: { none: {} },
      walkInAllocations: { none: {} }
    },
    data: { unitCost: new Prisma.Decimal(input.unitCost), costVerified: true }
  });
  // Another cashier may have saved a cost between the read and this write.
  // Throwing rolls the whole transaction back, so no batch is half-updated.
  if (updated.count !== candidates.length) {
    throw new HttpError(
      409,
      "Another staff member updated some of these sizes at the same time. Nothing was changed. Review the sizes and try again.",
      "BATCH_COST_CONFLICT",
      { expected: candidates.length, updated: updated.count }
    );
  }
  return candidates;
}

export async function verifyOpeningBatchCosts(input: { productId: string; batchIds?: string[]; unitCost: number; actorId: string }) {
  requireRestockCost({ unitCost: input.unitCost, receivedAt: new Date() });
  const verified = await prisma.$transaction((tx) => verifyOpeningBatchCostsInTransaction(tx, input));
  await safelyRecordAuditLog({
    actorId: input.actorId,
    action: "OPENING_BATCH_COST_VERIFIED",
    entityType: "product",
    entityId: input.productId,
    summary: `Verified acquisition cost for ${verified.length} batch${verified.length === 1 ? "" : "es"} at one unit cost.`,
    metadata: {
      productId: input.productId,
      unitCost: input.unitCost.toFixed(2),
      batchCodes: verified.map((batch) => batch.batchCode)
    }
  });
  return listInventoryBatches(input.productId);
}
