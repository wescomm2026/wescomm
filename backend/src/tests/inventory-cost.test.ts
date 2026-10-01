import { Prisma } from "@prisma/client";
import assert from "node:assert/strict";
import test from "node:test";
import { allocateFifoCostsInTransaction, requireRestockCost } from "../services/inventory-cost.service.js";

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
