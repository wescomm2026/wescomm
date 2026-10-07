import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import { voidReceipt } from "../services/receipt.service.js";
import { updateReservationStatus } from "../services/reservation.service.js";
import { HttpError } from "../utils/http-error.js";

test("PostgreSQL voiding a picked-up reservation receipt returns its stock and reverses FIFO cost once", async () => {
  const suffix = randomUUID();
  const studentId = randomUUID();
  const staffId = randomUUID();
  const adminId = randomUUID();
  const categoryId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const skuId = randomUUID();
  const reservationId = randomUUID();

  try {
    await prisma.profile.createMany({
      data: [
        { id: studentId, fullName: "Void Integration Student", email: `void-student-${suffix}@example.invalid`, role: "STUDENT" },
        { id: staffId, fullName: "Void Integration Staff", email: `void-staff-${suffix}@example.invalid`, role: "STAFF" },
        { id: adminId, fullName: "Void Integration Admin", email: `void-admin-${suffix}@example.invalid`, role: "ADMIN" }
      ]
    });
    await prisma.category.create({ data: { id: categoryId, name: `Void integration ${suffix}`, slug: `void-integration-${suffix}` } });
    // 10 shirts received; 2 of size M are held by the reservation (stock already deducted).
    await prisma.product.create({
      data: { id: productId, categoryId, name: `Void PE Shirt ${suffix}`, price: 300, stock: 8, status: "IN_STOCK", saleMode: "OPTIONS", skuInventoryEnabled: true }
    });
    await prisma.productVariant.create({ data: { id: variantId, productId, optionName: "Size", optionValue: "M", stock: 3 } });
    await prisma.productSku.create({ data: { id: skuId, productId, code: `VOID-M-${suffix}`, stock: 3 } });
    await prisma.productSkuVariant.create({ data: { skuId, variantId } });
    await prisma.inventoryBatch.create({
      data: {
        batchCode: `VOID-${suffix}`,
        productId,
        skuId,
        quantityReceived: 5,
        quantityRemaining: 5,
        unitCost: 120,
        costVerified: true,
        receivedAt: new Date("2026-09-01T00:00:00.000Z"),
        createdById: staffId
      }
    });
    await prisma.reservation.create({
      data: {
        id: reservationId,
        studentId,
        referenceCode: `VOID-${suffix}`,
        status: "READY_FOR_PICKUP",
        paymentMethod: "CASH",
        totalAmount: 600,
        items: {
          create: [{
            productId,
            skuId,
            productNameSnapshot: `Void PE Shirt ${suffix}`,
            variantSummary: "Size: M",
            quantity: 2,
            unitPrice: 300,
            subtotal: 600
          }]
        }
      }
    });

    const completed = await updateReservationStatus(reservationId, "COMPLETED", staffId, "STAFF", { paymentMethod: "CASH", collectionChannel: "COMMISSARY" });
    const receiptId = completed.receipt!.id;
    assert.equal((await prisma.inventoryBatch.findFirstOrThrow({ where: { productId } })).quantityRemaining, 3);

    // Past the 2-day window: staff are refused, nothing changes.
    await prisma.receipt.update({ where: { id: receiptId }, data: { issuedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) } });
    await assert.rejects(
      voidReceipt(receiptId, { id: staffId, role: "STAFF" }, "Wrong size - exchange"),
      (error: unknown) => error instanceof HttpError && error.code === "RECEIPT_VOID_WINDOW_CLOSED"
    );
    assert.equal((await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } })).status, "PENDING");
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock, 8);

    // Within the window: staff can void; stock, size, and cost batches come back exactly once.
    await prisma.receipt.update({ where: { id: receiptId }, data: { issuedAt: new Date() } });
    const voided = await voidReceipt(receiptId, { id: staffId, role: "STAFF" }, "Wrong size - exchange");
    assert.equal(voided.status, "VOIDED");
    assert.equal(voided.voidableUntil, null);
    const replay = await voidReceipt(receiptId, { id: adminId, role: "ADMIN" }, "Replay");
    assert.equal(replay.status, "VOIDED");

    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock, 10);
    assert.equal((await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } })).stock, 5);
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock, 5);
    assert.equal((await prisma.inventoryBatch.findFirstOrThrow({ where: { productId } })).quantityRemaining, 5);
    assert.equal(await prisma.orderItemCostAllocation.count({ where: { reservationItem: { reservationId }, reversedAt: null } }), 0);
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { reservationId } })).status, "VOIDED");
    assert.equal(await prisma.inventoryMovement.count({ where: { productId, type: "ADJUSTMENT" } }), 2);
  } finally {
    const receipts = await prisma.receipt.findMany({ where: { reservationId }, select: { id: true } });
    const entityIds = [reservationId, ...receipts.map((receipt) => receipt.id)];
    await prisma.realtimeEvent.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.outboxEvent.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [staffId, adminId] } } });
    await prisma.notification.deleteMany({ where: { userId: { in: [studentId, staffId, adminId] } } });
    await prisma.receipt.deleteMany({ where: { reservationId } });
    await prisma.payment.deleteMany({ where: { reservationId } });
    await prisma.orderItemCostAllocation.deleteMany({ where: { reservationItem: { reservationId } } });
    await prisma.inventoryMovement.deleteMany({ where: { productId } });
    await prisma.reservationItem.deleteMany({ where: { reservationId } });
    await prisma.reservation.deleteMany({ where: { id: reservationId } });
    await prisma.inventoryBatch.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.profile.deleteMany({ where: { id: { in: [studentId, staffId, adminId] } } });
  }
});
