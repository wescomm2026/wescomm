import {
  Prisma,
  type ProductStatus as PrismaProductStatus,
  type ReservationStatus as PrismaReservationStatus
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import {
  assertPaymentAllowsReservationTransition,
  paymentCanResume,
  paymentCanRetry
} from "../domain/online-payment.js";
import { RESERVATION_RESTRICTION_POLICY, getNoShowEligibleAt } from "../domain/reservation-policy.js";
import {
  assertReservationTransition,
  deriveProductStatus,
  reservationStatusLabel
} from "../domain/reservation-state.js";
import { prisma } from "../lib/prisma.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";
import { createReceiptForReservation } from "./receipt.service.js";
import { expireCheckoutAttemptBestEffort } from "./paymongo-reconciliation.service.js";
import {
  assertReservationAccessInTransaction,
  notifyStudentOfPolicyOutcome,
  recordNoShowOffenseInTransaction,
  type NoShowPolicyOutcome
} from "./restriction.service.js";
import { sendPushToUser } from "./push.service.js";
import {
  createBackInStockNotificationsInTransaction
} from "./wishlist-notification.service.js";
import {
  type AppRole,
  type NotificationType,
  type OnlinePaymentStatus,
  type PaymentMethod,
  type RawProfileSummary,
  type ReservationStatus,
  firstRow,
  mapProfileSummary
} from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import {
  hashReservationRequest,
  reservationIdempotencyExpiry
} from "../utils/reservation-idempotency.js";

type RawProduct = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: string | number;
  status: string;
  stock: number;
  category?:
    | {
    name: string;
    slug: string;
    icon_url: string | null;
      }
    | Array<{
        name: string;
        slug: string;
        icon_url: string | null;
      }>
    | null;
};

type RawReservationItem = {
  id: string;
  reservation_id: string;
  product_id: string;
  variant_summary: string | null;
  quantity: number;
  unit_price: string | number;
  subtotal: string | number;
  created_at: string;
  product: RawProduct | RawProduct[] | null;
};

type RawReservation = {
  id: string;
  student_id: string;
  reference_code: string;
  status: ReservationStatus;
  pickup_start: string | null;
  pickup_end: string | null;
  payment_method: PaymentMethod;
  total_amount: string | number;
  staff_notes: string | null;
  created_at: string;
  updated_at: string;
  student: RawProfileSummary | RawProfileSummary[] | null;
  items: RawReservationItem[] | null;
  payment: RawOnlinePayment | RawOnlinePayment[] | null;
};

type RawOnlinePayment = {
  id: string;
  reservation_id: string;
  status: OnlinePaymentStatus;
  amount_centavos: number;
  currency: string;
  livemode: boolean;
  provider_checkout_session_id: string | null;
  provider_payment_id: string | null;
  checkout_url: string | null;
  checkout_expires_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

function normalizeVariantPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function createVariantKey(productId: string, optionName: string, optionValue: string) {
  return `${productId}:${normalizeVariantPart(optionName)}:${normalizeVariantPart(optionValue)}`;
}

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
      if (!optionName || !optionValue) return null;

      return { optionName, optionValue };
    })
    .filter((selection): selection is { optionName: string; optionValue: string } => Boolean(selection));
}

