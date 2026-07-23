import type { Prisma } from "@prisma/client";
import assert from "node:assert/strict";
import test from "node:test";
import { notificationUrlForRole } from "../services/push.service.js";
import { createBackInStockNotificationsInTransaction } from "../services/wishlist-notification.service.js";

const productId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const userIds = [
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444"
];

test("one deduplicated notification is created for each user wishing for a restocked product", async () => {
  let wishlistWhere: unknown;
  let createArguments: {
    data: Array<{
      userId: string;
      type: string;
      title: string;
      message: string;
      actionUrl: string;
      dedupeKey: string;
    }>;
    skipDuplicates: boolean;
  } | undefined;

  const transaction = {
    wishlistItem: {
      findMany: async (arguments_: { where: unknown }) => {
        wishlistWhere = arguments_.where;
        return userIds.map((userId) => ({ userId }));
      }
    },
    notification: {
      createManyAndReturn: async (arguments_: typeof createArguments) => {
        createArguments = arguments_;
        return (arguments_?.data ?? []).map((notification, index) => ({
          id: `${index + 5}5555555-5555-4555-8555-555555555555`,
          userId: notification.userId,
          title: notification.title,
          message: notification.message,
          type: "BACK_IN_STOCK",
          actionUrl: notification.actionUrl
        }));
      }
    }
  } as unknown as Prisma.TransactionClient;

  const notifications = await createBackInStockNotificationsInTransaction(transaction, {
    productId,
    productName: "PE Uniform",
    previous: { stock: 0, status: "OUT_OF_STOCK", isActive: true },
    next: { stock: 12, status: "IN_STOCK", isActive: true },
    eventId
  });

  assert.deepEqual(wishlistWhere, {
    productId,
    user: { role: "STUDENT" }
  });
  assert.equal(createArguments?.skipDuplicates, true);
  assert.equal(createArguments?.data.length, 2);
  assert.deepEqual(
    createArguments?.data.map((notification) => notification.dedupeKey),
    userIds.map((userId) => `back-in-stock:${eventId}:${userId}`)
  );
  assert.ok(
    createArguments?.data.every(
      (notification) =>
        notification.type === "BACK_IN_STOCK" &&
        notification.actionUrl === `/student/shop?wishlist=1&product=${productId}`
    )
  );
  assert.deepEqual(notifications.map((notification) => notification.userId), userIds);
});

test("large wishlist notification writes are split into bounded batches", async () => {
  const largeWishlist = Array.from({ length: 501 }, (_, index) => ({ userId: `student-${index}` }));
  const batchSizes: number[] = [];
  const transaction = {
    wishlistItem: {
      findMany: async () => largeWishlist
    },
    notification: {
      createManyAndReturn: async (arguments_: {
        data: Array<{
          userId: string;
          title: string;
          message: string;
          actionUrl: string;
        }>;
      }) => {
        batchSizes.push(arguments_.data.length);
        return arguments_.data.map((notification, index) => ({
          id: `notification-${batchSizes.length}-${index}`,
          userId: notification.userId,
          title: notification.title,
          message: notification.message,
          type: "BACK_IN_STOCK",
          actionUrl: notification.actionUrl
        }));
      }
    }
  } as unknown as Prisma.TransactionClient;

  const notifications = await createBackInStockNotificationsInTransaction(transaction, {
    productId,
    productName: "PE Uniform",
    previous: { stock: 0, status: "OUT_OF_STOCK", isActive: true },
    next: { stock: 12, status: "IN_STOCK", isActive: true },
    eventId
  });

  assert.deepEqual(batchSizes, [500, 1]);
  assert.equal(notifications.length, 501);
});

test("an ordinary stock adjustment does not query wishlists or create notifications", async () => {
  let wishlistQueries = 0;
  let notificationWrites = 0;
  const transaction = {
    wishlistItem: {
      findMany: async () => {
        wishlistQueries += 1;
        return [];
      }
    },
    notification: {
      createManyAndReturn: async () => {
        notificationWrites += 1;
        return [];
      }
    }
  } as unknown as Prisma.TransactionClient;

  const notifications = await createBackInStockNotificationsInTransaction(transaction, {
    productId,
    productName: "PE Uniform",
    previous: { stock: 3, status: "RESTOCK_SOON", isActive: true },
    next: { stock: 10, status: "IN_STOCK", isActive: true },
    eventId
  });

  assert.deepEqual(notifications, []);
  assert.equal(wishlistQueries, 0);
  assert.equal(notificationWrites, 0);
});

test("back-in-stock pushes open the student's wishlist instead of a staff inventory route", () => {
  assert.equal(notificationUrlForRole("BACK_IN_STOCK", "STUDENT"), "/student/shop?wishlist=1");
  assert.equal(notificationUrlForRole("BACK_IN_STOCK", "STAFF"), "/staff/inventory");
});
