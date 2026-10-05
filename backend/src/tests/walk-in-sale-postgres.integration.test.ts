import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import { recordWalkInSale, voidWalkInSale } from "../services/walk-in-sale.service.js";
import { HttpError } from "../utils/http-error.js";

test("PostgreSQL keeps walk-in creation and void idempotent and preserves exact FIFO stock", async () => {
  const suffix = randomUUID();
  const studentId = randomUUID();
  const cashierId = randomUUID();
  const categoryId = randomUUID();
  const productId = randomUUID();
  const unverifiedProductId = randomUUID();
  const clientSaleId = randomUUID();
  const unverifiedClientSaleId = randomUUID();
  const receiptIds: string[] = [];

  try {
    await prisma.profile.createMany({
      data: [
        { id: studentId, fullName: "Walk-in Integration Student", email: `walk-in-student-${suffix}@example.invalid`, role: "STUDENT" },
        { id: cashierId, fullName: "Walk-in Integration Cashier", email: `walk-in-cashier-${suffix}@example.invalid`, role: "STAFF" }
      ]
    });
    await prisma.category.create({
      data: { id: categoryId, name: `Walk-in integration ${suffix}`, slug: `walk-in-integration-${suffix}` }
    });
    await prisma.product.createMany({
      data: [
        { id: productId, categoryId, name: `Walk-in product ${suffix}`, price: 100, stock: 10, status: "IN_STOCK" },
        { id: unverifiedProductId, categoryId, name: `Unverified walk-in product ${suffix}`, price: 50, stock: 1, status: "IN_STOCK" }
      ]
    });
    await prisma.inventoryBatch.createMany({
      data: [
        {
          batchCode: `WALKIN-${suffix}`,
          productId,
          quantityReceived: 10,
          quantityRemaining: 10,
          unitCost: 40,
          costVerified: true,
          receivedAt: new Date("2026-09-01T00:00:00.000Z"),
          createdById: cashierId
        },
        {
          batchCode: `WALKIN-UNVERIFIED-${suffix}`,
          productId: unverifiedProductId,
          quantityReceived: 1,
          quantityRemaining: 1,
          unitCost: 0,
          costVerified: false,
          receivedAt: new Date("2026-09-02T00:00:00.000Z"),
          createdById: cashierId
        }
      ]
    });

    const input = {
      items: [{ productId, quantity: 2 }],
      buyerName: "Walk-in Integration Student",
      studentId,
      cashReceived: 250,
      clientSaleId,
      performedById: cashierId
    };
    const concurrentCreates = await Promise.all([
      recordWalkInSale(input),
      recordWalkInSale(input)
    ]);
    const receiptId = concurrentCreates[0].receipt.id;
    receiptIds.push(receiptId);

    assert.equal(concurrentCreates[1].receipt.id, receiptId);
    assert.deepEqual(concurrentCreates.map((result) => result.created).sort(), [false, true]);
    assert.equal(await prisma.walkInSale.count({ where: { clientSaleId } }), 1);
    assert.equal(await prisma.receipt.count({ where: { id: receiptId } }), 1);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock, 8);
    assert.equal(
      (await prisma.inventoryBatch.findFirstOrThrow({ where: { productId } })).quantityRemaining,
      8
    );
    assert.equal(await prisma.walkInSaleCostAllocation.count({
      where: { item: { sale: { clientSaleId } }, reversedAt: null }
    }), 1);

    await assert.rejects(
      recordWalkInSale({ ...input, items: [{ productId, quantity: 1 }] }),
      (error: unknown) => error instanceof HttpError && error.code === "IDEMPOTENCY_PAYLOAD_MISMATCH"
    );

    const concurrentVoids = await Promise.all([
      voidWalkInSale({ receiptId, reason: "Integration void first", voidedById: cashierId }),
      voidWalkInSale({ receiptId, reason: "Integration void replay", voidedById: cashierId })
    ]);
    assert.deepEqual(concurrentVoids.map((result) => result.changed).sort(), [false, true]);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock, 10);
    assert.equal(
      (await prisma.inventoryBatch.findFirstOrThrow({ where: { productId } })).quantityRemaining,
      10
    );
    assert.equal(await prisma.walkInSaleCostAllocation.count({
      where: { item: { sale: { clientSaleId } }, reversedAt: { not: null } }
    }), 1);
    assert.equal(await prisma.inventoryMovement.count({ where: { productId } }), 2);

    await assert.rejects(
      recordWalkInSale({
        items: [{ productId: unverifiedProductId, quantity: 1 }],
        buyerName: "Walk-in Integration Student",
        studentId,
        cashReceived: 50,
        clientSaleId: unverifiedClientSaleId,
        performedById: cashierId
      }),
      (error: unknown) => error instanceof HttpError && error.code === "UNVERIFIED_BATCH_COST"
    );
    assert.equal(
      (await prisma.product.findUniqueOrThrow({ where: { id: unverifiedProductId } })).stock,
      1
    );
    assert.equal(await prisma.walkInSale.count({ where: { clientSaleId: unverifiedClientSaleId } }), 0);
  } finally {
    const sales = await prisma.walkInSale.findMany({
      where: { clientSaleId: { in: [clientSaleId, unverifiedClientSaleId] } },
      select: { receiptId: true }
    });
    receiptIds.push(...sales.map((sale) => sale.receiptId));
    const uniqueReceiptIds = Array.from(new Set(receiptIds));
    await prisma.realtimeEvent.deleteMany({ where: { entityId: { in: uniqueReceiptIds } } });
    await prisma.outboxEvent.deleteMany({ where: { entityId: { in: uniqueReceiptIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: cashierId } });
    await prisma.notification.deleteMany({ where: { userId: studentId } });
    await prisma.receipt.deleteMany({ where: { id: { in: uniqueReceiptIds } } });
    await prisma.inventoryBatch.deleteMany({ where: { productId: { in: [productId, unverifiedProductId] } } });
    await prisma.product.deleteMany({ where: { id: { in: [productId, unverifiedProductId] } } });
    await prisma.profile.deleteMany({ where: { id: { in: [studentId, cashierId] } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
  }
});
