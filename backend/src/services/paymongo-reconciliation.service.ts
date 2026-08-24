import { Prisma, type ProductStatus as PrismaProductStatus } from "@prisma/client";
import { env } from "../config/env.js";
import {
  assertOnlinePaymentTransition,
  canSafelyRecoverPaymongoCreate,
  PAYMONGO_CREATE_RECOVERY_WINDOW_MS,
  PAYMONGO_PROVIDER_IDEMPOTENCY_WINDOW_MS
} from "../domain/online-payment.js";
import { deriveProductStatus } from "../domain/reservation-state.js";
import {
  validateRecognizedCheckoutIdentity,
  validateRecognizedPaidCheckout,
  type PersistedCheckoutAttempt,
  type RecognizedOnlinePayment
} from "../domain/paymongo-payment-validation.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";
import {
  expirePaymongoCheckoutSession,
  getPaymongoCheckoutSession,
  parseStoredPaymongoCheckoutRequest,
  recoverPaymongoCheckoutSessionFromRequest
} from "./paymongo-client.js";
import {
  applyVerifiedPaidCheckoutInTransaction,
  dispatchPaymentPush,
  recordRejectedPaymentAuditInTransaction
} from "./paymongo-payment-transition.service.js";
import { createBackInStockNotificationsInTransaction } from "./wishlist-notification.service.js";

const STUDENT_RECONCILIATION_THROTTLE_MS = 15_000;
const MAINTENANCE_RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;
const RECENT_EXPIRED_RECHECK_WINDOW_MS = 24 * 60 * 60 * 1000;
const EXPIRED_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UNKNOWN_RECOVERY_DELAY_MS = 60 * 1000;
const PROVIDER_FAILURE_REVIEW_DELAY_MS = 24 * 60 * 60 * 1000;

type PaymentPush = Parameters<typeof dispatchPaymentPush>[0];
type ReconciliationResult = {
  reconciled: boolean;
  status?: "REJECTED" | "PAID" | "EXPIRED" | "ACTIVE";
  reason?: string;
  reasonCode?: string;
};
type ExpirationResult = { expired: boolean; reason: string };
type RecoveryResult = { recovered: boolean; expired: boolean; errorCode?: string };
type InventoryReleaseResult = {
  cancelled: boolean;
  inventoryReviewRequired: boolean;
  reviewReason: string | null;
  backInStockNotificationCount: number;
};

function parseVariantSelections(summary?: string | null) {
  if (!summary?.trim()) return [];
  return summary
    .split("|")
    .map((section) => section.trim())
    .filter((section) => section && !section.toLowerCase().startsWith("note:"))
    .flatMap((section) => section.split(","))
    .map((part) => part.trim())
    .map((part) => {
      const separatorIndex = part.indexOf(":");
      if (separatorIndex === -1) return null;
      const optionName = part.slice(0, separatorIndex).trim();
      const optionValue = part.slice(separatorIndex + 1).trim();
      return optionName && optionValue ? { optionName, optionValue } : null;
    })
    .filter((selection): selection is { optionName: string; optionValue: string } => Boolean(selection));
}

