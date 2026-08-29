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
import { assertStudentCanCancelReservation } from "../domain/student-reservation-cancellation.js";
import {
  assertReservationTransition,
  deriveProductStatus,
  reservationStatusLabel
} from "../domain/reservation-state.js";
import { resolveReservationVariantSelections } from "../domain/variant-stock.js";
import { sameSkuVariantSelection } from "../domain/sku-inventory.js";
import { prisma } from "../lib/prisma.js";
import { ensureReceiptForCompletedReservationInTransaction } from "./receipt.service.js";
import { validatePickupSelectionInTransaction } from "./pickup-policy.service.js";
import { expireCheckoutAttemptBestEffort } from "./paymongo-reconciliation.service.js";
import {
  assertReservationAccessInTransaction,
  recordNoShowOffenseInTransaction,
  type NoShowPolicyOutcome
} from "./restriction.service.js";
import { OUTBOX_EVENT_TYPES } from "./outbox.service.js";
import { publishRealtimeEvents, REALTIME_TOPICS, wakeRealtimeBroker } from "./realtime-event.service.js";
import {
  createBackInStockNotificationsInTransaction
} from "./wishlist-notification.service.js";
import {
  type AppRole,
  type OnlinePaymentStatus,
  type PaymentMethod,
  type RawProfileSummary,
  type ReservationStatus,
  mapProfileSummary
} from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import { createPage, decodeCursor, normalizePageLimit } from "../utils/cursor-pagination.js";
import {
  hashReservationRequest,
  reservationIdempotencyExpiry
} from "../utils/reservation-idempotency.js";

const RESERVATION_SERIALIZATION_MAX_ATTEMPTS = 6;

async function waitForReservationSerializationRetry(attempt: number) {
  const jitterCeilingMs = Math.min(750, 75 * (2 ** (attempt - 1)));
  const delayMs = 25 + Math.floor(Math.random() * jitterCeilingMs);
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

async function withReservationSerializationRetry<T>(operation: () => Promise<T>) {
  for (let attempt = 1; attempt <= RESERVATION_SERIALIZATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError)
        || error.code !== "P2034"
        || attempt >= RESERVATION_SERIALIZATION_MAX_ATTEMPTS
      ) {
        throw error;
      }
      await waitForReservationSerializationRetry(attempt);
    }
  }

  throw new Error("Reservation serialization retry exhausted unexpectedly.");
}

function aggregateVariantQuantities<T extends {
  id: string;
  productId: string;
  optionName: string;
  optionValue: string;
  stock: number;
}>(
  items: Array<{ productId: string; quantity: number; variantSummary?: string | null }>,
  variants: T[],
  products: Array<{ id: string; name: string }>,
  options: { strict?: boolean } = {}
) {
  const variantsByProduct = variants.reduce((map, variant) => {
    const entries = map.get(variant.productId) ?? [];
    entries.push(variant);
    map.set(variant.productId, entries);
    return map;
  }, new Map<string, typeof variants>());
  const quantityByVariant = new Map<string, { variant: (typeof variants)[number]; quantity: number }>();

  items.forEach((item) => {
    const productName = products.find((product) => product.id === item.productId)?.name ?? "Selected product";
    const resolution = resolveReservationVariantSelections({
      variants: variantsByProduct.get(item.productId) ?? [],
      summary: item.variantSummary,
      strict: options.strict !== false
    });
    if (resolution.issue) {
      const message = resolution.issue.code === "MISSING_OPTION"
        ? `${productName}: choose a ${resolution.issue.optionName} option.`
        : resolution.issue.code === "DUPLICATE_OPTION"
          ? `${productName}: choose only one ${resolution.issue.optionName} option.`
          : resolution.issue.code === "UNKNOWN_VALUE"
            ? `${productName} option ${resolution.issue.optionName}: ${resolution.issue.optionValue} is no longer available.`
            : `${productName} does not offer the ${resolution.issue.optionName} option.`;
      throw new HttpError(400, message, "INVALID_VARIANT_SELECTION");
    }

    resolution.selected.forEach((variant) => {
      const current = quantityByVariant.get(variant.id);
      quantityByVariant.set(variant.id, {
        variant,
        quantity: (current?.quantity ?? 0) + item.quantity
      });
    });
  });

  return Array.from(quantityByVariant.values());
}


function nonOptionReservationSummary(summary?: string | null) {
  if (!summary?.trim()) return null;
  const notes = summary
    .split("|")
    .map((part) => part.trim())
    .filter((part) => /^note\s*:/i.test(part));
  return notes.length ? notes.join(" | ") : null;
}

type SkuReservationRecord = {
  id: string;
  productId: string;
  stock: number;
  lowStockThreshold: number;
  optionValues: Array<{ variantId: string }>;
};