function aggregateVariantQuantities(
  items: Array<{ productId: string; quantity: number; variantSummary?: string | null }>,
  variants: Array<{ id: string; productId: string; optionName: string; optionValue: string; stock: number }>,
  products: Array<{ id: string; name: string }>,
  options: { strict?: boolean } = {}
) {
  const variantByKey = new Map(
    variants.map((variant) => [createVariantKey(variant.productId, variant.optionName, variant.optionValue), variant])
  );
  const variantsByProduct = variants.reduce((map, variant) => {
    const entries = map.get(variant.productId) ?? [];
    entries.push(variant);
    map.set(variant.productId, entries);
    return map;
  }, new Map<string, typeof variants>());
  const quantityByVariant = new Map<string, { variant: (typeof variants)[number]; quantity: number }>();

  items.forEach((item) => {
    const selections = parseVariantSelections(item.variantSummary);
    if (!selections.length) return;

    selections.forEach((selection) => {
      const variant = variantByKey.get(createVariantKey(item.productId, selection.optionName, selection.optionValue));
      if (!variant && options.strict !== false && (variantsByProduct.get(item.productId)?.length ?? 0) > 0) {
        const productName = products.find((product) => product.id === item.productId)?.name ?? "Selected product";
        throw new HttpError(400, `${productName} option ${selection.optionName}: ${selection.optionValue} is no longer available.`);
      }
      if (!variant) return;

      const current = quantityByVariant.get(variant.id);
      quantityByVariant.set(variant.id, {
        variant,
        quantity: (current?.quantity ?? 0) + item.quantity
      });
    });
  });

  return Array.from(quantityByVariant.values());
}

function createReferenceCode() {
  const year = new Date().getFullYear();
  const suffix = randomBytes(4).toString("hex").toUpperCase();
  return `WES-${year}-${suffix}`;
}

type ReservationPushNotification = {
  id?: string;
  userId: string;
  role: AppRole;
  type: NotificationType;
  title: string;
  message: string;
};

function dispatchReservationPushNotifications(notifications: ReservationPushNotification[]) {
  void Promise.all(
    notifications.map((notification) =>
      sendPushToUser(notification.userId, {
        id: notification.id,
        title: notification.title,
        message: notification.message,
        type: notification.type
      }, notification.role)
    )
  ).catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown push dispatch error.";
    console.warn(`Unable to dispatch reservation push notifications: ${message}`);
  });
}