async function cancelPendingReservationAndReleaseHeldInventory(input: {
  tx: Prisma.TransactionClient;
  reservation: {
    id: string;
    status: string;
    referenceCode: string;
    items: Array<{ productId: string; skuId: string | null; variantSummary: string | null; quantity: number }>;
  };
  actorId?: string | null;
  reason: string;
}): Promise<InventoryReleaseResult> {
  const now = new Date();
  const holdNote = `Reservation ${input.reservation.referenceCode}`;
  const holdMovements = (await input.tx.inventoryMovement.findMany({
    where: {
      type: "RESERVATION_HOLD",
      notes: { startsWith: holdNote }
    },
    select: {
      productId: true,
      variantId: true,
      skuId: true,
      quantity: true,
      notes: true,
      variant: {
        select: {
          id: true,
          productId: true,
          optionName: true,
          optionValue: true,
          stock: true
        }
      },
      sku: {
        select: {
          id: true,
          productId: true,
          stock: true,
          optionValues: { select: { variantId: true } }
        }
      }
    }
  }));

  const expectedBaseQuantity = input.reservation.items.reduce((map, item) => {
    map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
    return map;
  }, new Map<string, number>());
  const expectedVariantQuantity = input.reservation.items.reduce((map, item) => {
    if (item.skuId) return map;
    const selectedVariantCount = parseVariantSelections(item.variantSummary).length;
    if (selectedVariantCount > 0) {
      map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity * selectedVariantCount);
    }
    return map;
  }, new Map<string, number>());
  const expectedSkuQuantity = input.reservation.items.reduce((map, item) => {
    if (item.skuId) map.set(item.skuId, (map.get(item.skuId) ?? 0) + item.quantity);
    return map;
  }, new Map<string, number>());

  const baseMovements = holdMovements.filter((movement) => movement.notes === holdNote && !movement.variantId && !movement.skuId);
  const variantMovements = holdMovements.filter((movement) => Boolean(movement.variantId));
  const skuMovements = holdMovements.filter((movement) => Boolean(movement.skuId));
  const unrecognizedMovements = holdMovements.filter((movement) => (
    movement.notes !== holdNote && !movement.variantId && !movement.skuId
  ));

  const heldBaseQuantity = baseMovements.reduce((map, movement) => {
    map.set(movement.productId, (map.get(movement.productId) ?? 0) + movement.quantity);
    return map;
  }, new Map<string, number>());
  const heldVariantQuantity = variantMovements.reduce((map, movement) => {
    map.set(movement.productId, (map.get(movement.productId) ?? 0) + movement.quantity);
    return map;
  }, new Map<string, number>());
  const heldSkuQuantity = skuMovements.reduce((map, movement) => {
    if (movement.skuId) map.set(movement.skuId, (map.get(movement.skuId) ?? 0) + movement.quantity);
    return map;
  }, new Map<string, number>());
  const mapMatches = (expected: Map<string, number>, actual: Map<string, number>) =>
    expected.size === actual.size
    && [...expected].every(([key, quantity]) => actual.get(key) === quantity);
  const invalidBaseLedger = unrecognizedMovements.length > 0
    || baseMovements.some((movement) => movement.variantId !== null || movement.skuId !== null || movement.quantity <= 0)
    || !mapMatches(expectedBaseQuantity, heldBaseQuantity);
  const invalidVariantLedger = variantMovements.some((movement) => (
    movement.quantity <= 0
    || !movement.variantId
    || movement.skuId !== null
    || !movement.variant
    || movement.productId !== movement.variant.productId
    || movement.variantId !== movement.variant.id
  )) || !mapMatches(expectedVariantQuantity, heldVariantQuantity);
  const invalidSkuLedger = skuMovements.some((movement) => (
    movement.quantity <= 0
    || !movement.skuId
    || movement.variantId !== null
    || !movement.sku
    || movement.productId !== movement.sku.productId
    || movement.skuId !== movement.sku.id
  )) || !mapMatches(expectedSkuQuantity, heldSkuQuantity);

  // Reservation summaries are display text and can outlive a renamed or deleted
  // variant. The original hold movements are the immutable identity source for
  // stock restoration. If that ledger is incomplete, fail closed and create a
  // durable review case instead of partially or incorrectly restoring stock.
  if (invalidBaseLedger || invalidVariantLedger || invalidSkuLedger) {
    return {
      cancelled: false,
      inventoryReviewRequired: true,
      reviewReason: invalidSkuLedger
        ? "SKU_HOLD_LEDGER_MISMATCH"
        : invalidVariantLedger
          ? "VARIANT_HOLD_LEDGER_MISMATCH"
          : "BASE_HOLD_LEDGER_MISMATCH",
      backInStockNotificationCount: 0
    };
  }

  const cancelled = await input.tx.reservation.updateMany({
    where: { id: input.reservation.id, status: "PENDING" },
    data: { status: "CANCELLED", updatedAt: now }
  });
  if (cancelled.count !== 1) {
    return {
      cancelled: false,
      inventoryReviewRequired: false,
      reviewReason: null,
      backInStockNotificationCount: 0
    };
  }

  let backInStockNotificationCount = 0;

  for (const [productId, quantity] of expectedBaseQuantity) {
    const product = await input.tx.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        stock: true,
        status: true,
        lowStockThreshold: true,
        isActive: true
      }
    });
    if (!product) throw new HttpError(409, "Reserved inventory could not be restored.", "INVENTORY_RELEASE_CONFLICT");

    const newStock = product.stock + quantity;
    const nextStatus = deriveProductStatus(
      newStock,
      product.lowStockThreshold,
      product.status
    ) as PrismaProductStatus;
    await input.tx.product.update({
      where: { id: product.id },
      data: { stock: newStock, status: nextStatus, updatedAt: now },
      select: { id: true }
    });
    const movement = await input.tx.inventoryMovement.create({
      data: {
        productId: product.id,
        type: "RESERVATION_CANCEL",
        quantity,
        previousStock: product.stock,
        newStock,
        performedById: input.actorId ?? null,
        notes: `${input.reason} (${input.reservation.referenceCode})`
      },
      select: { id: true }
    });
    backInStockNotificationCount += await createBackInStockNotificationsInTransaction(input.tx, {
      productId: product.id,
      productName: product.name,
      previous: product,
      next: { ...product, stock: newStock, status: nextStatus },
      eventId: movement.id
    });
  }

  const variantRelease = new Map<string, {
    variant: NonNullable<(typeof variantMovements)[number]["variant"]>;
    quantity: number;
  }>();
  for (const movement of variantMovements) {
    // The fail-closed validation above proves these values are present.
    const variant = movement.variant!;
    const existing = variantRelease.get(variant.id);
    variantRelease.set(variant.id, {
      variant,
      quantity: (existing?.quantity ?? 0) + movement.quantity
    });
  }
  for (const { variant, quantity } of variantRelease.values()) {
    const newStock = variant.stock + quantity;
    await input.tx.productVariant.update({
      where: { id: variant.id },
      data: { stock: newStock, updatedAt: now },
      select: { id: true }
    });
    await input.tx.inventoryMovement.create({
      data: {
        productId: variant.productId,
        variantId: variant.id,
        type: "RESERVATION_CANCEL",
        quantity,
        previousStock: variant.stock,
        newStock,
        performedById: input.actorId ?? null,
        notes: `${input.reason} (${input.reservation.referenceCode}; ${variant.optionName}: ${variant.optionValue})`
      }
    });
  }

  const skuRelease = new Map<string, {
    sku: NonNullable<(typeof skuMovements)[number]["sku"]>;
    quantity: number;
  }>();
  for (const movement of skuMovements) {
    const sku = movement.sku!;
    const existing = skuRelease.get(sku.id);
    skuRelease.set(sku.id, {
      sku,
      quantity: (existing?.quantity ?? 0) + movement.quantity
    });
  }
  for (const { sku, quantity } of skuRelease.values()) {
    const newStock = sku.stock + quantity;
    await input.tx.productSku.update({
      where: { id: sku.id },
      data: { stock: newStock, updatedAt: now },
      select: { id: true }
    });
    for (const link of sku.optionValues) {
      await input.tx.productVariant.update({
        where: { id: link.variantId },
        data: { stock: { increment: quantity }, updatedAt: now },
        select: { id: true }
      });
    }
    await input.tx.inventoryMovement.create({
      data: {
        productId: sku.productId,
        skuId: sku.id,
        type: "RESERVATION_CANCEL",
        quantity,
        previousStock: sku.stock,
        newStock,
        performedById: input.actorId ?? null,
        notes: `${input.reason} (${input.reservation.referenceCode}; SKU)`
      }
    });
  }

  return {
    cancelled: true,
    inventoryReviewRequired: false,
    reviewReason: null,
    backInStockNotificationCount
  };
}

async function loadAttempt(attemptId: string) {
  return prisma.onlinePaymentAttempt.findUnique({
    where: { id: attemptId },
    include: {
      onlinePayment: {
        include: {
          reservation: {
            select: {
              id: true,
              studentId: true,
              referenceCode: true,
              paymentMethod: true,
              status: true
            }
          }
        }
      }
    }
  });
}

async function quarantineKnownProviderAttempt(
  attemptId: string,
  actorId: string | null | undefined,
  reasonCode: string
) {
  const reviewCutoff = new Date(Date.now() - PROVIDER_FAILURE_REVIEW_DELAY_MS);
  const result = await prisma.$transaction(async (tx) => {
    const attempt = await tx.onlinePaymentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        onlinePayment: {
          include: {
            reservation: {
              select: { id: true, studentId: true, referenceCode: true, status: true }
            }
          }
        }
      }
    });
    const failureStartedAt = attempt?.status === "EXPIRY_REQUESTED"
      ? attempt.expireRequestedAt
      : attempt?.createdAt;
    if (
      !attempt
      || !attempt.providerCheckoutSessionId
      || !["CREATING", "CREATE_UNKNOWN", "EXPIRY_REQUESTED"].includes(attempt.status)
      || !failureStartedAt
      || failureStartedAt > reviewCutoff
    ) {
      return { changed: false, pushNotification: null as PaymentPush };
    }

    const now = new Date();
    await tx.onlinePaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "MANUAL_REVIEW_REQUIRED",
        lastReconciledAt: now,
        lastProviderErrorCode: reasonCode
      },
      select: { id: true }
    });

    const payment = attempt.onlinePayment;
    const paymentCanBeBlocked = payment.reservation.status === "PENDING"
      && ["INITIALIZING", "AWAITING_PAYMENT", "EXPIRED"].includes(payment.status);
    if (paymentCanBeBlocked) {
      assertOnlinePaymentTransition(payment.status, "CANCELLED");
      await tx.onlinePayment.update({
        where: { id: payment.id },
        data: {
          status: "CANCELLED",
          cancelledAt: payment.cancelledAt ?? now,
          lastReconciledAt: now
        },
        select: { id: true }
      });
    }

    const notification = await tx.notification.upsert({
      where: { dedupeKey: `payment-provider-review:${payment.id}:${attempt.id}` },
      create: {
        userId: payment.reservation.studentId,
        type: "PAYMENT",
        title: "GCash checkout needs staff review",
        message: `${payment.reservation.referenceCode} could not be confirmed with the payment provider. Its stock was not automatically released; do not submit another payment until staff finishes the review.`,
        actionUrl: `/student/payments/${payment.id}`,
        dedupeKey: `payment-provider-review:${payment.id}:${attempt.id}`
      },
      update: {},
      select: { id: true, userId: true, title: true, message: true, actionUrl: true }
    });
    const pushNotification: PaymentPush = {
      id: notification.id,
      userId: notification.userId,
      title: notification.title,
      message: notification.message,
      actionUrl: notification.actionUrl ?? `/student/payments/${payment.id}`
    };

    const reviewers = await tx.profile.findMany({
      where: { role: { in: ["STAFF", "ADMIN"] } },
      select: { id: true }
    });
    if (reviewers.length) {
      await tx.notification.createMany({
        data: reviewers.map((reviewer) => ({
          userId: reviewer.id,
          type: "PAYMENT" as const,
          title: "PayMongo provider check requires review",
          message: `${payment.reservation.referenceCode} has exceeded the automatic provider-recovery window (${reasonCode}). Verify PayMongo before releasing stock, retrying payment, or refunding.`,
          actionUrl: "/staff/reservations",
          dedupeKey: `payment-provider-review:${payment.id}:${attempt.id}:${reviewer.id}`
        })),
        skipDuplicates: true
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action: "ONLINE_PAYMENT_PROVIDER_REVIEW_REQUIRED",
        entityType: "online_payment",
        entityId: payment.id,
        summary: `Escalated checkout attempt ${attempt.attemptNumber} for ${payment.reservation.referenceCode} after repeated provider verification failures.`,
        metadata: {
          attemptId: attempt.id,
          checkoutSessionId: attempt.providerCheckoutSessionId,
          reasonCode,
          paymentBlocked: paymentCanBeBlocked,
          reservationCancelled: false,
          stockReleased: false,
          manualReviewRequired: true
        }
      },
      select: { id: true }
    });
    return { changed: true, pushNotification };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });

  void dispatchPaymentPush(result.pushNotification);
  return result.changed;
}