function resolveRequestedSkus<TVariant extends {
  id: string;
  productId: string;
  optionName: string;
  optionValue: string;
  stock: number;
}>(input: {
  items: Array<{ productId: string; skuId?: string | null; quantity: number; variantSummary?: string | null }>;
  products: Array<{ id: string; name: string; saleMode: "SIMPLE" | "CLOTH_ONLY" | "OPTIONS"; skuInventoryEnabled: boolean }>;
  variants: TVariant[];
  skus: SkuReservationRecord[];
}) {
  const variantsByProduct = input.variants.reduce((map, variant) => {
    const values = map.get(variant.productId) ?? [];
    values.push(variant);
    map.set(variant.productId, values);
    return map;
  }, new Map<string, TVariant[]>());
  const skusByProduct = input.skus.reduce((map, sku) => {
    const values = map.get(sku.productId) ?? [];
    values.push(sku);
    map.set(sku.productId, values);
    return map;
  }, new Map<string, SkuReservationRecord[]>());
  const itemSkuIds = new Map<number, string>();
  const quantityBySku = new Map<string, { sku: SkuReservationRecord; quantity: number; productName: string }>();

  input.items.forEach((item, index) => {
    const product = input.products.find((entry) => entry.id === item.productId);
    if (product?.saleMode !== "OPTIONS" || !product.skuInventoryEnabled) return;
    const productName = product.name;
    const resolution = resolveReservationVariantSelections({
      variants: variantsByProduct.get(item.productId) ?? [],
      summary: item.variantSummary,
      strict: true
    });
    if (resolution.issue) {
      const message = resolution.issue.code === "MISSING_OPTION"
        ? `${productName}: choose a ${resolution.issue.optionName} option.`
        : resolution.issue.code === "DUPLICATE_OPTION"
          ? `${productName}: choose only one ${resolution.issue.optionName} option.`
          : resolution.issue.code === "UNKNOWN_VALUE"
            ? `${productName} option ${resolution.issue.optionName}: ${resolution.issue.optionValue} is no longer available.`
            : `${productName} does not offer the ${resolution.issue.optionName} option.`;
      throw new HttpError(400, message, "INVALID_VARIANT_SELECTION");
    }
    const selectedIds = resolution.selected.map((variant) => variant.id).sort();
    const productSkus = skusByProduct.get(item.productId) ?? [];
    const matchesSelection = (sku: SkuReservationRecord) =>
      sameSkuVariantSelection(sku.optionValues.map((link) => link.variantId), selectedIds);
    const matching = item.skuId
      ? productSkus.filter((sku) => sku.id === item.skuId && matchesSelection(sku))
      : productSkus.filter(matchesSelection);
    if (matching.length !== 1) {
      throw new HttpError(
        409,
        `${productName}: the selected option combination is not configured in inventory. Please refresh the item and try again.`,
        item.skuId ? "SKU_SELECTION_STALE" : "SKU_COMBINATION_NOT_AVAILABLE"
      );
    }
    const sku = matching[0];
    itemSkuIds.set(index, sku.id);
    const current = quantityBySku.get(sku.id);
    quantityBySku.set(sku.id, {
      sku,
      quantity: (current?.quantity ?? 0) + item.quantity,
      productName
    });
  });

  return { itemSkuIds, requestedSkus: Array.from(quantityBySku.values()) };
}

function createReferenceCode() {
  const year = new Date().getFullYear();
  const suffix = randomBytes(4).toString("hex").toUpperCase();
  return `WES-${year}-${suffix}`;
}

const reservationRecordSelect = Prisma.validator<Prisma.ReservationSelect>()({
  id: true,
  studentId: true,
  referenceCode: true,
  status: true,
  pickupStart: true,
  pickupEnd: true,
  pickupReviewStatus: true,
  pickupReviewReason: true,
  scheduleRevision: true,
  pickupPolicyVersion: { select: { id: true, version: true } },
  pickupTimeSlot: { select: { id: true, label: true, startMinute: true, endMinute: true } },
  paymentMethod: true,
  totalAmount: true,
  staffNotes: true,
  createdAt: true,
  updatedAt: true,
  student: { select: { id: true, fullName: true, email: true, studentNumber: true } },
  scheduleChanges: {
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      reason: true,
      previousPickupStart: true,
      previousPickupEnd: true,
      previousPolicyVersion: true,
      previousSlotLabel: true,
      newPickupStart: true,
      newPickupEnd: true,
      newPolicyVersion: true,
      newSlotLabel: true,
      previousScheduleRevision: true,
      newScheduleRevision: true,
      createdAt: true,
      actor: { select: { id: true, fullName: true, email: true } }
    }
  },
  onlinePayment: {
    select: {
      id: true,
      reservationId: true,
      status: true,
      amountCentavos: true,
      currency: true,
      livemode: true,
      providerCheckoutSessionId: true,
      providerPaymentId: true,
      checkoutUrl: true,
      checkoutExpiresAt: true,
      paidAt: true,
      createdAt: true,
      updatedAt: true
    }
  },
  items: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      reservationId: true,
      productId: true,
      variantSummary: true,
      quantity: true,
      unitPrice: true,
      subtotal: true,
      createdAt: true,
      product: {
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          price: true,
          status: true,
          stock: true,
          category: { select: { name: true, slug: true, iconUrl: true } }
        }
      }
    }
  }
});

type ReservationRecord = Prisma.ReservationGetPayload<{ select: typeof reservationRecordSelect }>;

function mapPrismaReservation(reservation: ReservationRecord) {
  const payment = reservation.onlinePayment;
  return {
    id: reservation.id,
    studentId: reservation.studentId,
    referenceCode: reservation.referenceCode,
    status: reservation.status,
    pickupStart: reservation.pickupStart?.toISOString() ?? null,
    pickupEnd: reservation.pickupEnd?.toISOString() ?? null,
    pickupReviewStatus: reservation.pickupReviewStatus,
    pickupReviewReason: reservation.pickupReviewReason,
    scheduleRevision: reservation.scheduleRevision,
    pickupPolicyVersion: reservation.pickupPolicyVersion?.version ?? null,
    pickupSlot: reservation.pickupTimeSlot,
    paymentMethod: reservation.paymentMethod,
    totalAmount: reservation.totalAmount.toString(),
    staffNotes: reservation.staffNotes,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
    student: {
      id: reservation.student.id,
      fullName: reservation.student.fullName,
      email: reservation.student.email,
      studentNumber: reservation.student.studentNumber
    },
    scheduleChanges: reservation.scheduleChanges.map((change) => ({
      ...change,
      previousPickupStart: change.previousPickupStart?.toISOString() ?? null,
      previousPickupEnd: change.previousPickupEnd?.toISOString() ?? null,
      newPickupStart: change.newPickupStart.toISOString(),
      newPickupEnd: change.newPickupEnd.toISOString(),
      createdAt: change.createdAt.toISOString()
    })),
    payment: payment
      ? {
          id: payment.id,
          reservationId: payment.reservationId,
          status: payment.status,
          amountMinor: payment.amountCentavos,
          currency: payment.currency.trim(),
          livemode: payment.livemode,
          canResume: paymentCanResume(payment.status, payment.checkoutUrl, payment.checkoutExpiresAt?.toISOString() ?? null),
          canRetry: paymentCanRetry(payment.status),
          providerReference: payment.providerPaymentId ?? payment.providerCheckoutSessionId,
          paidAt: payment.paidAt?.toISOString() ?? null,
          checkoutExpiresAt: payment.checkoutExpiresAt?.toISOString() ?? null,
          createdAt: payment.createdAt.toISOString(),
          updatedAt: payment.updatedAt.toISOString()
        }
      : null,
    items: reservation.items.map((item) => ({
      id: item.id,
      reservationId: item.reservationId,
      productId: item.productId,
      variantSummary: item.variantSummary,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toString(),
      subtotal: item.subtotal.toString(),
      createdAt: item.createdAt.toISOString(),
      product: {
        id: item.product.id,
        name: item.product.name,
        description: item.product.description,
        imageUrl: item.product.imageUrl,
        price: item.product.price.toString(),
        status: item.product.status,
        stock: item.product.stock,
        category: item.product.category
      }
    }))
  };
}