async function createReservationCreatedNotifications(input: {
  studentId: string;
  referenceCode: string;
  lowStockAlerts: Array<{ productName: string; newStock: number }>;
}) {
  try {
    const staffAndAdmins = await prisma.profile.findMany({
      where: { role: { in: ["STAFF", "ADMIN"] } },
      select: { id: true, role: true }
    });

    const notifications: Prisma.NotificationCreateManyInput[] = [
      {
        userId: input.studentId,
        type: "RESERVATION",
        title: "Reservation submitted",
        message: `${input.referenceCode} was submitted and is waiting for staff confirmation.`
      },
      ...staffAndAdmins.map((profile) => ({
        userId: profile.id,
        type: "RESERVATION" as const,
        title: "New student reservation",
        message: `${input.referenceCode} needs review and confirmation.`
      })),
      ...input.lowStockAlerts.flatMap((alert) =>
        staffAndAdmins.map((profile) => ({
          userId: profile.id,
          type: "LOW_STOCK" as const,
          title: `Low stock: ${alert.productName}`,
          message: `${alert.productName} dropped to ${alert.newStock} pcs after reservation ${input.referenceCode}.`
        }))
      )
    ];

    await prisma.notification.createMany({ data: notifications });

    dispatchReservationPushNotifications([
      {
        userId: input.studentId,
        role: "STUDENT",
        type: "RESERVATION",
        title: "Reservation submitted",
        message: `${input.referenceCode} was submitted and is waiting for staff confirmation.`
      },
      ...staffAndAdmins.map((profile) => ({
        userId: profile.id,
        role: profile.role as AppRole,
        type: "RESERVATION" as const,
        title: "New student reservation",
        message: `${input.referenceCode} needs review and confirmation.`
      })),
      ...input.lowStockAlerts.flatMap((alert) =>
        staffAndAdmins.map((profile) => ({
          userId: profile.id,
          role: profile.role as AppRole,
          type: "LOW_STOCK" as const,
          title: `Low stock: ${alert.productName}`,
          message: `${alert.productName} dropped to ${alert.newStock} pcs after reservation ${input.referenceCode}.`
        }))
      )
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown notification error.";
    console.warn(`Unable to create reservation notifications: ${message}`);
  }
}

async function createReservationStatusNotification(notification: ReservationPushNotification | null) {
  if (!notification) return;

  try {
    const createdNotification = await prisma.notification.create({
      data: {
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
        message: notification.message
      },
      select: { id: true }
    });

    dispatchReservationPushNotifications([{ ...notification, id: createdNotification.id }]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown notification error.";
    console.warn(`Unable to create reservation status notification: ${message}`);
  }
}

function mapProduct(product: RawProduct | RawProduct[] | null | undefined) {
  const row = firstRow(product);
  if (!row) return null;
  const category = firstRow(row.category);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    price: row.price,
    status: row.status,
    stock: row.stock,
    category: category
      ? {
          name: category.name,
          slug: category.slug,
          iconUrl: category.icon_url
        }
      : null
  };
}

function mapReservation(row: RawReservation) {
  const payment = firstRow(row.payment);
  return {
    id: row.id,
    studentId: row.student_id,
    referenceCode: row.reference_code,
    status: row.status,
    pickupStart: row.pickup_start,
    pickupEnd: row.pickup_end,
    paymentMethod: row.payment_method,
    totalAmount: row.total_amount,
    staffNotes: row.staff_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payment: payment
      ? {
          id: payment.id,
          reservationId: payment.reservation_id,
          status: payment.status,
          amountMinor: payment.amount_centavos,
          currency: payment.currency.trim(),
          livemode: payment.livemode,
          canResume: paymentCanResume(payment.status, payment.checkout_url, payment.checkout_expires_at),
          canRetry: paymentCanRetry(payment.status),
          providerReference: payment.provider_payment_id ?? payment.provider_checkout_session_id,
          paidAt: payment.paid_at,
          checkoutExpiresAt: payment.checkout_expires_at,
          createdAt: payment.created_at,
          updatedAt: payment.updated_at
        }
      : null,
    student: mapProfileSummary(row.student),
    items: (row.items ?? []).map((item) => ({
      id: item.id,
      reservationId: item.reservation_id,
      productId: item.product_id,
      variantSummary: item.variant_summary,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      subtotal: item.subtotal,
      createdAt: item.created_at,
      product: mapProduct(item.product)
    }))
  };
}

const reservationSelect = `
  id,
  student_id,
  reference_code,
  status,
  pickup_start,
  pickup_end,
  payment_method,
  total_amount,
  staff_notes,
  created_at,
  updated_at,
  payment:online_payments!online_payments_reservation_id_fkey(
    id,
    reservation_id,
    status,
    amount_centavos,
    currency,
    livemode,
    provider_checkout_session_id,
    provider_payment_id,
    checkout_url,
    checkout_expires_at,
    paid_at,
    created_at,
    updated_at
  ),
  student:profiles!reservations_student_id_fkey(id,full_name,email,student_number),
  items:reservation_items(
    id,
    reservation_id,
    product_id,
    variant_summary,
    quantity,
    unit_price,
    subtotal,
    created_at,
    product:products(
      id,
      name,
      description,
      image_url,
      price,
      status,
      stock,
      category:categories(name,slug,icon_url)
    )
  )
`;

export async function listReservations(userId: string, role: AppRole) {
  let query = supabaseAdmin.from("reservations").select(reservationSelect).order("created_at", { ascending: false });
  if (role === "STUDENT") query = query.eq("student_id", userId);

  const { data, error } = await query;
  if (error) throw HttpError.fromSupabase(error);

  return ((data ?? []) as RawReservation[]).map(mapReservation);
}

async function loadReservationById(reservationId: string) {
  const { data, error } = await supabaseAdmin.from("reservations").select(reservationSelect).eq("id", reservationId).single();
  if (error) throw HttpError.fromSupabase(error);
  return mapReservation(data as RawReservation);
}

function assertIdempotencyPayloadMatches(existingHash: string, requestHash: string) {
  if (existingHash !== requestHash) {
    throw new HttpError(
      409,
      "This checkout request key was already used with different reservation details. Please submit again.",
      "IDEMPOTENCY_KEY_REUSED"
    );
  }
}

export async function createReservation(input: {
  studentId: string;
  idempotencyKey: string;
  paymentMethod: PaymentMethod;
  pickupStart?: Date;
  pickupEnd?: Date;
  items: Array<{
    productId: string;
    variantSummary?: string;
    quantity: number;
  }>;
}) {
  if (input.paymentMethod === "PAYMONGO_GCASH" && !env.PAYMONGO_ENABLED) {
    throw new HttpError(503, "Online GCash payment is not available.", "PAYMONGO_DISABLED");
  }

  const requestHash = hashReservationRequest(input);
  await prisma.reservationIdempotencyKey.deleteMany({
    where: {
      studentId: input.studentId,
      expiresAt: { lte: new Date() }
    }
  });

  const existingRequest = await prisma.reservationIdempotencyKey.findUnique({
    where: {
      studentId_key: {
        studentId: input.studentId,
        key: input.idempotencyKey
      }
    },
    select: {
      requestHash: true,
      reservationId: true
    }
  });

  if (existingRequest) {
    assertIdempotencyPayloadMatches(existingRequest.requestHash, requestHash);
    if (!existingRequest.reservationId) {
      throw new HttpError(409, "This reservation is still being processed. Please wait a moment and try again.", "IDEMPOTENCY_REQUEST_IN_PROGRESS");
    }

    return {
      reservation: await loadReservationById(existingRequest.reservationId),
      idempotentReplay: true
    };
  }

  const requestedQuantityByProduct = input.items.reduce((map, item) => {
    map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
    return map;
  }, new Map<string, number>());

  const productIds = Array.from(requestedQuantityByProduct.keys());
  const referenceCode = createReferenceCode();

  const transactionResult = await prisma
    .$transaction(
      async (tx) => {
        const idempotencyRequest = await tx.reservationIdempotencyKey.create({
          data: {
            studentId: input.studentId,
            key: input.idempotencyKey,
            requestHash,
            expiresAt: reservationIdempotencyExpiry()
          },
          select: { id: true }
        });

        await assertReservationAccessInTransaction(tx, input.studentId);

        const products = await tx.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            name: true,
            price: true,
            status: true,
            stock: true,
            lowStockThreshold: true,
            isActive: true
          }
        });

        if (products.length !== requestedQuantityByProduct.size) {
          throw new HttpError(400, "One or more products were not found.");
        }

        const productVariants = await tx.productVariant.findMany({
          where: { productId: { in: productIds } },
          select: {
            id: true,
            productId: true,
            optionName: true,
            optionValue: true,
            stock: true
          }
        });
        const requestedVariants = aggregateVariantQuantities(input.items, productVariants, products);

        products.forEach((product) => {
          const requestedQuantity = requestedQuantityByProduct.get(product.id) ?? 0;
          if (!product.isActive) throw new HttpError(400, `${product.name} is not available for reservation.`);
          if (product.status === "OUT_OF_STOCK" || product.stock <= 0) throw new HttpError(400, `${product.name} is out of stock.`);
          if (requestedQuantity > product.stock) {
            throw new HttpError(400, `${product.name} only has ${product.stock} item${product.stock === 1 ? "" : "s"} available.`);
          }
        });

        requestedVariants.forEach(({ variant, quantity }) => {
          const product = products.find((entry) => entry.id === variant.productId);
          if (quantity > variant.stock) {
            throw new HttpError(
              400,
              `${product?.name ?? "Selected product"} ${variant.optionName}: ${variant.optionValue} only has ${variant.stock} item${variant.stock === 1 ? "" : "s"} available.`
            );
          }
        });

        const totalAmount = input.items.reduce((sum, item) => {
          const product = products.find((entry) => entry.id === item.productId);
          return sum + Number(product?.price ?? 0) * item.quantity;
        }, 0);

        const reservation = await tx.reservation.create({
          data: {
            studentId: input.studentId,
            referenceCode,
            paymentMethod: input.paymentMethod,
            pickupStart: input.pickupStart ?? null,
            pickupEnd: input.pickupEnd ?? null,
            totalAmount,
            items: {
              create: input.items.map((item) => {
                const product = products.find((entry) => entry.id === item.productId)!;
                const unitPrice = Number(product.price ?? 0);

                return {
                  productId: item.productId,
                  variantSummary: item.variantSummary ?? null,
                  quantity: item.quantity,
                  unitPrice,
                  subtotal: unitPrice * item.quantity
                };
              })
            }
          },
          select: { id: true, referenceCode: true }
        });

        await tx.reservationIdempotencyKey.update({
          where: { id: idempotencyRequest.id },
          data: { reservationId: reservation.id },
          select: { id: true }
        });

        const lowStockAlerts: Array<{ productName: string; newStock: number }> = [];

        for (const [productId, quantity] of requestedQuantityByProduct.entries()) {
          const product = products.find((entry) => entry.id === productId)!;
          const newStock = product.stock - quantity;
          const status = deriveProductStatus(newStock, product.lowStockThreshold, product.status) as PrismaProductStatus;

          const updateResult = await tx.product.updateMany({
            where: {
              id: productId,
              isActive: true,
              stock: { gte: quantity },
              status: { not: "OUT_OF_STOCK" }
            },
            data: {
              stock: { decrement: quantity },
              status,
              updatedAt: new Date()
            }
          });

          if (updateResult.count !== 1) {
            throw new HttpError(409, `${product.name} stock changed while reserving. Please review your cart and try again.`);
          }

          await tx.inventoryMovement.create({
            data: {
              productId,
              type: "RESERVATION_HOLD",
              quantity,
              previousStock: product.stock,
              newStock,
              performedById: input.studentId,
              notes: `Reservation ${reservation.referenceCode}`
            }
          });

          if (newStock <= product.lowStockThreshold && product.stock > product.lowStockThreshold) {
            lowStockAlerts.push({ productName: product.name, newStock });
          }
        }

        for (const { variant, quantity } of requestedVariants) {
          const newStock = variant.stock - quantity;
          const updateResult = await tx.productVariant.updateMany({
            where: {
              id: variant.id,
              productId: variant.productId,
              stock: { gte: quantity }
            },
            data: {
              stock: { decrement: quantity },
              updatedAt: new Date()
            }
          });

          if (updateResult.count !== 1) {
            const product = products.find((entry) => entry.id === variant.productId);
            throw new HttpError(
              409,
              `${product?.name ?? "Selected product"} ${variant.optionName}: ${variant.optionValue} stock changed while reserving. Please review your cart and try again.`
            );
          }

          await tx.inventoryMovement.create({
            data: {
              productId: variant.productId,
              variantId: variant.id,
              type: "RESERVATION_HOLD",
              quantity,
              previousStock: variant.stock,
              newStock,
              performedById: input.studentId,
              notes: `Reservation ${reservation.referenceCode} (${variant.optionName}: ${variant.optionValue})`
            }
          });
        }

        return {
          reservationId: reservation.id,
          referenceCode: reservation.referenceCode,
          lowStockAlerts,
          idempotentReplay: false
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000
      }
    )
    .catch(async (error) => {
      if (error instanceof HttpError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const replayRequest = await prisma.reservationIdempotencyKey.findUnique({
          where: {
            studentId_key: {
              studentId: input.studentId,
              key: input.idempotencyKey
            }
          },
          select: {
            requestHash: true,
            reservationId: true,
            reservation: { select: { referenceCode: true } }
          }
        });

        if (replayRequest) {
          assertIdempotencyPayloadMatches(replayRequest.requestHash, requestHash);
          if (!replayRequest.reservationId || !replayRequest.reservation) {
            throw new HttpError(409, "This reservation is still being processed. Please wait a moment and try again.", "IDEMPOTENCY_REQUEST_IN_PROGRESS");
          }

          return {
            reservationId: replayRequest.reservationId,
            referenceCode: replayRequest.reservation.referenceCode,
            lowStockAlerts: [],
            idempotentReplay: true
          };
        }
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new HttpError(409, "Reservation stock changed while processing. Please try again.");
      }
      throw error;
    });

  if (!transactionResult.idempotentReplay) {
    await createReservationCreatedNotifications({
      studentId: input.studentId,
      referenceCode: transactionResult.referenceCode,
      lowStockAlerts: transactionResult.lowStockAlerts
    });
  }

  const reservation = await loadReservationById(transactionResult.reservationId);

  if (!transactionResult.idempotentReplay) {
    await safelyRecordAuditLog({
      actorId: input.studentId,
      action: "RESERVATION_CREATED",
      entityType: "reservation",
      entityId: reservation.id,
      summary: `Created reservation ${reservation.referenceCode}.`,
      metadata: {
        referenceCode: reservation.referenceCode,
        itemCount: reservation.items.length,
        totalAmount: reservation.totalAmount,
        paymentMethod: reservation.paymentMethod,
        idempotencyKey: input.idempotencyKey
      }
    });
  }

  return { reservation, idempotentReplay: transactionResult.idempotentReplay };
}