async function persistAttemptExpired(attemptId: string, actorId?: string | null) {
  const result = await prisma.$transaction(async (tx) => {
    const attempt = await tx.onlinePaymentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        onlinePayment: {
          include: {
            reservation: {
              select: {
                id: true,
                studentId: true,
                referenceCode: true,
                status: true,
                items: {
                  select: { productId: true, skuId: true, variantSummary: true, quantity: true }
                }
              }
            }
          }
        }
      }
    });
    if (!attempt || attempt.status === "PAID") {
      return { changed: false, pushNotification: null, backInStockNotificationCount: 0 };
    }

    const now = new Date();
    const attemptStatusChanged = attempt.status !== "EXPIRED";
    if (attemptStatusChanged) {
      await tx.onlinePaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "EXPIRED",
          expiredAt: attempt.expiredAt ?? now,
          lastReconciledAt: now,
          lastProviderErrorCode: null
        },
        select: { id: true }
      });
    }

    const payment = attempt.onlinePayment;
    const otherOpenOrPaidAttempt = await tx.onlinePaymentAttempt.findFirst({
      where: {
        onlinePaymentId: payment.id,
        id: { not: attempt.id },
        status: { in: ["CREATING", "CREATE_UNKNOWN", "ACTIVE", "EXPIRY_REQUESTED", "PAID"] }
      },
      select: { id: true }
    });
    const shouldExpirePayment = (
      payment.status === "INITIALIZING" || payment.status === "AWAITING_PAYMENT"
    ) && (
      !payment.providerCheckoutSessionId
      || payment.providerCheckoutSessionId === attempt.providerCheckoutSessionId
    );
    const paymentCanCloseExpiredHold = ["INITIALIZING", "AWAITING_PAYMENT", "EXPIRED"].includes(payment.status);
    const shouldCancelReservation = payment.reservation.status === "PENDING"
      && Boolean(attempt.checkoutExpiresAt && attempt.checkoutExpiresAt <= now)
      && !otherOpenOrPaidAttempt
      && paymentCanCloseExpiredHold;
    const release = shouldCancelReservation
      ? await cancelPendingReservationAndReleaseHeldInventory({
          tx,
          reservation: payment.reservation,
          actorId,
          reason: "Online payment hold expired"
        })
      : {
          cancelled: false,
          inventoryReviewRequired: false,
          reviewReason: null,
          backInStockNotificationCount: 0
        };
    const reservationCancelled = release.cancelled;
    const backInStockNotificationCount = release.backInStockNotificationCount;

    let pushNotification: PaymentPush = null;
    if (release.inventoryReviewRequired) {
      const reviewReason = release.reviewReason ?? "INVENTORY_HOLD_LEDGER_MISMATCH";
      await tx.onlinePaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "MANUAL_REVIEW_REQUIRED",
          expiredAt: null,
          lastReconciledAt: now,
          lastProviderErrorCode: reviewReason
        },
        select: { id: true }
      });
      assertOnlinePaymentTransition(payment.status, "CANCELLED");
      await tx.onlinePayment.update({
        where: { id: payment.id },
        data: {
          status: "CANCELLED",
          cancelledAt: payment.cancelledAt ?? now,
          lastReconciledAt: now
        },
        select: { id: true }
      });

      const notification = await tx.notification.upsert({
        where: { dedupeKey: `payment-inventory-review:${payment.id}:${attempt.id}` },
        create: {
          userId: payment.reservation.studentId,
          type: "PAYMENT",
          title: "Reservation needs staff review",
          message: `${payment.reservation.referenceCode} was not changed because its original stock-hold records need staff review. Do not create another payment for this reservation.`,
          actionUrl: `/student/payments/${payment.id}`,
          dedupeKey: `payment-inventory-review:${payment.id}:${attempt.id}`
        },
        update: {},
        select: { id: true, userId: true, title: true, message: true, actionUrl: true }
      });
      pushNotification = {
        id: notification.id,
        userId: notification.userId,
        title: notification.title,
        message: notification.message,
        actionUrl: notification.actionUrl ?? `/student/payments/${payment.id}`
      };

      const reviewers = await tx.profile.findMany({
        where: { role: { in: ["STAFF", "ADMIN"] } },
        select: { id: true }
      });
      if (reviewers.length) {
        await tx.notification.createMany({
          data: reviewers.map((reviewer) => ({
            userId: reviewer.id,
            type: "PAYMENT" as const,
            title: "Inventory hold requires review",
            message: `${payment.reservation.referenceCode} was not auto-cancelled because its original inventory hold ledger is incomplete or inconsistent. Verify the held stock before changing the reservation.`,
            actionUrl: "/staff/reservations",
            dedupeKey: `payment-inventory-review:${payment.id}:${attempt.id}:${reviewer.id}`
          })),
          skipDuplicates: true
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actorId ?? null,
          action: "ONLINE_PAYMENT_INVENTORY_REVIEW_REQUIRED",
          entityType: "online_payment",
          entityId: payment.id,
          summary: `Stopped automatic stock restoration for ${payment.reservation.referenceCode} because the original inventory hold ledger did not match.`,
          metadata: {
            referenceCode: payment.reservation.referenceCode,
            attemptId: attempt.id,
            checkoutSessionId: attempt.providerCheckoutSessionId,
            reasonCode: reviewReason,
            reservationCancelled: false,
            stockReleased: false,
            manualReviewRequired: true
          }
        },
        select: { id: true }
      });
      return { changed: true, pushNotification, backInStockNotificationCount };
    }

    const nextPaymentStatus = reservationCancelled
      ? "CANCELLED" as const
      : shouldExpirePayment ? "EXPIRED" as const : null;
    if (nextPaymentStatus) {
      assertOnlinePaymentTransition(payment.status, nextPaymentStatus);
      await tx.onlinePayment.update({
        where: { id: payment.id },
        data: nextPaymentStatus === "CANCELLED"
          ? {
              status: "CANCELLED",
              cancelledAt: payment.cancelledAt ?? now,
              lastReconciledAt: now
            }
          : {
              status: "EXPIRED",
              expiredAt: payment.expiredAt ?? now,
              lastReconciledAt: now
            },
        select: { id: true }
      });
    }
    if (shouldExpirePayment || reservationCancelled) {
      const notification = await tx.notification.upsert({
        where: {
          dedupeKey: reservationCancelled
            ? `payment-hold-expired:${payment.id}`
            : `payment-expired:${payment.id}:${attempt.id}`
        },
        create: {
          userId: payment.reservation.studentId,
          type: "PAYMENT",
          title: reservationCancelled ? "Reservation payment hold expired" : "GCash checkout expired",
          message: reservationCancelled
            ? `${payment.reservation.referenceCode} was cancelled and its stock was released because the GCash checkout hold expired. Create a new reservation if you still need the items.`
            : `${payment.reservation.referenceCode} was not charged. You may start a new GCash checkout while the reservation is still pending.`,
          actionUrl: `/student/payments/${payment.id}`,
          dedupeKey: reservationCancelled
            ? `payment-hold-expired:${payment.id}`
            : `payment-expired:${payment.id}:${attempt.id}`
        },
        update: {},
        select: { id: true, userId: true, title: true, message: true, actionUrl: true }
      });
      pushNotification = {
        id: notification.id,
        userId: notification.userId,
        title: notification.title,
        message: notification.message,
        actionUrl: notification.actionUrl ?? `/student/payments/${payment.id}`
      };
    }

    const changed = attemptStatusChanged || Boolean(nextPaymentStatus) || reservationCancelled;
    if (!changed) {
      return { changed: false, pushNotification: null, backInStockNotificationCount };
    }

    await tx.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action: reservationCancelled ? "ONLINE_PAYMENT_HOLD_EXPIRED" : "ONLINE_PAYMENT_CHECKOUT_EXPIRED",
        entityType: "online_payment",
        entityId: payment.id,
        summary: reservationCancelled
          ? `Cancelled reservation ${payment.reservation.referenceCode} and released its stock after the final PayMongo hold expired.`
          : `Expired PayMongo checkout attempt ${attempt.attemptNumber} for reservation ${payment.reservation.referenceCode}.`,
        metadata: {
          referenceCode: payment.reservation.referenceCode,
          attemptId: attempt.id,
          checkoutSessionId: attempt.providerCheckoutSessionId,
          paymentStatusChanged: Boolean(nextPaymentStatus),
          paymentStatus: nextPaymentStatus ?? payment.status,
          reservationCancelled,
          stockReleased: reservationCancelled
        }
      },
      select: { id: true }
    });

    return { changed: true, pushNotification, backInStockNotificationCount };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });

  void dispatchPaymentPush(result.pushNotification);
  return result;
}