const staffReservationListSelect = Prisma.validator<Prisma.ReservationSelect>()({
  id: true,
  studentId: true,
  referenceCode: true,
  status: true,
  pickupStart: true,
  pickupEnd: true,
  pickupReviewStatus: true,
  pickupReviewReason: true,
  scheduleRevision: true,
  pickupPolicyVersion: { select: { id: true, version: true } },
  pickupTimeSlot: { select: { id: true, label: true, startMinute: true, endMinute: true } },
  paymentMethod: true,
  totalAmount: true,
  staffNotes: true,
  createdAt: true,
  updatedAt: true,
  student: { select: { id: true, fullName: true, email: true, studentNumber: true } },
  onlinePayment: {
    select: {
      id: true,
      reservationId: true,
      status: true,
      amountCentavos: true,
      currency: true,
      livemode: true,
      providerCheckoutSessionId: true,
      providerPaymentId: true,
      checkoutUrl: true,
      checkoutExpiresAt: true,
      paidAt: true,
      createdAt: true,
      updatedAt: true
    }
  },
  items: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      reservationId: true,
      productId: true,
      variantSummary: true,
      quantity: true,
      unitPrice: true,
      subtotal: true,
      createdAt: true,
      product: { select: { id: true, name: true } }
    }
  }
});

type StaffReservationListRecord = Prisma.ReservationGetPayload<{ select: typeof staffReservationListSelect }>;

function mapStaffReservationList(reservation: StaffReservationListRecord) {
  const payment = reservation.onlinePayment;
  return {
    id: reservation.id,
    studentId: reservation.studentId,
    referenceCode: reservation.referenceCode,
    status: reservation.status,
    pickupStart: reservation.pickupStart?.toISOString() ?? null,
    pickupEnd: reservation.pickupEnd?.toISOString() ?? null,
    pickupReviewStatus: reservation.pickupReviewStatus,
    pickupReviewReason: reservation.pickupReviewReason,
    scheduleRevision: reservation.scheduleRevision,
    pickupPolicyVersion: reservation.pickupPolicyVersion?.version ?? null,
    pickupSlot: reservation.pickupTimeSlot,
    paymentMethod: reservation.paymentMethod,
    totalAmount: reservation.totalAmount.toString(),
    staffNotes: reservation.staffNotes,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
    student: {
      id: reservation.student.id,
      fullName: reservation.student.fullName,
      email: reservation.student.email,
      studentNumber: reservation.student.studentNumber
    },
    payment: payment
      ? {
          id: payment.id,
          reservationId: payment.reservationId,
          status: payment.status,
          amountMinor: payment.amountCentavos,
          currency: payment.currency.trim(),
          livemode: payment.livemode,
          canResume: paymentCanResume(payment.status, payment.checkoutUrl, payment.checkoutExpiresAt?.toISOString() ?? null),
          canRetry: paymentCanRetry(payment.status),
          providerReference: payment.providerPaymentId ?? payment.providerCheckoutSessionId,
          paidAt: payment.paidAt?.toISOString() ?? null,
          checkoutExpiresAt: payment.checkoutExpiresAt?.toISOString() ?? null,
          createdAt: payment.createdAt.toISOString(),
          updatedAt: payment.updatedAt.toISOString()
        }
      : null,
    items: reservation.items.map((item) => ({
      id: item.id,
      reservationId: item.reservationId,
      productId: item.productId,
      variantSummary: item.variantSummary,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toString(),
      subtotal: item.subtotal.toString(),
      createdAt: item.createdAt.toISOString(),
      product: { id: item.product.id, name: item.product.name }
    }))
  };
}

export type ReservationListOptions = {
  referenceCode?: string;
  status?: ReservationStatus;
  query?: string;
  dateFrom?: Date;
  dateTo?: Date;
  cursor?: string;
  limit?: number;
};

