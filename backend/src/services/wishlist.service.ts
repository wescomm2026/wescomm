import { Prisma } from "@prisma/client";
import { isProductAvailable } from "../domain/wishlist-policy.js";
import { prisma } from "../lib/prisma.js";
import type { ProductStatus } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import { withTransientPrismaReadRetry } from "../utils/prisma-retry.js";

function mapWishlistTransactionError(error: unknown) {
  if (error instanceof HttpError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002" || error.code === "P2034") {
      return new HttpError(
        409,
        "Wishlist changed while processing. Please try again.",
        "WISHLIST_WRITE_CONFLICT",
        { retryable: true }
      );
    }
    if (error.code === "P2024" || error.code === "P2028") {
      return new HttpError(
        503,
        "Wishlist is temporarily unavailable. Please try again.",
        "WISHLIST_TRANSACTION_UNAVAILABLE",
        { retryable: true }
      );
    }
  }
  return error;
}

function mapWishlistItem(item: { productId: string; createdAt: Date }) {
  return {
    productId: item.productId,
    createdAt: item.createdAt.toISOString()
  };
}

export async function listWishlist(userId: string) {
  const items = await withTransientPrismaReadRetry(() => prisma.wishlistItem.findMany({
    where: {
      userId,
      product: { isActive: true }
    },
    orderBy: { createdAt: "desc" },
    select: {
      productId: true,
      createdAt: true
    }
  }));

  return items.map(mapWishlistItem);
}

export async function addWishlistItem(userId: string, productId: string) {
  try {
    // Keep the product lock and idempotent upsert in one remote-DB round trip.
    // The lock preserves ordering with back-in-stock notification transactions.
    const [row] = await prisma.$queryRaw<Array<{
      productId: string;
      createdAt: Date;
      stock: number;
      status: ProductStatus;
      isActive: boolean;
    }>>`
      WITH locked_product AS MATERIALIZED (
        SELECT id, stock, status, is_active
        FROM public.products
        WHERE id = CAST(${productId} AS uuid)
          AND is_active = TRUE
        FOR UPDATE
      ), wishlist_item AS (
        INSERT INTO public.wishlist_items (user_id, product_id)
        SELECT CAST(${userId} AS uuid), id
        FROM locked_product
        ON CONFLICT (user_id, product_id)
        DO UPDATE SET updated_at = NOW()
        RETURNING product_id, created_at
      )
      SELECT
        wishlist_item.product_id AS "productId",
        wishlist_item.created_at AS "createdAt",
        locked_product.stock,
        locked_product.status,
        locked_product.is_active AS "isActive"
      FROM wishlist_item
      INNER JOIN locked_product ON locked_product.id = wishlist_item.product_id
    `;

    if (!row) throw new HttpError(404, "Product not found.");

    return {
      ...mapWishlistItem(row),
      isAvailable: isProductAvailable(row)
    };
  } catch (error) {
    throw mapWishlistTransactionError(error);
  }
}

export async function removeWishlistItem(userId: string, productId: string) {
  try {
    // Locking and deleting in one statement preserves the same notification
    // ordering guarantee without an interactive transaction's extra round trips.
    await prisma.$executeRaw`
      WITH locked_product AS MATERIALIZED (
        SELECT id
        FROM public.products
        WHERE id = CAST(${productId} AS uuid)
        FOR UPDATE
      )
      DELETE FROM public.wishlist_items AS wishlist
      USING locked_product
      WHERE wishlist.user_id = CAST(${userId} AS uuid)
        AND wishlist.product_id = locked_product.id
    `;
  } catch (error) {
    throw mapWishlistTransactionError(error);
  }
}