async function persistRejectedReconciliation(input: {
  paymentId: string;
  attemptId: string;
  referenceCode: string;
  reasonCode: string;
  livemode: boolean;
  actorId?: string | null;
}) {
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.onlinePaymentAttempt.update({
      where: { id: input.attemptId },
      data: { lastReconciledAt: now, lastProviderErrorCode: input.reasonCode },
      select: { id: true }
    });
    await tx.onlinePayment.update({
      where: { id: input.paymentId },
      data: { lastReconciledAt: now },
      select: { id: true }
    });
    await recordRejectedPaymentAuditInTransaction({
      tx,
      paymentId: input.paymentId,
      referenceCode: input.referenceCode,
      reasonCode: input.reasonCode,
      source: "RECONCILIATION",
      actorId: input.actorId,
      livemode: input.livemode
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });
}

async function reconcileCheckoutAttemptInternal(input: {
  attemptId: string;
  actorId?: string | null;
  allowExpiration: boolean;
}): Promise<ReconciliationResult> {
  const initial = await loadAttempt(input.attemptId);
  if (!initial || !initial.providerCheckoutSessionId) {
    return { reconciled: false, reason: "NO_PROVIDER_SESSION" as const };
  }

  let providerSession: Awaited<ReturnType<typeof getPaymongoCheckoutSession>>;
  try {
    providerSession = await getPaymongoCheckoutSession(initial.providerCheckoutSessionId);
  } catch (error) {
    const errorCode = error instanceof HttpError
      ? error.code ?? "PAYMONGO_GET_FAILED"
      : "PAYMONGO_GET_FAILED";
    await prisma.onlinePaymentAttempt.updateMany({
      where: { id: initial.id, status: { in: ["CREATING", "CREATE_UNKNOWN", "ACTIVE", "EXPIRY_REQUESTED"] } },
      data: { lastReconciledAt: new Date(), lastProviderErrorCode: errorCode }
    });
    if (await quarantineKnownProviderAttempt(initial.id, input.actorId, errorCode)) {
      return { reconciled: true, reason: "MANUAL_REVIEW_REQUIRED" };
    }
    throw error;
  }
  const receivedAt = new Date();
  const transactionResult = await prisma.$transaction(async (tx) => {
    const current = await tx.onlinePaymentAttempt.findUnique({
      where: { id: initial.id },
      include: {
        onlinePayment: {
          include: {
            reservation: {
              select: {
                id: true,
                studentId: true,
                referenceCode: true,
                paymentMethod: true,
                status: true
              }
            }
          }
        }
      }
    });
    if (!current || current.providerCheckoutSessionId !== providerSession.id) {
      throw new HttpError(409, "Payment attempt changed while reconciling.", "PAYMENT_RECONCILIATION_CONFLICT", {
        retryable: true
      });
    }

    const payment = current.onlinePayment;
    const identity = validateRecognizedCheckoutIdentity({
      checkoutSession: providerSession,
      providerLivemode: providerSession.livemode,
      onlinePayment: payment as RecognizedOnlinePayment,
      attempt: current as PersistedCheckoutAttempt
    });
    if (!identity.valid) {
      return {
        disposition: "REJECTED" as const,
        reasonCode: identity.reasonCode,
        paymentId: payment.id,
        referenceCode: payment.reservation.referenceCode,
        livemode: payment.livemode
      };
    }

    if (providerSession.payments.some((entry) => entry.status === "paid")) {
      const validation = validateRecognizedPaidCheckout({
        checkoutSession: providerSession,
        providerLivemode: providerSession.livemode,
        onlinePayment: payment as RecognizedOnlinePayment,
        attempt: current as PersistedCheckoutAttempt,
        receivedAt
      });
      if (!validation.valid) {
        return {
          disposition: "REJECTED" as const,
          reasonCode: validation.reasonCode,
          paymentId: payment.id,
          referenceCode: payment.reservation.referenceCode,
          livemode: payment.livemode
        };
      }
      const transition = await applyVerifiedPaidCheckoutInTransaction({
        tx,
        onlinePayment: payment as RecognizedOnlinePayment,
        attempt: current as PersistedCheckoutAttempt & { status: string },
        verified: validation.value,
        actorId: input.actorId,
        source: "RECONCILIATION",
        sourceId: providerSession.id
      });
      return {
        disposition: "PAID" as const,
        paymentId: payment.id,
        pushNotification: transition.pushNotification,
        cleanupAttemptIds: transition.cleanupAttemptIds
      };
    }

    const now = new Date();
    const localExpiry = current.checkoutExpiresAt
      ?? new Date(current.createdAt.getTime() + env.PAYMONGO_CHECKOUT_TTL_MINUTES * 60 * 1000);
    const recoveredProviderIdentity = (
      current.status === "CREATING"
      || current.status === "CREATE_UNKNOWN"
      || !current.checkoutUrl
    );
    const attemptAlreadyPaid = current.status === "PAID";
    const paidByAnotherAttempt = payment.status === "PAID" && !attemptAlreadyPaid;
    const providerExpired = providerSession.status === "expired";
    const expirationRequired = !attemptAlreadyPaid && (
      current.status === "EXPIRY_REQUESTED"
      || localExpiry <= now
      || payment.reservation.status !== "PENDING"
      || paidByAnotherAttempt
      || ["CANCELLED", "REFUND_REVIEW_REQUIRED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)
    );
    const nextAttemptStatus = attemptAlreadyPaid
      ? "PAID" as const
      : providerExpired
        ? "EXPIRED" as const
        : expirationRequired
          ? current.status === "EXPIRED" ? "EXPIRED" as const : "EXPIRY_REQUESTED" as const
          : recoveredProviderIdentity ? "ACTIVE" as const : current.status;

    await tx.onlinePaymentAttempt.update({
      where: { id: current.id },
      data: {
        status: nextAttemptStatus,
        checkoutUrl: providerSession.checkoutUrl,
        checkoutExpiresAt: localExpiry,
        providerCreatedAt: current.providerCreatedAt ?? current.createdAt,
        expireRequestedAt: nextAttemptStatus === "EXPIRY_REQUESTED"
          ? current.expireRequestedAt ?? now
          : current.expireRequestedAt,
        expiredAt: nextAttemptStatus === "EXPIRED" ? current.expiredAt ?? now : current.expiredAt,
        lastReconciledAt: now,
        lastProviderErrorCode: null
      },
      select: { id: true }
    });

    if (
      !attemptAlreadyPaid
      && !providerExpired
      && !expirationRequired
      && ["INITIALIZING", "AWAITING_PAYMENT", "EXPIRED"].includes(payment.status)
    ) {
      if (payment.status !== "AWAITING_PAYMENT") {
        assertOnlinePaymentTransition(payment.status, "AWAITING_PAYMENT");
      }
      await tx.onlinePayment.update({
        where: { id: payment.id },
        data: {
          status: "AWAITING_PAYMENT",
          providerCheckoutSessionId: providerSession.id,
          checkoutUrl: providerSession.checkoutUrl,
          checkoutExpiresAt: localExpiry,
          expiredAt: null,
          lastReconciledAt: now
        },
        select: { id: true }
      });
    } else {
      await tx.onlinePayment.update({
        where: { id: payment.id },
        data: { lastReconciledAt: now },
        select: { id: true }
      });
    }

    if (recoveredProviderIdentity) {
      await tx.auditLog.create({
        data: {
          actorId: input.actorId ?? null,
          action: "ONLINE_PAYMENT_ATTEMPT_IDENTITY_RECOVERED",
          entityType: "online_payment",
          entityId: payment.id,
          summary: `Validated and recovered PayMongo checkout attempt ${current.attemptNumber} for reservation ${payment.reservation.referenceCode}.`,
          metadata: {
            attemptId: current.id,
            checkoutSessionId: providerSession.id,
            expirationRequired: providerExpired || expirationRequired
          }
        },
        select: { id: true }
      });
    }
    return {
      disposition: providerExpired ? "EXPIRED" as const : "ACTIVE" as const,
      paymentId: payment.id,
      locallyExpired: expirationRequired
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });

  if (transactionResult.disposition === "REJECTED") {
    await persistRejectedReconciliation({
      paymentId: transactionResult.paymentId,
      attemptId: initial.id,
      referenceCode: transactionResult.referenceCode,
      reasonCode: transactionResult.reasonCode,
      livemode: transactionResult.livemode,
      actorId: input.actorId
    });
    return { reconciled: true, status: "REJECTED" as const, reasonCode: transactionResult.reasonCode };
  }
  if (transactionResult.disposition === "PAID") {
    void dispatchPaymentPush(transactionResult.pushNotification);
    void Promise.all(transactionResult.cleanupAttemptIds.map((attemptId) =>
      expireCheckoutAttemptBestEffort(attemptId, input.actorId)
    )).catch((error) => {
      console.warn("PayMongo checkout cleanup deferred to maintenance:", error instanceof Error ? error.message : error);
    });
    return { reconciled: true, status: "PAID" as const };
  }
  if (transactionResult.disposition === "EXPIRED") {
    await persistAttemptExpired(initial.id, input.actorId);
    return { reconciled: true, status: "EXPIRED" as const };
  }
  if (transactionResult.locallyExpired && input.allowExpiration) {
    const expiration = await expireCheckoutAttemptBestEffort(initial.id, input.actorId);
    return { reconciled: true, status: expiration.expired ? "EXPIRED" as const : "ACTIVE" as const };
  }
  return { reconciled: true, status: "ACTIVE" as const };
}

export async function reconcileCheckoutAttempt(attemptId: string, actorId?: string | null) {
  return reconcileCheckoutAttemptInternal({ attemptId, actorId, allowExpiration: true });
}

export async function expireCheckoutAttemptBestEffort(
  attemptId: string,
  actorId?: string | null
): Promise<ExpirationResult> {
  let attempt = await prisma.$transaction(async (tx) => {
    const current = await tx.onlinePaymentAttempt.findUnique({ where: { id: attemptId } });
    if (!current) return null;
    if (["PAID", "EXPIRED", "FAILED", "ABANDONED", "MANUAL_REVIEW_REQUIRED"].includes(current.status)) {
      return current;
    }
    return tx.onlinePaymentAttempt.update({
      where: { id: current.id },
      data: {
        status: "EXPIRY_REQUESTED",
        expireRequestedAt: current.expireRequestedAt ?? new Date()
      }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });

  if (!attempt) return { expired: false, reason: "NO_PROVIDER_SESSION" };
  if (attempt.status === "PAID") return { expired: false, reason: "ALREADY_PAID" as const };
  if (attempt.status === "EXPIRED") return { expired: true, reason: "ALREADY_EXPIRED" as const };
  if (["FAILED", "ABANDONED", "MANUAL_REVIEW_REQUIRED"].includes(attempt.status)) {
    return { expired: false, reason: "TERMINAL_ATTEMPT" as const };
  }
  if (!attempt.providerCheckoutSessionId) {
    if (canSafelyRecoverPaymongoCreate(attempt.createdAt)) {
      const recovery = await recoverUnknownAttempt(attempt.id, actorId);
      return {
        expired: recovery.expired,
        reason: recovery.recovered ? recovery.expired ? "RECOVERED_AND_EXPIRED" : "RECOVERED" : recovery.errorCode ?? "RECOVERY_PENDING"
      };
    }
    await quarantineUnknownAttempt(attempt.id, actorId);
    return { expired: false, reason: "MANUAL_REVIEW_REQUIRED" };
  }

  // A malformed create response may still contain a syntactically safe session
  // ID. That ID is useful for recovery, but it is not trusted enough to expire
  // until a GET proves its metadata, reference, mode, and checkout URL belong to
  // this exact persisted attempt.
  if (!attempt.checkoutUrl) {
    try {
      const reconciled = await reconcileCheckoutAttemptInternal({
        attemptId: attempt.id,
        actorId,
        allowExpiration: false
      });
      if (reconciled.status === "PAID") return { expired: false, reason: "ALREADY_PAID" };
      if (reconciled.status === "EXPIRED") return { expired: true, reason: "ALREADY_EXPIRED" };
      if (reconciled.status === "REJECTED") {
        return { expired: false, reason: reconciled.reasonCode ?? "PROVIDER_IDENTITY_REJECTED" };
      }
      if (reconciled.reason === "MANUAL_REVIEW_REQUIRED") {
        return { expired: false, reason: "MANUAL_REVIEW_REQUIRED" };
      }
      const verifiedAttempt = await prisma.onlinePaymentAttempt.findUnique({ where: { id: attempt.id } });
      if (!verifiedAttempt?.providerCheckoutSessionId || !verifiedAttempt.checkoutUrl) {
        return { expired: false, reason: "PROVIDER_IDENTITY_UNCONFIRMED" };
      }
      attempt = verifiedAttempt;
    } catch (error) {
      const errorCode = error instanceof HttpError
        ? error.code ?? "PAYMONGO_GET_FAILED"
        : "PAYMONGO_GET_FAILED";
      await prisma.onlinePaymentAttempt.updateMany({
        where: { id: attempt.id, status: "EXPIRY_REQUESTED" },
        data: { lastProviderErrorCode: errorCode }
      });
      if (await quarantineKnownProviderAttempt(attempt.id, actorId, errorCode)) {
        return { expired: false, reason: "MANUAL_REVIEW_REQUIRED" };
      }
      return { expired: false, reason: errorCode };
    }
  }

  const verifiedCheckoutSessionId = attempt.providerCheckoutSessionId;
  if (!verifiedCheckoutSessionId) {
    return { expired: false, reason: "PROVIDER_IDENTITY_UNCONFIRMED" };
  }
  try {
    await expirePaymongoCheckoutSession(verifiedCheckoutSessionId);
    await persistAttemptExpired(attempt.id, actorId);
    return { expired: true, reason: "PROVIDER_EXPIRED" as const };
  } catch (error) {
    const errorCode = error instanceof HttpError ? error.code ?? "PAYMONGO_EXPIRE_FAILED" : "PAYMONGO_EXPIRE_FAILED";
    await prisma.onlinePaymentAttempt.updateMany({
      where: { id: attempt.id, status: "EXPIRY_REQUESTED" },
      data: { lastProviderErrorCode: errorCode }
    });
    if (await quarantineKnownProviderAttempt(attempt.id, actorId, errorCode)) {
      return { expired: false, reason: "MANUAL_REVIEW_REQUIRED" };
    }
    if (error instanceof HttpError && error.code === "PAYMONGO_CHECKOUT_NOT_EXPIRABLE") {
      const reconciled = await reconcileCheckoutAttemptInternal({
        attemptId: attempt.id,
        actorId,
        allowExpiration: false
      });
      return {
        expired: reconciled.status === "EXPIRED",
        reason: reconciled.status ?? "RECONCILIATION_PENDING"
      };
    }
    return { expired: false, reason: errorCode };
  }
}

export async function claimStudentReconciliation(paymentId: string) {
  const cutoff = new Date(Date.now() - STUDENT_RECONCILIATION_THROTTLE_MS);
  const candidates = await prisma.onlinePaymentAttempt.findMany({
    where: {
      onlinePaymentId: paymentId,
      providerCheckoutSessionId: { not: null },
      status: { in: ["CREATING", "CREATE_UNKNOWN", "ACTIVE", "EXPIRY_REQUESTED", "EXPIRED"] },
      OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lte: cutoff } }]
    },
    orderBy: { attemptNumber: "desc" },
    take: 5,
    select: { id: true, lastReconciledAt: true }
  });
  const candidate = candidates.sort((left, right) =>
    (left.lastReconciledAt?.getTime() ?? 0) - (right.lastReconciledAt?.getTime() ?? 0)
  )[0];
  if (!candidate) return null;

  const claimed = await prisma.onlinePaymentAttempt.updateMany({
    where: {
      id: candidate.id,
      OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lte: cutoff } }]
    },
    data: { lastReconciledAt: new Date() }
  });
  return claimed.count === 1 ? candidate.id : null;
}