export async function listReservations(userId: string, role: AppRole, options: ReservationListOptions = {}) {
  const limit = normalizePageLimit(options.limit);
  const cursorId = decodeCursor(options.cursor);
  const where: Prisma.ReservationWhereInput = role === "STUDENT" ? { studentId: userId } : {};

  if (options.referenceCode) where.referenceCode = options.referenceCode;
  if (options.status) where.status = options.status as PrismaReservationStatus;
  if (options.dateFrom || options.dateTo) {
    where.createdAt = {
      ...(options.dateFrom ? { gte: options.dateFrom } : {}),
      ...(options.dateTo ? { lte: options.dateTo } : {})
    };
  }
  if (options.query?.trim()) {
    const query = options.query.trim();
    where.OR = [
      { referenceCode: { contains: query, mode: "insensitive" } },
      ...(role === "STUDENT" ? [] : [{
        student: {
          is: {
            OR: [
              { fullName: { contains: query, mode: "insensitive" as const } },
              { email: { contains: query, mode: "insensitive" as const } },
              { studentNumber: { contains: query, mode: "insensitive" as const } }
            ]
          }
        }
      }])
    ];
  }

  if (role === "STUDENT") {
    const rows = await prisma.reservation.findMany({
      where,
      select: reservationRecordSelect,
      relationLoadStrategy: "join",
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take: limit + 1
    });
    return createPage(rows.map(mapPrismaReservation), limit);
  }

  const rows = await prisma.reservation.findMany({
    where,
    select: staffReservationListSelect,
    relationLoadStrategy: "join",
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    take: limit + 1
  });
  return createPage(rows.map(mapStaffReservationList), limit);
}

export async function getReservation(userId: string, role: AppRole, reservationId: string) {
  const reservation = await prisma.reservation.findFirst({
    where: {
      id: reservationId,
      ...(role === "STUDENT" ? { studentId: userId } : {})
    },
    select: reservationRecordSelect,
    relationLoadStrategy: "join"
  });
  if (!reservation) throw new HttpError(404, "Reservation not found.");
  return mapPrismaReservation(reservation);
}

