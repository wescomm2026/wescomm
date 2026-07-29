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
  let statement = "";
  let values: unknown[] = [];

  const transaction = {
    $executeRaw: async (strings: TemplateStringsArray, ...parameters: unknown[]) => {
      statement = strings.join("$");
      values = parameters;
      return userIds.length;
    }
  } as unknown as Prisma.TransactionClient;

  const insertedCount = await createBackInStockNotificationsInTransaction(transaction, {
    productId,
    productName: "PE Uniform",
    previous: { stock: 0, status: "OUT_OF_STOCK", isActive: true },
    next: { stock: 12, status: "IN_STOCK", isActive: true },
    eventId
  });

  assert.equal(insertedCount, 2);
  assert.match(statement, /INSERT INTO "notifications"/);
  assert.match(statement, /FROM "wishlist_items" AS wishlist/);
  assert.match(statement, /INNER JOIN "profiles" AS profile/);
  assert.match(statement, /ON CONFLICT \("dedupe_key"\) DO NOTHING/);
  assert.deepEqual(values, [
    "PE Uniform is back in stock",
    "PE Uniform is available again. Open your wishlist to view the item.",
    `/student/shop?wishlist=1&product=${productId}`,
    `back-in-stock:${eventId}:`,
    productId
  ]);
});

test("large wishlist fanout stays one set-based database statement", async () => {
  let statementCount = 0;
  const transaction = {
    $executeRaw: async () => {
      statementCount += 1;
      return 501;
    }
  } as unknown as Prisma.TransactionClient;

  const insertedCount = await createBackInStockNotificationsInTransaction(transaction, {
    productId,
    productName: "PE Uniform",
    previous: { stock: 0, status: "OUT_OF_STOCK", isActive: true },
    next: { stock: 12, status: "IN_STOCK", isActive: true },
    eventId
  });

  assert.equal(statementCount, 1);
  assert.equal(insertedCount, 501);
});

test("an ordinary stock adjustment does not query wishlists or create notifications", async () => {
  let statementCount = 0;
  const transaction = {
    $executeRaw: async () => {
      statementCount += 1;
      return 0;
    }
  } as unknown as Prisma.TransactionClient;

  const insertedCount = await createBackInStockNotificationsInTransaction(transaction, {
    productId,
    productName: "PE Uniform",
    previous: { stock: 3, status: "RESTOCK_SOON", isActive: true },
    next: { stock: 10, status: "IN_STOCK", isActive: true },
    eventId
  });

  assert.equal(insertedCount, 0);
  assert.equal(statementCount, 0);
});

test("back-in-stock links open the student's wishlist instead of a staff inventory route", () => {
  assert.equal(notificationUrlForRole("BACK_IN_STOCK", "STUDENT"), "/student/shop?wishlist=1");
  assert.equal(notificationUrlForRole("BACK_IN_STOCK", "STAFF"), "/staff/inventory");
});