export async function updateReservationStatus(reservationId: string, status: ReservationStatus, performedById?: string) {
  const result = await prisma
    .$transaction(
      async (tx) => {
        const existingReservation = await tx.reservation.findUnique({
          where: { id: reservationId },
          select: {
            id: true,
            studentId: true,
            referenceCode: true,
            status: true,
            paymentMethod: true,
            pickupEnd: true,
            onlinePayment: {
              select: {
                id: true,
                status: true,
                attempts: {
                  where: { status: { in: ["CREATING", "CREATE_UNKNOWN", "ACTIVE", "EXPIRY_REQUESTED"] } },
                  select: { id: true }
                }
              }
            },
            items: {
              select: {
                productId: true,
                variantSummary: true,
                quantity: true
              }
            }
          }
        });

        if (!existingReservation) throw new HttpError(404, "Reservation not found.");

        assertReservationTransition(existingReservation.status as ReservationStatus, status);
        assertPaymentAllowsReservationTransition({
          paymentMethod: existingReservation.paymentMethod as PaymentMethod,
          paymentStatus: existingReservation.onlinePayment?.status as OnlinePaymentStatus | undefined,
          nextReservationStatus: status
        });

        if (status === "NO_SHOW") {
          if (!performedById) throw new HttpError(401, "A staff account is required to confirm a no-show.");
          if (!existingReservation.pickupEnd) {
            throw new HttpError(400, "This reservation has no pickup deadline, so it cannot be marked as a no-show.");
          }

          const eligibleAt = getNoShowEligibleAt(existingReservation.pickupEnd);
          if (eligibleAt > new Date()) {
            throw new HttpError(
              400,
              `This reservation can only be marked as a no-show after the ${RESERVATION_RESTRICTION_POLICY.noShowGraceHours}-hour grace period.`,
              "NO_SHOW_GRACE_PERIOD_ACTIVE",
              { eligibleAt: eligibleAt.toISOString() }
            );
          }
        }

        const statusChanged = existingReservation.status !== status;
        const releasesHeldStock = statusChanged && (status === "CANCELLED" || status === "NO_SHOW");
        const releaseMovementType = status === "NO_SHOW" ? "RESERVATION_NO_SHOW" : "RESERVATION_CANCEL";
        const releaseNote = status === "NO_SHOW" ? "released after confirmed no-show" : "cancelled";
        let paymentCleanupAttemptIds: string[] = [];

        if (
          statusChanged
          && status === "CANCELLED"
          && existingReservation.paymentMethod === "PAYMONGO_GCASH"
          && existingReservation.onlinePayment
          && (existingReservation.onlinePayment.status === "INITIALIZING"
            || existingReservation.onlinePayment.status === "AWAITING_PAYMENT"
            || existingReservation.onlinePayment.status === "EXPIRED")
        ) {
          await tx.onlinePayment.update({
            where: { id: existingReservation.onlinePayment.id },
            data: { status: "CANCELLED", cancelledAt: new Date() },
            select: { id: true }
          });
          paymentCleanupAttemptIds = existingReservation.onlinePayment.attempts.map((attempt) => attempt.id);
          if (paymentCleanupAttemptIds.length) {
            await tx.onlinePaymentAttempt.updateMany({
              where: { id: { in: paymentCleanupAttemptIds } },
              data: { status: "EXPIRY_REQUESTED", expireRequestedAt: new Date() }
            });
          }
        }
        await tx.reservation.update({
          where: { id: reservationId },
          data: {
            status: status as PrismaReservationStatus,
            updatedAt: new Date()
          },
          select: { id: true }
        });

        if (releasesHeldStock) {
          const releasedQuantityByProduct = existingReservation.items.reduce((map, item) => {
            map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
            return map;
          }, new Map<string, number>());

          for (const [productId, quantity] of releasedQuantityByProduct.entries()) {
            const product = await tx.product.findUnique({
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

            if (!product) throw new HttpError(400, "One or more reserved products were not found.");

            const newStock = product.stock + quantity;
            const nextStatus = deriveProductStatus(newStock, product.lowStockThreshold, product.status) as PrismaProductStatus;

            await tx.product.update({
              where: { id: productId },
              data: {
                stock: newStock,
                status: nextStatus,
                updatedAt: new Date()
              },
              select: { id: true }
            });

            const inventoryMovement = await tx.inventoryMovement.create({
              data: {
                productId,
                type: releaseMovementType,
                quantity,
                previousStock: product.stock,
                newStock,
                performedById,
                notes: `Reservation ${existingReservation.referenceCode} ${releaseNote}`
              },
              select: { id: true }
            });

            await createBackInStockNotificationsInTransaction(tx, {
              productId,
              productName: product.name,
              previous: product,
              next: {
                ...product,
                stock: newStock,
                status: nextStatus
              },
              eventId: inventoryMovement.id
            });
          }
        }

        if (releasesHeldStock) {
          const productIds = Array.from(new Set(existingReservation.items.map((item) => item.productId)));
          const [variants, products] = await Promise.all([
            tx.productVariant.findMany({
              where: { productId: { in: productIds } },
              select: {
                id: true,
                productId: true,
                optionName: true,
                optionValue: true,
                stock: true
              }
            }),
            tx.product.findMany({
              where: { id: { in: productIds } },
              select: { id: true, name: true }
            })
          ]);
          const releasedVariants = aggregateVariantQuantities(existingReservation.items, variants, products, { strict: false });

          for (const { variant, quantity } of releasedVariants) {
            const newStock = variant.stock + quantity;

            await tx.productVariant.update({
              where: { id: variant.id },
              data: {
                stock: newStock,
                updatedAt: new Date()
              },
              select: { id: true }
            });

            await tx.inventoryMovement.create({
              data: {
                productId: variant.productId,
                variantId: variant.id,
                type: releaseMovementType,
                quantity,
                previousStock: variant.stock,
                newStock,
                performedById,
                notes: `Reservation ${existingReservation.referenceCode} ${releaseNote} (${variant.optionName}: ${variant.optionValue})`
              }
            });
          }
        }

        if (status === "COMPLETED" && existingReservation.status !== "COMPLETED") {
          const completedQuantityByProduct = existingReservation.items.reduce((map, item) => {
            map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
            return map;
          }, new Map<string, number>());
          const productIds = Array.from(completedQuantityByProduct.keys());
          const [products, variants] = await Promise.all([
            tx.product.findMany({
              where: { id: { in: productIds } },
              select: {
                id: true,
                name: true,
                stock: true
              }
            }),
            tx.productVariant.findMany({
              where: { productId: { in: productIds } },
              select: {
                id: true,
                productId: true,
                optionName: true,
                optionValue: true,
                stock: true
              }
            })
          ]);
          const completedVariants = aggregateVariantQuantities(existingReservation.items, variants, products, { strict: false });

          for (const [productId, quantity] of completedQuantityByProduct.entries()) {
            const product = products.find((entry) => entry.id === productId);
            if (!product) continue;

            await tx.inventoryMovement.create({
              data: {
                productId,
                type: "SALE",
                quantity,
                previousStock: product.stock,
                newStock: product.stock,
                performedById,
                notes: `Reservation ${existingReservation.referenceCode} completed`
              }
            });
          }

          for (const { variant, quantity } of completedVariants) {
            await tx.inventoryMovement.create({
              data: {
                productId: variant.productId,
                variantId: variant.id,
                type: "SALE",
                quantity,
                previousStock: variant.stock,
                newStock: variant.stock,
                performedById,
                notes: `Reservation ${existingReservation.referenceCode} completed (${variant.optionName}: ${variant.optionValue})`
              }
            });
          }
        }

        let pushNotification: ReservationPushNotification | null = null;
        let policyOutcome: NoShowPolicyOutcome | null = null;

        if (statusChanged && status === "NO_SHOW") {
          policyOutcome = await recordNoShowOffenseInTransaction(tx, {
            studentId: existingReservation.studentId,
            reservationId: existingReservation.id,
            referenceCode: existingReservation.referenceCode,
            confirmedById: performedById!
          });
        }

        if (statusChanged && status !== "NO_SHOW") {
          pushNotification = {
            userId: existingReservation.studentId,
            role: "STUDENT",
            type: "RESERVATION",
            title: `Reservation ${reservationStatusLabel(status)}`,
            message: `${existingReservation.referenceCode} is now ${reservationStatusLabel(status).toLowerCase()}.`
          };
        }

        return {
          previousStatus: existingReservation.status as ReservationStatus,
          nextStatus: status,
          referenceCode: existingReservation.referenceCode,
          pushNotification,
          policyOutcome,
          paymentCleanupAttemptIds
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000
      }
    )
    .catch((error) => {
      if (error instanceof HttpError) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034")
      ) {
        throw new HttpError(
          409,
          "Reservation changed while processing. Please try again.",
          "RESERVATION_STATUS_CONFLICT",
          { retryable: true }
        );
      }
      throw error;
    });

  if (result.paymentCleanupAttemptIds.length) {
    await Promise.allSettled(
      result.paymentCleanupAttemptIds.map((attemptId) =>
        expireCheckoutAttemptBestEffort(attemptId, performedById ?? null)
      )
    );
  }
  await createReservationStatusNotification(result.pushNotification);
  if (result.policyOutcome) await notifyStudentOfPolicyOutcome(result.policyOutcome);

  let generatedReceipt: Awaited<ReturnType<typeof createReceiptForReservation>> | null = null;

  if (result.nextStatus === "COMPLETED" && result.previousStatus !== "COMPLETED" && performedById) {
    generatedReceipt = await createReceiptForReservation(reservationId, performedById);

    await safelyRecordAuditLog({
      actorId: performedById,
      action: "RESERVATION_COMPLETED_RECEIPT_GENERATED",
      entityType: "reservation",
      entityId: reservationId,
      summary: `Completed reservation ${result.referenceCode} and generated receipt ${generatedReceipt.receiptCode}.`,
      metadata: {
        referenceCode: result.referenceCode,
        receiptCode: generatedReceipt.receiptCode,
        receiptId: generatedReceipt.id
      }
    });
  }

  const { data, error } = await supabaseAdmin.from("reservations").select(reservationSelect).eq("id", reservationId).single();
  if (error) throw HttpError.fromSupabase(error);

  const reservation = mapReservation(data as RawReservation);

  if (result.previousStatus !== result.nextStatus) {
    await safelyRecordAuditLog({
      actorId: performedById,
      action: "RESERVATION_STATUS_UPDATED",
      entityType: "reservation",
      entityId: reservationId,
      summary: `Updated reservation ${result.referenceCode} from ${reservationStatusLabel(result.previousStatus)} to ${reservationStatusLabel(result.nextStatus)}.`,
      metadata: {
        referenceCode: result.referenceCode,
        previousStatus: result.previousStatus,
        nextStatus: result.nextStatus
      }
    });
  }

  return { reservation, receipt: generatedReceipt, policyOutcome: result.policyOutcome };
}