async function loadReservationCommandResult(reservationId: string) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: reservationRecordSelect,
    relationLoadStrategy: "join"
  });
  if (!reservation) throw new HttpError(404, "Reservation not found.");
  return mapPrismaReservation(reservation);
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
  pickupDate: string;
  pickupSlotId: string;
  pickupPolicyVersion: number;
  items: Array<{
    productId: string;
    skuId?: string;
    variantSummary?: string;
    quantity: number;
  }>;
}) {
  if (input.paymentMethod === "PAYMONGO_GCASH" && !env.PAYMONGO_ENABLED) {
    throw new HttpError(503, "Online GCash payment is not available.", "PAYMONGO_DISABLED");
  }

  const requestHash = hashReservationRequest(input);
  const idempotencyNow = new Date();

  let existingRequest = await prisma.reservationIdempotencyKey.findUnique({
    where: {
      studentId_key: {
        studentId: input.studentId,
        key: input.idempotencyKey
      }
    },
    select: {
      id: true,
      requestHash: true,
      reservationId: true,
      expiresAt: true
    }
  });

  if (existingRequest?.expiresAt && existingRequest.expiresAt <= idempotencyNow) {
    await prisma.reservationIdempotencyKey.deleteMany({
      where: { id: existingRequest.id, expiresAt: { lte: idempotencyNow } }
    });
    existingRequest = null;
  }

  if (existingRequest) {
    assertIdempotencyPayloadMatches(existingRequest.requestHash, requestHash);
    if (!existingRequest.reservationId) {
      throw new HttpError(409, "This reservation is still being processed. Please wait a moment and try again.", "IDEMPOTENCY_REQUEST_IN_PROGRESS");
    }

    return {
      reservation: await loadReservationCommandResult(existingRequest.reservationId),
      idempotentReplay: true
    };
  }

  const requestedQuantityByProduct = input.items.reduce((map, item) => {
    map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
    return map;
  }, new Map<string, number>());

  const productIds = Array.from(requestedQuantityByProduct.keys());
  const referenceCode = createReferenceCode();

  const executeTransaction = () => prisma.$transaction(
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
        const pickup = await validatePickupSelectionInTransaction(tx, input);

        const products = await tx.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            name: true,
            description: true,
            imageUrl: true,
            price: true,
            status: true,
            stock: true,
            lowStockThreshold: true,
            isActive: true,
            saleMode: true,
            skuInventoryEnabled: true,
            category: { select: { name: true, slug: true, iconUrl: true } }
          },
          relationLoadStrategy: "join"
        });

        if (products.length !== requestedQuantityByProduct.size) {
          throw new HttpError(400, "One or more products were not found.");
        }

        const optionProductIds = products
          .filter((product) => product.saleMode === "OPTIONS")
          .map((product) => product.id);
        const productVariants = optionProductIds.length
          ? await tx.productVariant.findMany({
              where: { productId: { in: optionProductIds } },
              select: {
                id: true,
                productId: true,
                optionName: true,
                optionValue: true,
                stock: true,
                lowStockThreshold: true
              }
            })
          : [];
        const productSkus = optionProductIds.length
          ? await tx.productSku.findMany({
              where: { productId: { in: optionProductIds }, isActive: true },
              select: {
                id: true,
                productId: true,
                stock: true,
                lowStockThreshold: true,
                optionValues: { select: { variantId: true } }
              },
              relationLoadStrategy: "join"
            })
          : [];
        const pendingInventorySetup = products.find(
          (product) => product.saleMode === "OPTIONS" && !product.skuInventoryEnabled
        );
        if (pendingInventorySetup) {
          throw new HttpError(
            409,
            `${pendingInventorySetup.name} is temporarily unavailable while staff verifies its physical inventory.`,
            "INVENTORY_RECONCILIATION_REQUIRED"
          );
        }
        input.items.forEach((item) => {
          const product = products.find((entry) => entry.id === item.productId);
          if (!product) return;
          if (product.saleMode !== "OPTIONS" && item.skuId) {
            throw new HttpError(400, `${product.name} does not use selectable size or option inventory.`, "PRODUCT_OPTIONS_NOT_ALLOWED");
          }
        });
        const { itemSkuIds, requestedSkus } = resolveRequestedSkus({
          items: input.items,
          products,
          variants: productVariants,
          skus: productSkus
        });

        products.forEach((product) => {
          const requestedQuantity = requestedQuantityByProduct.get(product.id) ?? 0;
          if (!product.isActive) throw new HttpError(400, `${product.name} is not available for reservation.`);
          if (product.status === "OUT_OF_STOCK" || product.stock <= 0) throw new HttpError(400, `${product.name} is out of stock.`);
          if (requestedQuantity > product.stock) {
            throw new HttpError(400, `${product.name} only has ${product.stock} item${product.stock === 1 ? "" : "s"} available.`);
          }
        });

        requestedSkus.forEach(({ sku, quantity, productName }) => {
          if (quantity > sku.stock) {
            throw new HttpError(
              400,
              `${productName} selected combination only has ${sku.stock} item${sku.stock === 1 ? "" : "s"} available.`,
              "SKU_STOCK_UNAVAILABLE"
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
            pickupStart: pickup.pickupStart,
            pickupEnd: pickup.pickupEnd,
            pickupPolicyVersionId: pickup.policy.id,
            pickupTimeSlotId: pickup.slot.id,
            totalAmount
          },
          select: {
            id: true,
            studentId: true,
            referenceCode: true,
            status: true,
            pickupStart: true,
            pickupEnd: true,
            pickupReviewStatus: true,
            pickupReviewReason: true,
            scheduleRevision: true,
            paymentMethod: true,
            totalAmount: true,
            createdAt: true,
            updatedAt: true
          }
        });

        const createdItems = await tx.reservationItem.createManyAndReturn({
          data: input.items.map((item, itemIndex) => {
            const product = products.find((entry) => entry.id === item.productId)!;
            const unitPrice = Number(product.price ?? 0);
            return {
              reservationId: reservation.id,
              productId: item.productId,
              skuId: itemSkuIds.get(itemIndex) ?? null,
              variantSummary: product.saleMode === "OPTIONS"
                ? item.variantSummary ?? null
                : nonOptionReservationSummary(item.variantSummary),
              quantity: item.quantity,
              unitPrice,
              subtotal: unitPrice * item.quantity
            };
          }),
          select: {
            id: true,
            reservationId: true,
            productId: true,
            skuId: true,
            variantSummary: true,
            quantity: true,
            unitPrice: true,
            subtotal: true,
            createdAt: true
          }
        });

        await tx.reservationIdempotencyKey.update({
          where: { id: idempotencyRequest.id },
          data: { reservationId: reservation.id },
          select: { id: true }
        });

        const lowStockAlerts: Array<{
          productId: string;
          productName: string;
          newStock: number;
          variantId?: string;
          skuId?: string;
          skuLabel?: string;
          optionName?: string;
          optionValue?: string;
          lowStockThreshold?: number;
        }> = [];
        const updatedProductState = new Map<string, { stock: number; status: PrismaProductStatus }>();
        const inventoryMovements: Prisma.InventoryMovementCreateManyInput[] = [];

        const productStockUpdates = Array.from(requestedQuantityByProduct, ([productId, quantity]) => {
          const product = products.find((entry) => entry.id === productId)!;
          const stock = product.stock - quantity;
          const status = deriveProductStatus(stock, product.lowStockThreshold, product.status) as PrismaProductStatus;
          return { product, productId, quantity, stock, status };
        });
        const inventoryUpdatedAt = new Date();
        const changedProducts = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          UPDATE "products" AS product
          SET
            "stock" = product."stock" - requested."quantity",
            "status" = requested."status",
            "updated_at" = ${inventoryUpdatedAt}
          FROM (
            VALUES ${Prisma.join(productStockUpdates.map((update) => Prisma.sql`
              (${update.productId}::uuid, ${update.quantity}::integer, ${update.status}::"product_status")
            `))}
          ) AS requested("id", "quantity", "status")
          WHERE product."id" = requested."id"
            AND product."is_active" = true
            AND product."stock" >= requested."quantity"
            AND product."status" <> 'OUT_OF_STOCK'::"product_status"
          RETURNING product."id"
        `);
        const changedProductIds = new Set(changedProducts.map((row) => row.id));

        for (const { product, productId, quantity, stock: newStock, status } of productStockUpdates) {
          if (!changedProductIds.has(productId)) {
            throw new HttpError(409, `${product.name} stock changed while reserving. Please review your cart and try again.`);
          }
          updatedProductState.set(productId, { stock: newStock, status });

          inventoryMovements.push({
            productId,
            type: "RESERVATION_HOLD",
            quantity,
            previousStock: product.stock,
            newStock,
            performedById: input.studentId,
            notes: `Reservation ${reservation.referenceCode}`
          });

          if (newStock <= product.lowStockThreshold && product.stock > product.lowStockThreshold) {
            lowStockAlerts.push({ productId: product.id, productName: product.name, newStock });
          }
        }

        if (requestedSkus.length) {
          const changedSkus = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            UPDATE "product_skus" AS sku
            SET
              "stock" = sku."stock" - requested."quantity",
              "updated_at" = ${inventoryUpdatedAt}
            FROM (
              VALUES ${Prisma.join(requestedSkus.map(({ sku, quantity }) => Prisma.sql`
                (${sku.id}::uuid, ${quantity}::integer)
              `))}
            ) AS requested("id", "quantity")
            WHERE sku."id" = requested."id"
              AND sku."is_active" = true
              AND sku."stock" >= requested."quantity"
            RETURNING sku."id"
          `);
          const changedSkuIds = new Set(changedSkus.map((row) => row.id));
          const variantQuantityById = requestedSkus.reduce((map, { sku, quantity }) => {
            for (const link of sku.optionValues) {
              map.set(link.variantId, (map.get(link.variantId) ?? 0) + quantity);
            }
            return map;
          }, new Map<string, number>());
          const changedVariants = variantQuantityById.size
            ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                UPDATE "product_variants" AS variant
                SET
                  "stock" = variant."stock" - requested."quantity",
                  "updated_at" = ${inventoryUpdatedAt}
                FROM (
                  VALUES ${Prisma.join(Array.from(variantQuantityById, ([variantId, quantity]) => Prisma.sql`
                    (${variantId}::uuid, ${quantity}::integer)
                  `))}
                ) AS requested("id", "quantity")
                WHERE variant."id" = requested."id"
                  AND variant."stock" >= requested."quantity"
                RETURNING variant."id"
              `)
            : [];
          const changedVariantIds = new Set(changedVariants.map((row) => row.id));

          for (const { sku, quantity, productName } of requestedSkus) {
            if (!changedSkuIds.has(sku.id)) {
              throw new HttpError(409, `${productName} stock changed while reserving. Please review your selected options and try again.`);
            }
            const unavailableVariant = sku.optionValues.find((link) => !changedVariantIds.has(link.variantId));
            if (unavailableVariant) {
              throw new HttpError(409, `${productName} option stock changed while reserving. Please try again.`);
            }
            const newStock = sku.stock - quantity;

            inventoryMovements.push({
              productId: sku.productId,
              skuId: sku.id,
              type: "RESERVATION_HOLD",
              quantity,
              previousStock: sku.stock,
              newStock,
              performedById: input.studentId,
              notes: `Reservation ${reservation.referenceCode} SKU hold`
            });

            if (newStock <= sku.lowStockThreshold && sku.stock > sku.lowStockThreshold) {
              const variantsForSku = productVariants.filter((variant) => sku.optionValues.some((link) => link.variantId === variant.id));
              const skuLabel = variantsForSku.length
                ? variantsForSku.map((variant) => `${variant.optionName}: ${variant.optionValue}`).join(" / ")
                : "Standard item";
              lowStockAlerts.push({
                productId: sku.productId,
                productName,
                newStock,
                skuId: sku.id,
                skuLabel,
                lowStockThreshold: sku.lowStockThreshold
              });
            }
          }
        }

        if (inventoryMovements.length) {
          await tx.inventoryMovement.createMany({ data: inventoryMovements });
        }

        await tx.outboxEvent.create({
          data: {
            type: OUTBOX_EVENT_TYPES.reservationCreated,
            entityId: reservation.id,
            payload: {
              studentId: input.studentId,
              referenceCode: reservation.referenceCode,
              itemCount: createdItems.reduce((sum, item) => sum + item.quantity, 0),
              totalAmount,
              paymentMethod: reservation.paymentMethod,
              idempotencyKey: input.idempotencyKey,
              lowStockAlerts
            }
          },
          select: { id: true }
        });

        await publishRealtimeEvents(tx, [
          {
            topic: REALTIME_TOPICS.reservations,
            entityId: reservation.id,
            audienceUserIds: [input.studentId],
            audienceRoles: ["STAFF", "ADMIN"],
            payload: { action: "created", status: reservation.status }
          },
          {
            topic: REALTIME_TOPICS.inventory,
            entityId: reservation.id,
            audienceRoles: ["STUDENT", "STAFF", "ADMIN"],
            payload: { action: "reservation-hold" }
          },
          {
            topic: REALTIME_TOPICS.dashboard,
            entityId: reservation.id,
            audienceRoles: ["STAFF", "ADMIN"],
            payload: { action: "reservation-created" }
          }
        ]);

        const commandReservation = {
          id: reservation.id,
          studentId: reservation.studentId,
          referenceCode: reservation.referenceCode,
          status: reservation.status,
          pickupStart: reservation.pickupStart?.toISOString() ?? null,
          pickupEnd: reservation.pickupEnd?.toISOString() ?? null,
          pickupReviewStatus: reservation.pickupReviewStatus,
          pickupReviewReason: reservation.pickupReviewReason,
          scheduleRevision: reservation.scheduleRevision,
          pickupPolicyVersion: pickup.policy.version,
          pickupSlot: pickup.slot,
          paymentMethod: reservation.paymentMethod,
          totalAmount: reservation.totalAmount.toString(),
          staffNotes: null,
          createdAt: reservation.createdAt.toISOString(),
          updatedAt: reservation.updatedAt.toISOString(),
          student: null,
          payment: null,
          items: createdItems.map((item) => {
            const product = products.find((entry) => entry.id === item.productId)!;
            const nextProduct = updatedProductState.get(product.id);
            return {
              id: item.id,
              reservationId: item.reservationId,
              productId: item.productId,
              variantSummary: item.variantSummary,
              quantity: item.quantity,
              unitPrice: item.unitPrice.toString(),
              subtotal: item.subtotal.toString(),
              createdAt: item.createdAt.toISOString(),
              product: {
                id: product.id,
                name: product.name,
                description: product.description,
                imageUrl: product.imageUrl,
                price: product.price.toString(),
                status: nextProduct?.status ?? product.status,
                stock: nextProduct?.stock ?? product.stock,
                category: product.category
              }
            };
          })
        };

        return {
          reservation: commandReservation,
          idempotentReplay: false
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000
      }
    );

  const transactionResult = await withReservationSerializationRetry(executeTransaction)
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
          },
          relationLoadStrategy: "join"
        });

        if (replayRequest) {
          assertIdempotencyPayloadMatches(replayRequest.requestHash, requestHash);
          if (!replayRequest.reservationId || !replayRequest.reservation) {
            throw new HttpError(409, "This reservation is still being processed. Please wait a moment and try again.", "IDEMPOTENCY_REQUEST_IN_PROGRESS");
          }

          return {
            reservation: await loadReservationCommandResult(replayRequest.reservationId),
            idempotentReplay: true
          };
        }
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new HttpError(
          409,
          "Reservation stock changed while processing. Please try again.",
          "RESERVATION_SERIALIZATION_CONFLICT",
          { retryable: true, attempts: RESERVATION_SERIALIZATION_MAX_ATTEMPTS }
        );
      }
      throw error;
    });

  if (!transactionResult.idempotentReplay) wakeRealtimeBroker();
  return transactionResult;
}

export async function updateReservationStatus(
  reservationId: string,
  status: ReservationStatus,
  performedById?: string,
  actorRole?: AppRole
) {
  const result = await withReservationSerializationRetry(() => prisma.$transaction(
      async (tx) => {
        const existingReservation = await tx.reservation.findUnique({
          where: { id: reservationId },
          select: {
            id: true,
            studentId: true,
            referenceCode: true,
            status: true,
            paymentMethod: true,
            totalAmount: true,
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
                skuId: true,
                variantSummary: true,
                quantity: true
              }
            }
          },
          relationLoadStrategy: "join"
        });

        if (!existingReservation) throw new HttpError(404, "Reservation not found.");

        if (actorRole === "STUDENT") {
          if (!performedById) throw new HttpError(401, "Authentication is required.");
          assertStudentCanCancelReservation({
            studentId: performedById,
            reservationStudentId: existingReservation.studentId,
            currentStatus: existingReservation.status as ReservationStatus,
            nextStatus: status,
            paymentMethod: existingReservation.paymentMethod as PaymentMethod,
            paymentStatus: existingReservation.onlinePayment?.status as OnlinePaymentStatus | undefined
          });
        }

        if (status === "COMPLETED" && !performedById) {
          throw new HttpError(401, "A staff account is required to complete a reservation.");
        }

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
          const releasedProducts = await tx.product.findMany({
            where: { id: { in: Array.from(releasedQuantityByProduct.keys()) } },
            select: {
              id: true,
              name: true,
              stock: true,
              status: true,
              lowStockThreshold: true,
              isActive: true
            }
          });
          if (releasedProducts.length !== releasedQuantityByProduct.size) {
            throw new HttpError(400, "One or more reserved products were not found.");
          }
          const releaseUpdatedAt = new Date();
          const productReleases = releasedProducts.map((product) => {
            const quantity = releasedQuantityByProduct.get(product.id)!;
            const stock = product.stock + quantity;
            const status = deriveProductStatus(stock, product.lowStockThreshold, product.status) as PrismaProductStatus;
            return { product, quantity, stock, status };
          });

          await tx.$executeRaw(Prisma.sql`
            UPDATE "products" AS product
            SET
              "stock" = product."stock" + released."quantity",
              "status" = released."status",
              "updated_at" = ${releaseUpdatedAt}
            FROM (
              VALUES ${Prisma.join(productReleases.map((release) => Prisma.sql`
                (${release.product.id}::uuid, ${release.quantity}::integer, ${release.status}::"product_status")
              `))}
            ) AS released("id", "quantity", "status")
            WHERE product."id" = released."id"
          `);
          const productMovements = await tx.inventoryMovement.createManyAndReturn({
            data: productReleases.map(({ product, quantity, stock }) => ({
              productId: product.id,
              type: releaseMovementType,
              quantity,
              previousStock: product.stock,
              newStock: stock,
              performedById,
              notes: `Reservation ${existingReservation.referenceCode} ${releaseNote}`
            })),
            select: { id: true, productId: true }
          });

          for (const { product, stock, status: nextStatus } of productReleases) {
            const inventoryMovement = productMovements.find((movement) => movement.productId === product.id)!;
            await createBackInStockNotificationsInTransaction(tx, {
              productId: product.id,
              productName: product.name,
              previous: product,
              next: { ...product, stock, status: nextStatus },
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
          const legacyReleaseItems = existingReservation.items.filter((item) => !item.skuId);
          const releasedVariants = aggregateVariantQuantities(legacyReleaseItems, variants, products, { strict: false });

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

        if (releasesHeldStock) {
          const skuQuantities = existingReservation.items.reduce((map, item) => {
            if (!item.skuId) return map;
            map.set(item.skuId, (map.get(item.skuId) ?? 0) + item.quantity);
            return map;
          }, new Map<string, number>());
          if (skuQuantities.size) {
            const skus = await tx.productSku.findMany({
              where: { id: { in: Array.from(skuQuantities.keys()) } },
              select: {
                id: true,
                productId: true,
                stock: true,
                optionValues: { select: { variantId: true } }
              }
            });
            for (const sku of skus) {
              const quantity = skuQuantities.get(sku.id) ?? 0;
              if (!quantity) continue;
              const newStock = sku.stock + quantity;
              await tx.productSku.update({
                where: { id: sku.id },
                data: { stock: newStock, updatedAt: new Date() },
                select: { id: true }
              });
              for (const link of sku.optionValues) {
                await tx.productVariant.update({
                  where: { id: link.variantId },
                  data: { stock: { increment: quantity }, updatedAt: new Date() },
                  select: { id: true }
                });
              }
              await tx.inventoryMovement.create({
                data: {
                  productId: sku.productId,
                  skuId: sku.id,
                  type: releaseMovementType,
                  quantity,
                  previousStock: sku.stock,
                  newStock,
                  performedById,
                  notes: `Reservation ${existingReservation.referenceCode} ${releaseNote} (SKU)`
                }
              });
            }
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
          const legacyCompletedItems = existingReservation.items.filter((item) => !item.skuId);
          const completedVariants = aggregateVariantQuantities(legacyCompletedItems, variants, products, { strict: false });
          const saleMovements: Prisma.InventoryMovementCreateManyInput[] = [];
          for (const [productId, quantity] of completedQuantityByProduct.entries()) {
            const product = products.find((entry) => entry.id === productId);
            if (!product) continue;
            saleMovements.push({
              productId,
              type: "SALE",
              quantity,
              previousStock: product.stock,
              newStock: product.stock,
              performedById,
              notes: `Reservation ${existingReservation.referenceCode} completed`
            });
          }
          for (const { variant, quantity } of completedVariants) {
            saleMovements.push({
              productId: variant.productId,
              variantId: variant.id,
              type: "SALE",
              quantity,
              previousStock: variant.stock,
              newStock: variant.stock,
              performedById,
              notes: `Reservation ${existingReservation.referenceCode} completed (${variant.optionName}: ${variant.optionValue})`
            });
          }
          if (saleMovements.length) await tx.inventoryMovement.createMany({ data: saleMovements });
        }

        if (status === "COMPLETED" && existingReservation.status !== "COMPLETED") {
          const skuQuantities = existingReservation.items.reduce((map, item) => {
            if (!item.skuId) return map;
            map.set(item.skuId, (map.get(item.skuId) ?? 0) + item.quantity);
            return map;
          }, new Map<string, number>());
          if (skuQuantities.size) {
            const skus = await tx.productSku.findMany({
              where: { id: { in: Array.from(skuQuantities.keys()) } },
              select: { id: true, productId: true, stock: true }
            });
            const skuSaleMovements = skus.flatMap((sku) => {
              const quantity = skuQuantities.get(sku.id) ?? 0;
              return quantity ? [{
                productId: sku.productId,
                skuId: sku.id,
                type: "SALE" as const,
                quantity,
                previousStock: sku.stock,
                newStock: sku.stock,
                performedById,
                notes: `Reservation ${existingReservation.referenceCode} completed (SKU)`
              }] : [];
            });
            if (skuSaleMovements.length) await tx.inventoryMovement.createMany({ data: skuSaleMovements });
          }
        }

        let generatedReceipt: Awaited<ReturnType<typeof ensureReceiptForCompletedReservationInTransaction>>["receipt"] | null = null;
        let receiptCreated = false;
        if (status === "COMPLETED") {
          const ensuredReceipt = await ensureReceiptForCompletedReservationInTransaction(tx, {
            reservation: {
              id: existingReservation.id,
              studentId: existingReservation.studentId,
              referenceCode: existingReservation.referenceCode,
              status: "COMPLETED",
              paymentMethod: existingReservation.paymentMethod as PaymentMethod,
              totalAmount: existingReservation.totalAmount
            },
            issuedById: performedById!
          });
          generatedReceipt = ensuredReceipt.receipt;
          receiptCreated = ensuredReceipt.created;
        }

        let policyOutcome: NoShowPolicyOutcome | null = null;

        if (statusChanged && status === "NO_SHOW") {
          policyOutcome = await recordNoShowOffenseInTransaction(tx, {
            studentId: existingReservation.studentId,
            reservationId: existingReservation.id,
            referenceCode: existingReservation.referenceCode,
            confirmedById: performedById!
          });
        }

        if (statusChanged) {
          await tx.outboxEvent.create({
            data: {
              type: OUTBOX_EVENT_TYPES.reservationStatusChanged,
              entityId: existingReservation.id,
              payload: {
                actorId: performedById ?? null,
                studentId: existingReservation.studentId,
                referenceCode: existingReservation.referenceCode,
                previousStatus: existingReservation.status,
                nextStatus: status,
                notificationTitle: policyOutcome?.notificationTitle ?? `Reservation ${reservationStatusLabel(status)}`,
                notificationMessage: policyOutcome?.notificationMessage
                  ?? `${existingReservation.referenceCode} is now ${reservationStatusLabel(status).toLowerCase()}.`,
                notificationType: status === "NO_SHOW" ? "SYSTEM" : "RESERVATION"
              }
            },
            select: { id: true }
          });

          await publishRealtimeEvents(tx, [
            {
              topic: REALTIME_TOPICS.reservations,
              entityId: existingReservation.id,
              audienceUserIds: [existingReservation.studentId],
              audienceRoles: ["STAFF", "ADMIN"],
              payload: {
                action: "status-changed",
                previousStatus: existingReservation.status,
                nextStatus: status
              }
            },
            {
              topic: REALTIME_TOPICS.dashboard,
              entityId: existingReservation.id,
              audienceRoles: ["STAFF", "ADMIN"],
              payload: { action: "reservation-status-changed", nextStatus: status }
            },
            ...((status === "CANCELLED" || status === "NO_SHOW")
              ? [{
                  topic: REALTIME_TOPICS.inventory,
                  entityId: existingReservation.id,
                  audienceRoles: ["STUDENT" as const, "STAFF" as const, "ADMIN" as const],
                  payload: { action: "reservation-stock-released" }
                }]
              : []),
            ...(status === "NO_SHOW"
              ? [{
                  topic: REALTIME_TOPICS.restrictions,
                  entityId: existingReservation.studentId,
                  audienceUserIds: [existingReservation.studentId],
                  audienceRoles: ["STAFF" as const, "ADMIN" as const],
                  payload: { action: "no-show-recorded" }
                }]
              : [])
          ]);
        }

        return {
          previousStatus: existingReservation.status as ReservationStatus,
          nextStatus: status,
          referenceCode: existingReservation.referenceCode,
          policyOutcome,
          paymentCleanupAttemptIds,
          generatedReceipt,
          receiptCreated
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000
      }
    ))
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

  if (result.previousStatus !== result.nextStatus || result.receiptCreated) wakeRealtimeBroker();

  if (result.paymentCleanupAttemptIds.length) {
    await Promise.allSettled(
      result.paymentCleanupAttemptIds.map((attemptId) =>
        expireCheckoutAttemptBestEffort(attemptId, performedById ?? null)
      )
    );
  }
  const reservation = await loadReservationCommandResult(reservationId);

  return { reservation, receipt: result.generatedReceipt, policyOutcome: result.policyOutcome };
}

export function cancelStudentReservation(reservationId: string, studentId: string) {
  return updateReservationStatus(reservationId, "CANCELLED", studentId, "STUDENT");
}
