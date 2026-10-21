import { Prisma } from "@prisma/client";
import assert from "node:assert/strict";
import test from "node:test";
import { allocateFifoCostsInTransaction, requireRestockCost, verifyOpeningBatchCostInTransaction, verifyOpeningBatchCostsInTransaction } from "../services/inventory-cost.service.js";
import { HttpError } from "../utils/http-error.js";

function fakeTransaction(batches: Array<{ id: string; quantity: number; cost: number; verified?: boolean }>) {
  const decrements: Array<{ id: string; quantity: number }> = [];
  const allocations: Array<{ batchId: string; quantity: number; unitCost: number }> = [];
  const transaction = {
    orderItemCostAllocation: {
      count: async () => 0,
      create: async ({ data }: { data: { inventoryBatchId: string; quantity: number; unitCost: Prisma.Decimal } }) => {
        allocations.push({ batchId: data.inventoryBatchId, quantity: data.quantity, unitCost: Number(data.unitCost) });
        return data;
      }
    },
    inventoryBatch: {
      update: async ({ where, data }: { where: { id: string }; data: { quantityRemaining: { decrement: number } } }) => {
        decrements.push({ id: where.id, quantity: data.quantityRemaining.decrement });
        return where;
      }
    },
    $queryRaw: async () => batches.map((batch) => ({
      id: batch.id,
      quantity_remaining: batch.quantity,
      unit_cost: new Prisma.Decimal(batch.cost),
      cost_verified: batch.verified ?? true
    }))
  } as unknown as Prisma.TransactionClient;
  return { transaction, decrements, allocations };
}

test("FIFO allocation preserves the exact cost layers used by a completed order", async () => {
  const { transaction, decrements, allocations } = fakeTransaction([
    { id: "B001", quantity: 100, cost: 180 },
    { id: "B002", quantity: 100, cost: 200 }
  ]);

  await allocateFifoCostsInTransaction(transaction, [{ id: "item-1", productId: "product-1", skuId: null, quantity: 120 }]);

  assert.deepEqual(decrements, [{ id: "B001", quantity: 100 }, { id: "B002", quantity: 20 }]);
  assert.deepEqual(allocations, [
    { batchId: "B001", quantity: 100, unitCost: 180 },
    { batchId: "B002", quantity: 20, unitCost: 200 }
  ]);
  assert.equal(allocations.reduce((total, allocation) => total + allocation.quantity * allocation.unitCost, 0), 22_000);
});

test("FIFO release fails closed when an opening cost has not been verified", async () => {
  const { transaction, decrements, allocations } = fakeTransaction([{ id: "OPEN-1", quantity: 20, cost: 0, verified: false }]);
  await assert.rejects(
    allocateFifoCostsInTransaction(transaction, [{ id: "item-1", productId: "product-1", skuId: null, quantity: 1 }]),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "UNVERIFIED_BATCH_COST")
  );
  assert.deepEqual(decrements, []);
  assert.deepEqual(allocations, []);
});

test("restock cost validation rejects negative, over-precise, and invalid inputs", () => {
  assert.throws(() => requireRestockCost({ unitCost: -1, receivedAt: new Date() }));
  assert.throws(() => requireRestockCost({ unitCost: 10.001, receivedAt: new Date() }));
  assert.throws(() => requireRestockCost({ unitCost: 10, receivedAt: new Date("invalid") }));
  assert.doesNotThrow(() => requireRestockCost({ unitCost: 0, receivedAt: new Date("2026-09-24") }));
});

type FakeOpeningBatch = { id: string; size: string; verified?: boolean; usedBySale?: boolean };

function fakeOpeningBatchTransaction(batches: FakeOpeningBatch[], options: { concurrentlyVerified?: string[] } = {}) {
  const updates: Array<{ ids: string[]; unitCost: number }> = [];
  const transaction = {
    inventoryBatch: {
      findMany: async ({ where }: { where: { id?: { in: string[] }; costVerified?: boolean } }) => batches
        .filter((batch) => (where.id ? where.id.in.includes(batch.id) : !batch.verified))
        .map((batch) => ({
          id: batch.id,
          batchCode: `B-${batch.size}`,
          costVerified: Boolean(batch.verified),
          sku: { optionSnapshot: [{ optionName: "Size", optionValue: batch.size }] },
          costAllocations: batch.usedBySale ? [{ id: "allocation" }] : [],
          walkInAllocations: []
        })),
      // Batches another cashier verified after the read no longer match costVerified: false.
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { unitCost: Prisma.Decimal } }) => {
        const ids = where.id.in.filter((id) => !options.concurrentlyVerified?.includes(id));
        updates.push({ ids, unitCost: Number(data.unitCost) });
        return { count: ids.length };
      }
    }
  } as unknown as Prisma.TransactionClient;
  return { transaction, updates };
}

