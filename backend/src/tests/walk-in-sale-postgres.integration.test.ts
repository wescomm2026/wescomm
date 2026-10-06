import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { isTreasuryOrUniqueViolationTarget } from "../domain/treasury-official-receipt.js";
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

test("PostgreSQL records Treasury walk-ins without cash and blocks OR reuse across walk-ins and reservations", async () => {
  const suffix = randomUUID();
  const studentId = randomUUID();
  const cashierId = randomUUID();
  const categoryId = randomUUID();
  const productId = randomUUID();
  const reservationId = randomUUID();
  const clientSaleId = randomUUID();
  const duplicateClientSaleId = randomUUID();
  const officialReceiptNumber = ` or-${suffix.slice(0, 6)} 01 `;
  const normalizedOr = `OR${suffix.slice(0, 6).toUpperCase()}01`;
  const receiptIds: string[] = [];

  try {
    await prisma.profile.createMany({
      data: [
        { id: studentId, fullName: "Treasury Integration Student", email: `treasury-student-${suffix}@example.invalid`, role: "STUDENT" },
        { id: cashierId, fullName: "Treasury Integration Cashier", email: `treasury-cashier-${suffix}@example.invalid`, role: "STAFF" }
      ]
    });
    await prisma.category.create({
      data: { id: categoryId, name: `Treasury integration ${suffix}`, slug: `treasury-integration-${suffix}` }
    });
    await prisma.product.create({
      data: { id: productId, categoryId, name: `Treasury product ${suffix}`, price: 75, stock: 5, status: "IN_STOCK" }
    });

    const input = {
      items: [{ productId, quantity: 2 }],
      buyerName: "Treasury Walk-in Buyer",
      collectionChannel: "TREASURER" as const,
      officialReceiptNumber,
      treasuryReceiptInspected: true,
      clientSaleId,
      performedById: cashierId
    };
    const created = await recordWalkInSale(input);
    receiptIds.push(created.receipt.id);
    assert.equal(created.created, true);
    assert.equal(created.receipt.collectionChannel, "TREASURER");
    assert.equal(created.receipt.officialReceiptNumber, `OR-${suffix.slice(0, 6).toUpperCase()} 01`);
    assert.equal(created.receipt.sale?.cashTendered, null);
    assert.equal(created.receipt.sale?.changeDue, null);
    assert.equal(created.receipt.sale?.treasuryVerifiedById, cashierId);
    assert.ok(created.receipt.sale?.treasuryVerifiedAt);
    assert.match(created.receipt.publicVerificationUrl ?? "", /\/verify-receipt#v=/);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock, 3);
    assert.equal(
      (await prisma.treasuryOfficialReceipt.findUniqueOrThrow({ where: { normalizedOfficialReceiptNumber: normalizedOr } })).sourceType,
      "WALK_IN_SALE"
    );

    const replay = await recordWalkInSale(input);
    assert.equal(replay.created, false);
    assert.equal(replay.receipt.id, created.receipt.id);

    await assert.rejects(
      recordWalkInSale({ ...input, clientSaleId: duplicateClientSaleId, officialReceiptNumber: normalizedOr.toLowerCase() }),
      (error: unknown) => error instanceof HttpError && error.code === "TREASURER_OR_DUPLICATE"
    );
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock, 3);

    // The registry trigger, not the service pre-check, is the guard against
    // concurrent writers and against reservation payments.
    await prisma.reservation.create({
      data: { id: reservationId, studentId, referenceCode: `RSV-TREASURY-${suffix}`, totalAmount: 75 }
    });
    await assert.rejects(
      prisma.payment.create({
        data: {
          reservationId,
          amount: 75,
          paymentMethod: "CASH",
          collectionChannel: "TREASURER",
          officialReceiptNumber: `${normalizedOr.slice(0, 4)} - ${normalizedOr.slice(4)}`
        }
      }),
      (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2002"
        && isTreasuryOrUniqueViolationTarget(error.meta?.target)
    );

    await assert.rejects(prisma.walkInSale.update({
      where: { clientSaleId },
      data: { cashTendered: 200 }
    }));

    const voided = await voidWalkInSale({ receiptId: created.receipt.id, reason: "Treasury integration void", voidedById: cashierId });
    assert.equal(voided.receipt.treasuryReconciliationRequired, true);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock, 5);
    assert.ok(await prisma.treasuryOfficialReceipt.findUnique({ where: { normalizedOfficialReceiptNumber: normalizedOr } }));
    await assert.rejects(
      recordWalkInSale({ ...input, clientSaleId: duplicateClientSaleId }),
      (error: unknown) => error instanceof HttpError && error.code === "TREASURER_OR_DUPLICATE"
    );
  } finally {
    const uniqueReceiptIds = Array.from(new Set(receiptIds));
    await prisma.payment.deleteMany({ where: { reservationId } });
    await prisma.reservation.deleteMany({ where: { id: reservationId } });
    await prisma.realtimeEvent.deleteMany({ where: { entityId: { in: uniqueReceiptIds } } });
    await prisma.outboxEvent.deleteMany({ where: { entityId: { in: uniqueReceiptIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: cashierId } });
    await prisma.receipt.deleteMany({ where: { id: { in: uniqueReceiptIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.profile.deleteMany({ where: { id: { in: [studentId, cashierId] } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
  }
});