export async function reconcileOnlinePayment(paymentId: string, actorId?: string | null) {
  const candidates = await prisma.onlinePaymentAttempt.findMany({
    where: {
      onlinePaymentId: paymentId,
      status: { in: ["CREATING", "CREATE_UNKNOWN", "ACTIVE", "EXPIRY_REQUESTED", "EXPIRED"] }
    },
    orderBy: { attemptNumber: "desc" },
    take: 10,
    select: { id: true, providerCheckoutSessionId: true, createdAt: true, lastReconciledAt: true }
  });
  const candidate = candidates.sort((left, right) =>
    (left.lastReconciledAt?.getTime() ?? 0) - (right.lastReconciledAt?.getTime() ?? 0)
  )[0];
  if (!candidate) return { reconciled: false, reason: "NO_PROVIDER_SESSION" as const };
  if (!candidate.providerCheckoutSessionId) {
    if (!canSafelyRecoverPaymongoCreate(candidate.createdAt)) {
      const changed = await quarantineUnknownAttempt(candidate.id, actorId);
      return {
        reconciled: changed,
        reason: changed ? "MANUAL_REVIEW_REQUIRED" as const : "RECOVERY_NOT_AVAILABLE" as const
      };
    }
    const recovery = await recoverUnknownAttempt(candidate.id, actorId);
    return {
      reconciled: recovery.recovered,
      status: recovery.expired ? "EXPIRED" as const : recovery.recovered ? "ACTIVE" as const : undefined,
      reason: recovery.recovered ? undefined : recovery.errorCode ?? "RECOVERY_PENDING"
    };
  }
  return reconcileCheckoutAttempt(candidate.id, actorId);
}