function batchCostConflict(error: unknown) {
  return error instanceof HttpError && error.status === 409 && error.code === "BATCH_COST_CONFLICT";
}

test("one unit cost is saved for every uncosted size", async () => {
  const { transaction, updates } = fakeOpeningBatchTransaction([{ id: "S", size: "S" }, { id: "M", size: "M" }, { id: "L", size: "L" }]);
  const verified = await verifyOpeningBatchCostsInTransaction(transaction, { productId: "product-1", batchIds: ["S", "M", "L"], unitCost: 180 });
  assert.deepEqual(verified.map((batch) => batch.id), ["S", "M", "L"]);
  assert.deepEqual(updates, [{ ids: ["S", "M", "L"], unitCost: 180 }]);
});

test("a size that was already costed or sold blocks the bulk cost and names the size", async () => {
  const { transaction, updates } = fakeOpeningBatchTransaction([{ id: "S", size: "S" }, { id: "M", size: "M", verified: true }, { id: "L", size: "L", usedBySale: true }]);
  await assert.rejects(
    verifyOpeningBatchCostsInTransaction(transaction, { productId: "product-1", batchIds: ["S", "M", "L"], unitCost: 180 }),
    (error: unknown) => batchCostConflict(error) && /M, L/.test((error as Error).message) && /Nothing was changed/.test((error as Error).message)
  );
  assert.deepEqual(updates, []);
});

test("a chosen size that no longer exists blocks the bulk cost", async () => {
  const { transaction, updates } = fakeOpeningBatchTransaction([{ id: "S", size: "S" }]);
  await assert.rejects(
    verifyOpeningBatchCostsInTransaction(transaction, { productId: "product-1", batchIds: ["S", "GONE"], unitCost: 180 }),
    batchCostConflict
  );
  assert.deepEqual(updates, []);
});

test("a cost saved by another cashier mid-update fails the whole bulk update instead of reporting success", async () => {
  const { transaction } = fakeOpeningBatchTransaction([{ id: "S", size: "S" }, { id: "M", size: "M" }], { concurrentlyVerified: ["M"] });
  // The thrown error rolls back the surrounding transaction, so S is not saved either.
  await assert.rejects(
    verifyOpeningBatchCostsInTransaction(transaction, { productId: "product-1", batchIds: ["S", "M"], unitCost: 180 }),
    (error: unknown) => batchCostConflict(error) && /at the same time/.test((error as Error).message)
  );
});

function fakeSingleBatchTransaction(options: { verified?: boolean; savedMeanwhile?: boolean }) {
  const updates: Array<{ id: string; unitCost: number }> = [];
  const transaction = {
    inventoryBatch: {
      findFirst: async () => ({ id: "M", batchCode: "B-M", costVerified: Boolean(options.verified), costAllocations: [], walkInAllocations: [] }),
      // A bulk save that landed after the read no longer matches costVerified: false.
      updateMany: async ({ where, data }: { where: { id: string }; data: { unitCost: Prisma.Decimal } }) => {
        if (options.savedMeanwhile) return { count: 0 };
        updates.push({ id: where.id, unitCost: Number(data.unitCost) });
        return { count: 1 };
      }
    }
  } as unknown as Prisma.TransactionClient;
  return { transaction, updates };
}

test("saving one size's cost writes only while the batch is still uncosted", async () => {
  const { transaction, updates } = fakeSingleBatchTransaction({});
  const batch = await verifyOpeningBatchCostInTransaction(transaction, { productId: "product-1", batchId: "M", unitCost: 190 });
  assert.equal(batch.batchCode, "B-M");
  assert.deepEqual(updates, [{ id: "M", unitCost: 190 }]);
});

test("a single-size save never overwrites a cost saved meanwhile by Apply to all sizes", async () => {
  const { transaction, updates } = fakeSingleBatchTransaction({ savedMeanwhile: true });
  await assert.rejects(
    verifyOpeningBatchCostInTransaction(transaction, { productId: "product-1", batchId: "M", unitCost: 190 }),
    (error: unknown) => batchCostConflict(error) && /Nothing was changed/.test((error as Error).message)
  );
  assert.deepEqual(updates, []);
});

test("a single-size save is refused once the cost is already verified", async () => {
  const { transaction, updates } = fakeSingleBatchTransaction({ verified: true });
  await assert.rejects(
    verifyOpeningBatchCostInTransaction(transaction, { productId: "product-1", batchId: "M", unitCost: 190 }),
    (error: unknown) => error instanceof HttpError && error.status === 409 && error.code === "BATCH_COST_IMMUTABLE"
  );
  assert.deepEqual(updates, []);
});
