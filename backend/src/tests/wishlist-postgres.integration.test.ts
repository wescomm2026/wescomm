import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import { createBackInStockNotificationsInTransaction } from "../services/wishlist-notification.service.js";

test("PostgreSQL creates and deduplicates 501 role-filtered restock notifications in one statement", async () => {
  const suffix = randomUUID();
  const category = await prisma.category.create({
    data: {
      name: `Wishlist integration ${suffix}`,
      slug: `wishlist-integration-${suffix}`
    },
    select: { id: true }
  });
  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      name: `Wishlist integration product ${suffix}`,
      stock: 0,
      status: "OUT_OF_STOCK"
    },
    select: { id: true, name: true }
  });
  const studentIds = Array.from({ length: 501 }, () => randomUUID());
  const staffId = randomUUID();
  const profileIds = [...studentIds, staffId];
  const eventId = randomUUID();
  const dedupePrefix = `back-in-stock:${eventId}:`;

  try {
    await prisma.profile.createMany({
      data: [
        ...studentIds.map((id, index) => ({
          id,
          fullName: `Wishlist Student ${index}`,
          email: `wishlist-${suffix}-${index}@example.invalid`,
          role: "STUDENT" as const
        })),
        {
          id: staffId,
          fullName: "Wishlist Staff",
          email: `wishlist-${suffix}-staff@example.invalid`,
          role: "STAFF" as const
        }
      ]
    });
    await prisma.wishlistItem.createMany({
      data: profileIds.map((userId) => ({ userId, productId: product.id }))
    });

    const startedAt = performance.now();
    const insertedCount = await prisma.$transaction(
      (transaction) => createBackInStockNotificationsInTransaction(transaction, {
        productId: product.id,
        productName: product.name,
        previous: { stock: 0, status: "OUT_OF_STOCK", isActive: true },
        next: { stock: 25, status: "IN_STOCK", isActive: true },
        eventId
      }),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 20_000
      }
    );
    const elapsedMs = performance.now() - startedAt;

    assert.equal(insertedCount, studentIds.length);
    assert.ok(elapsedMs < 15_000, `Expected 501-row fanout under 15s, received ${elapsedMs.toFixed(0)}ms.`);

    const notifications = await prisma.notification.findMany({
      where: { dedupeKey: { startsWith: dedupePrefix } },
      select: {
        id: true,
        userId: true,
        type: true,
        actionUrl: true,
        createdAt: true,
        user: { select: { role: true } }
      }
    });

    assert.equal(notifications.length, studentIds.length);
    assert.ok(notifications.every((notification) => notification.type === "BACK_IN_STOCK"));
    assert.ok(notifications.every((notification) => notification.user.role === "STUDENT"));
    assert.ok(notifications.every((notification) => notification.actionUrl === `/student/shop?wishlist=1&product=${product.id}`));
    assert.ok(notifications.every((notification) => /^[0-9a-f-]{36}$/i.test(notification.id)));
    assert.ok(notifications.every((notification) => notification.createdAt instanceof Date));
    assert.ok(!notifications.some((notification) => notification.userId === staffId));

    const replayCount = await prisma.$transaction(
      (transaction) => createBackInStockNotificationsInTransaction(transaction, {
        productId: product.id,
        productName: product.name,
        previous: { stock: 0, status: "OUT_OF_STOCK", isActive: true },
        next: { stock: 25, status: "IN_STOCK", isActive: true },
        eventId
      })
    );
    assert.equal(replayCount, 0);
    assert.equal(
      await prisma.notification.count({ where: { dedupeKey: { startsWith: dedupePrefix } } }),
      studentIds.length
    );
  } finally {
    await prisma.product.deleteMany({ where: { id: product.id } });
    await prisma.profile.deleteMany({ where: { id: { in: profileIds } } });
    await prisma.category.deleteMany({ where: { id: category.id } });
  }
});
