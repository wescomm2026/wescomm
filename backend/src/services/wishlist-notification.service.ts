import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  backInStockDedupeKey,
  isBackInStockTransition,
  type ProductAvailabilityState
} from "../domain/wishlist-policy.js";
import { sendPushToUser } from "./push.service.js";

export type BackInStockNotification = {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: "BACK_IN_STOCK";
  actionUrl: string | null;
};

export async function createBackInStockNotificationsInTransaction(
  transaction: Prisma.TransactionClient,
  input: {
    productId: string;
    productName: string;
    previous: ProductAvailabilityState;
    next: ProductAvailabilityState;
    eventId?: string;
  }
) {
  if (!isBackInStockTransition(input.previous, input.next)) {
    return [] satisfies BackInStockNotification[];
  }

  const wishlistItems = await transaction.wishlistItem.findMany({
    where: {
      productId: input.productId,
      user: { role: "STUDENT" }
    },
    select: { userId: true }
  });
  if (!wishlistItems.length) return [] satisfies BackInStockNotification[];

  const eventId = input.eventId ?? randomUUID();
  const actionUrl = `/student/shop?wishlist=1&product=${encodeURIComponent(input.productId)}`;

  const notificationRows = wishlistItems.map(({ userId }) => ({
      userId,
      type: "BACK_IN_STOCK" as const,
      title: `${input.productName} is back in stock`,
      message: `${input.productName} is available again. Open your wishlist to view the item.`,
      actionUrl,
      dedupeKey: backInStockDedupeKey(eventId, userId)
  }));
  const notifications: BackInStockNotification[] = [];
  const insertBatchSize = 500;

  for (let index = 0; index < notificationRows.length; index += insertBatchSize) {
    const created = await transaction.notification.createManyAndReturn({
      data: notificationRows.slice(index, index + insertBatchSize),
      skipDuplicates: true,
      select: {
        id: true,
        userId: true,
        title: true,
        message: true,
        type: true,
        actionUrl: true
      }
    });

    notifications.push(
      ...created.map((notification) => ({
        ...notification,
        type: "BACK_IN_STOCK" as const
      }))
    );
  }

  return notifications;
}

export async function dispatchBackInStockPushNotifications(notifications: BackInStockNotification[]) {
  if (!notifications.length) return;

  try {
    const batchSize = 25;
    for (let index = 0; index < notifications.length; index += batchSize) {
      const batch = notifications.slice(index, index + batchSize);
      const results = await Promise.allSettled(
        batch.map((notification) =>
          sendPushToUser(
            notification.userId,
            {
              id: notification.id,
              title: notification.title,
              message: notification.message,
              type: notification.type,
              url: notification.actionUrl ?? "/student/shop?wishlist=1"
            },
            "STUDENT"
          )
        )
      );
      results.forEach((result) => {
        if (result.status === "rejected") {
          const message = result.reason instanceof Error ? result.reason.message : "Unknown push delivery error.";
          console.warn(`Unable to deliver a back-in-stock push: ${message}`);
        }
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown push dispatch error.";
    console.warn(`Unable to dispatch back-in-stock push notifications: ${message}`);
  }
}