async function recoverUnknownAttempt(attemptId: string, actorId?: string | null): Promise<RecoveryResult> {
  const initial = await loadAttempt(attemptId);
  if (
    !initial
    || initial.providerCheckoutSessionId
    || !["CREATING", "CREATE_UNKNOWN", "EXPIRY_REQUESTED"].includes(initial.status)
  ) {
    return { recovered: false, expired: false };
  }
  if (!canSafelyRecoverPaymongoCreate(initial.createdAt)) {
    return { recovered: false, expired: false };
  }

  const request = parseStoredPaymongoCheckoutRequest(initial.requestPayload);
  let providerSession: Awaited<ReturnType<typeof recoverPaymongoCheckoutSessionFromRequest>>;
  try {
    providerSession = await recoverPaymongoCheckoutSessionFromRequest({
      idempotencyKey: initial.providerIdempotencyKey,
      request
    });
  } catch (error) {
    const errorCode = error instanceof HttpError ? error.code ?? "PAYMONGO_RECOVERY_FAILED" : "PAYMONGO_RECOVERY_FAILED";
    const partialSessionId = error instanceof HttpError
      && typeof error.details?.providerCheckoutSessionId === "string"
      && /^cs_[A-Za-z0-9_-]+$/.test(error.details.providerCheckoutSessionId)
      ? error.details.providerCheckoutSessionId
      : null;
    // Every persisted CREATING/CREATE_UNKNOWN recovery may follow an earlier
    // request whose provider outcome was lost. A later definitive response
    // cannot prove that earlier request created nothing, so retain uncertainty
    // until the conservative recovery cutoff and never rotate to a new key.
    await prisma.onlinePaymentAttempt.updateMany({
      where: { id: initial.id, providerCheckoutSessionId: null },
      data: {
        status: initial.status === "EXPIRY_REQUESTED" ? "EXPIRY_REQUESTED" : "CREATE_UNKNOWN",
        ...(partialSessionId ? { providerCheckoutSessionId: partialSessionId } : {}),
        lastProviderErrorCode: errorCode
      }
    });
    return { recovered: false, expired: false, errorCode };
  }

  const localExpiry = new Date(initial.createdAt.getTime() + env.PAYMONGO_CHECKOUT_TTL_MINUTES * 60 * 1000);
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.onlinePaymentAttempt.findUnique({
      where: { id: initial.id },
      include: {
        onlinePayment: {
          include: {
            reservation: { select: { status: true, referenceCode: true, studentId: true } }
          }
        }
      }
    });
    if (!current) throw new HttpError(404, "Payment attempt not found.");
    if (current.providerCheckoutSessionId && current.providerCheckoutSessionId !== providerSession.id) {
      throw new HttpError(409, "PayMongo returned conflicting checkout sessions.", "ONLINE_PAYMENT_SESSION_CONFLICT");
    }

    const payment = current.onlinePayment;
    const attemptAlreadyPaid = current.status === "PAID";
    const paidByAnotherAttempt = payment.status === "PAID" && !attemptAlreadyPaid;
    const shouldExpire = !attemptAlreadyPaid && (
      current.status === "EXPIRY_REQUESTED"
      || providerSession.livemode !== payment.livemode
      || localExpiry <= new Date()
      || payment.reservation.status !== "PENDING"
      || paidByAnotherAttempt
      || ["CANCELLED", "REFUND_REVIEW_REQUIRED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)
    );
    const attempt = await tx.onlinePaymentAttempt.update({
      where: { id: current.id },
      data: {
        status: attemptAlreadyPaid ? "PAID" : shouldExpire ? "EXPIRY_REQUESTED" : "ACTIVE",
        providerCheckoutSessionId: providerSession.id,
        checkoutUrl: providerSession.checkoutUrl,
        checkoutExpiresAt: localExpiry,
        providerCreatedAt: current.providerCreatedAt ?? current.createdAt,
        expireRequestedAt: shouldExpire ? current.expireRequestedAt ?? new Date() : current.expireRequestedAt,
        lastProviderErrorCode: null
      }
    });

    if (!attemptAlreadyPaid && !shouldExpire && (payment.status === "INITIALIZING" || payment.status === "EXPIRED")) {
      assertOnlinePaymentTransition(payment.status, "AWAITING_PAYMENT");
      await tx.onlinePayment.update({
        where: { id: payment.id },
        data: {
          status: "AWAITING_PAYMENT",
          providerCheckoutSessionId: providerSession.id,
          checkoutUrl: providerSession.checkoutUrl,
          checkoutExpiresAt: localExpiry,
          expiredAt: null
        },
        select: { id: true }
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action: "ONLINE_PAYMENT_ATTEMPT_RECOVERED",
        entityType: "online_payment",
        entityId: payment.id,
        summary: `Recovered PayMongo checkout attempt ${current.attemptNumber} for reservation ${payment.reservation.referenceCode}.`,
        metadata: {
          attemptId: current.id,
          checkoutSessionId: providerSession.id,
          expirationRequired: shouldExpire
        }
      },
      select: { id: true }
    });
    return { attempt, shouldExpire };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });

  if (result.shouldExpire) {
    const expiration = await expireCheckoutAttemptBestEffort(result.attempt.id, actorId);
    return { recovered: true, expired: expiration.expired };
  }
  return { recovered: true, expired: false };
}

