import { Prisma } from "@prisma/client";
import { isProductAvailable } from "../domain/wishlist-policy.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { withTransientPrismaReadRetry } from "../utils/prisma-retry.js";
import { lockProductForUpdate } from "../utils/product-transaction.js";

export const WISHLIST_WRITE_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 10_000,
  timeout: 20_000
});

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
  return prisma
    .$transaction(async (transaction) => {
      const productExists = await lockProductForUpdate(transaction, productId);
      if (!productExists) throw new HttpError(404, "Product not found.");

      const product = await transaction.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          stock: true,
          status: true,
          isActive: true
        }
      });
      if (!product?.isActive) throw new HttpError(404, "Product not found.");

      const item = await transaction.wishlistItem.upsert({
        where: {
          userId_productId: { userId, productId }
        },
        create: { userId, productId },
        update: { updatedAt: new Date() },
        select: {
          productId: true,
          createdAt: true
        }
      });

      return {
        ...mapWishlistItem(item),
        isAvailable: isProductAvailable(product)
      };
    }, WISHLIST_WRITE_TRANSACTION_OPTIONS)
    .catch((error) => {
      throw mapWishlistTransactionError(error);
    });
}

export async function removeWishlistItem(userId: string, productId: string) {
  await prisma
    .$transaction(async (transaction) => {
      await lockProductForUpdate(transaction, productId);
      await transaction.wishlistItem.deleteMany({
        where: { userId, productId }
      });
    }, WISHLIST_WRITE_TRANSACTION_OPTIONS)
    .catch((error) => {
      throw mapWishlistTransactionError(error);
    });
}
