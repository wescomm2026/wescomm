import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  isBackInStockTransition,
  type ProductAvailabilityState
} from "../domain/wishlist-policy.js";

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
    return 0;
  }

  const eventId = input.eventId ?? randomUUID();
  const actionUrl = `/student/shop?wishlist=1&product=${encodeURIComponent(input.productId)}`;
  const dedupePrefix = `back-in-stock:${eventId}:`;
  const title = `${input.productName} is back in stock`;
  const message = `${input.productName} is available again. Open your wishlist to view the item.`;

  // Keep stock mutations bounded to one set-based database statement. Durable
  // in-app notifications are polled by the client; provider push fanout needs a
  // separate outbox worker and must not run inside the mutation request.
  return transaction.$executeRaw`
    INSERT INTO "notifications" (
      "user_id",
      "type",
      "title",
      "message",
      "action_url",
      "dedupe_key"
    )
    SELECT
      wishlist."user_id",
      'BACK_IN_STOCK'::"notification_type",
      ${title},
      ${message},
      ${actionUrl},
      ${dedupePrefix} || wishlist."user_id"::text
    FROM "wishlist_items" AS wishlist
    INNER JOIN "profiles" AS profile
      ON profile."id" = wishlist."user_id"
    WHERE wishlist."product_id" = ${input.productId}::uuid
      AND profile."role" = 'STUDENT'::"app_role"
    ON CONFLICT ("dedupe_key") DO NOTHING
  `;
}