export async function quarantineUnknownAttempt(attemptId: string, actorId?: string | null) {
  const result = await prisma.$transaction(async (tx) => {
    const attempt = await tx.onlinePaymentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        onlinePayment: {
          include: {
            reservation: {
              select: {
                id: true,
                studentId: true,
                referenceCode: true,
                status: true,
                items: { select: { productId: true, skuId: true, variantSummary: true, quantity: true } }
              }
            }
          }
        }
      }
    });
    if (
      !attempt
      || attempt.providerCheckoutSessionId
      || !["CREATING", "CREATE_UNKNOWN", "EXPIRY_REQUESTED"].includes(attempt.status)
    ) {
      return {
        changed: false,
        pushNotification: null,
        backInStockNotificationCount: 0
      };
    }
    const now = new Date();
    await tx.onlinePaymentAttempt.update({
      where: { id: attempt.id },
      data: { status: "MANUAL_REVIEW_REQUIRED", lastProviderErrorCode: "SAFE_RECOVERY_WINDOW_ELAPSED" },
      select: { id: true }
    });

    const payment = attempt.onlinePayment;
    const anotherOpenOrPaid = await tx.onlinePaymentAttempt.findFirst({
      where: {
        onlinePaymentId: payment.id,
        id: { not: attempt.id },
        status: { in: ["CREATING", "CREATE_UNKNOWN", "ACTIVE", "EXPIRY_REQUESTED", "PAID"] }
      },
      select: { id: true }
    });
    const mayCancel = payment.reservation.status === "PENDING"
      && !anotherOpenOrPaid
      && (payment.status === "INITIALIZING" || payment.status === "AWAITING_PAYMENT" || payment.status === "EXPIRED");
    const release = mayCancel
        ? await cancelPendingReservationAndReleaseHeldInventory({
            tx,
            reservation: payment.reservation,
            actorId,
            reason: "Unrecoverable online payment attempt quarantined"
          })
      : {
          cancelled: false,
          inventoryReviewRequired: false,
          reviewReason: null,
          backInStockNotificationCount: 0
        };

    let pushNotification: PaymentPush = null;
    if (release.cancelled || release.inventoryReviewRequired) {
      assertOnlinePaymentTransition(payment.status, "CANCELLED");
      await tx.onlinePayment.update({
        where: { id: payment.id },
        data: { status: "CANCELLED", cancelledAt: payment.cancelledAt ?? now, lastReconciledAt: now },
        select: { id: true }
      });
    }
    const notification = await tx.notification.upsert({
      where: { dedupeKey: `payment-attempt-quarantined:${payment.id}:${attempt.id}` },
      create: {
        userId: payment.reservation.studentId,
        type: "PAYMENT",
        title: "GCash checkout needs staff review",
        message: release.cancelled
          ? `${payment.reservation.referenceCode} was cancelled and its stock was released. Do not retry this checkout; staff must review the unconfirmed provider attempt.`
          : release.inventoryReviewRequired
            ? `${payment.reservation.referenceCode} was not changed because its original stock-hold records need staff review. Do not submit another online payment.`
          : `${payment.reservation.referenceCode} has an unconfirmed provider attempt that staff must review. Do not submit another online payment.`,
        actionUrl: `/student/payments/${payment.id}`,
        dedupeKey: `payment-attempt-quarantined:${payment.id}:${attempt.id}`
      },
      update: {},
      select: { id: true, userId: true, title: true, message: true, actionUrl: true }
    });
    pushNotification = {
      id: notification.id,
      userId: notification.userId,
      title: notification.title,
      message: notification.message,
      actionUrl: notification.actionUrl ?? `/student/payments/${payment.id}`
    };

    const reviewers = await tx.profile.findMany({
      where: { role: { in: ["STAFF", "ADMIN"] } },
      select: { id: true }
    });
    if (reviewers.length) {
      await tx.notification.createMany({
        data: reviewers.map((reviewer) => ({
          userId: reviewer.id,
          type: "PAYMENT" as const,
          title: "PayMongo attempt requires review",
          message: release.inventoryReviewRequired
            ? `${payment.reservation.referenceCode} has an unrecoverable checkout and an inconsistent inventory hold ledger. Verify PayMongo and held stock before changing the reservation.`
            : `${payment.reservation.referenceCode} has an unrecoverable checkout attempt. Verify PayMongo before any new online payment or refund decision.`,
          actionUrl: "/staff/reservations",
          dedupeKey: `payment-attempt-quarantined:${payment.id}:${attempt.id}:${reviewer.id}`
        })),
        skipDuplicates: true
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action: "ONLINE_PAYMENT_ATTEMPT_QUARANTINED",
        entityType: "online_payment",
        entityId: payment.id,
        summary: `Quarantined an unconfirmed PayMongo attempt after WesComm's safe recovery window for ${payment.reservation.referenceCode}.`,
        metadata: {
          attemptId: attempt.id,
          attemptNumber: attempt.attemptNumber,
          reservationCancelled: release.cancelled,
          stockReleased: release.cancelled,
          inventoryReviewReason: release.reviewReason,
          manualReviewRequired: true
        }
      },
      select: { id: true }
    });
    return {
      changed: true,
      pushNotification,
      backInStockNotificationCount: release.backInStockNotificationCount
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });
  void dispatchPaymentPush(result.pushNotification);
  return result.changed;
}

export async function runPaymongoMaintenance(input: { actorId?: string | null; limit: number }) {
  const now = new Date();
  const safeRecoveryCutoff = new Date(now.getTime() - PAYMONGO_CREATE_RECOVERY_WINDOW_MS);
  const quarantinable = await prisma.onlinePaymentAttempt.findMany({
    where: {
      status: { in: ["CREATING", "CREATE_UNKNOWN", "EXPIRY_REQUESTED"] },
      providerCheckoutSessionId: null,
      createdAt: { lte: safeRecoveryCutoff }
    },
    orderBy: { createdAt: "asc" },
    take: input.limit,
    select: { id: true }
  });
  let quarantined = 0;
  let failed = 0;
  for (const attempt of quarantinable) {
    try {
      if (await quarantineUnknownAttempt(attempt.id, input.actorId)) quarantined += 1;
    } catch (error) {
      failed += 1;
      console.warn("PayMongo attempt quarantine failed:", error instanceof Error ? error.message : error);
    }
  }

  let remaining = Math.max(0, input.limit - quarantinable.length);
  const recoveryReadyAt = new Date(now.getTime() - UNKNOWN_RECOVERY_DELAY_MS);
  const recoverable = remaining ? await prisma.onlinePaymentAttempt.findMany({
    where: {
      status: { in: ["CREATING", "CREATE_UNKNOWN", "EXPIRY_REQUESTED"] },
      providerCheckoutSessionId: null,
      createdAt: { gt: safeRecoveryCutoff },
      updatedAt: { lte: recoveryReadyAt }
    },
    orderBy: { updatedAt: "asc" },
    take: remaining,
    select: { id: true }
  }) : [];
  let recovered = 0;
  for (const attempt of recoverable) {
    try {
      const result = await recoverUnknownAttempt(attempt.id, input.actorId);
      if (result.recovered) recovered += 1;
      else if (result.errorCode) failed += 1;
    } catch (error) {
      failed += 1;
      console.warn("PayMongo attempt recovery failed:", error instanceof Error ? error.message : error);
    }
  }

  remaining = Math.max(0, remaining - recoverable.length);
  const reconciliationCutoff = new Date(now.getTime() - MAINTENANCE_RECONCILIATION_INTERVAL_MS);
  const expiredRecheckCutoff = new Date(now.getTime() - EXPIRED_RECHECK_INTERVAL_MS);
  const recentExpired = new Date(now.getTime() - RECENT_EXPIRED_RECHECK_WINDOW_MS);
  const candidates = remaining ? await prisma.onlinePaymentAttempt.findMany({
    where: {
      providerCheckoutSessionId: { not: null },
      OR: [
        { status: "EXPIRY_REQUESTED" },
        {
          status: { in: ["CREATING", "CREATE_UNKNOWN"] },
          OR: [
            { lastReconciledAt: null },
            { lastReconciledAt: { lte: reconciliationCutoff } }
          ]
        },
        {
          status: "ACTIVE",
          OR: [
            { checkoutExpiresAt: { lte: now } },
            { lastReconciledAt: null },
            { lastReconciledAt: { lte: reconciliationCutoff } }
          ]
        },
        {
          status: "EXPIRED",
          OR: [
            {
              checkoutExpiresAt: { lte: now },
              onlinePayment: { reservation: { status: "PENDING" } }
            },
            {
              expiredAt: { gte: recentExpired },
              OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lte: expiredRecheckCutoff } }]
            }
          ]
        }
      ]
    },
    orderBy: { updatedAt: "asc" },
    take: remaining,
    select: { id: true, status: true, checkoutExpiresAt: true }
  }) : [];

  let expired = 0;
  let reconciled = 0;
  for (const attempt of candidates) {
    try {
      if (attempt.status === "EXPIRY_REQUESTED" || (
        attempt.status === "ACTIVE" && attempt.checkoutExpiresAt && attempt.checkoutExpiresAt <= now
      )) {
        const result = await expireCheckoutAttemptBestEffort(attempt.id, input.actorId);
        if (result.expired) expired += 1;
        else reconciled += 1;
      } else {
        await reconcileCheckoutAttempt(attempt.id, input.actorId);
        reconciled += 1;
      }
    } catch (error) {
      failed += 1;
      console.warn("PayMongo maintenance item failed:", error instanceof Error ? error.message : error);
    }
  }

  return {
    examined: quarantinable.length + recoverable.length + candidates.length,
    quarantined,
    recovered,
    expired,
    reconciled,
    failed
  };
}

export {
  PAYMONGO_CREATE_RECOVERY_WINDOW_MS,
  PAYMONGO_PROVIDER_IDEMPOTENCY_WINDOW_MS
};
