import {
  Prisma,
  type AppRole as PrismaAppRole,
  type NotificationType as PrismaNotificationType
} from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { sendPushToUser } from "./push.service.js";
import { publishRealtimeEvents, REALTIME_TOPICS } from "./realtime-event.service.js";
import { deleteProductImage } from "./upload.service.js";

export const OUTBOX_EVENT_TYPES = {
  reservationCreated: "RESERVATION_CREATED",
  reservationStatusChanged: "RESERVATION_STATUS_CHANGED",
  reservationRescheduled: "RESERVATION_RESCHEDULED",
  receiptCreated: "RECEIPT_CREATED",
  receiptStatusChanged: "RECEIPT_STATUS_CHANGED",
  restrictionExpired: "RESTRICTION_EXPIRED",
  productImageDelete: "PRODUCT_IMAGE_DELETE"
} as const;

const reservationCreatedPayloadSchema = z.object({
  studentId: z.string().uuid(),
  referenceCode: z.string().min(1).max(80),
  itemCount: z.number().int().positive(),
  totalAmount: z.number().nonnegative(),
  paymentMethod: z.string().min(1).max(80),
  idempotencyKey: z.string().min(1).max(128),
  lowStockAlerts: z.array(z.object({
    productId: z.string().uuid(),
    productName: z.string().min(1).max(240),
    newStock: z.number().int().nonnegative(),
    variantId: z.string().uuid().optional(),
    skuId: z.string().uuid().optional(),
    skuLabel: z.string().min(1).max(500).optional(),
    optionName: z.string().min(1).max(80).optional(),
    optionValue: z.string().min(1).max(120).optional(),
    lowStockThreshold: z.number().int().nonnegative().optional()
  })).max(100)
});

const reservationStatusChangedPayloadSchema = z.object({
  actorId: z.string().uuid().nullable(),
  studentId: z.string().uuid(),
  referenceCode: z.string().min(1).max(80),
  previousStatus: z.string().min(1).max(80),
  nextStatus: z.string().min(1).max(80),
  notificationTitle: z.string().min(1).max(240),
  notificationMessage: z.string().min(1).max(2_000),
  notificationType: z.enum(["RESERVATION", "SYSTEM"])
});

const reservationRescheduledPayloadSchema = z.object({
  actorId: z.string().uuid(),
  studentId: z.string().uuid(),
  referenceCode: z.string().min(1).max(80),
  pickupStart: z.string().datetime(),
  pickupEnd: z.string().datetime(),
  reason: z.string().min(1).max(500)
});

const restrictionExpiredPayloadSchema = z.object({
  studentId: z.string().uuid(),
  endedAt: z.string().datetime()
});

const productImageDeletePayloadSchema = z.object({
  path: z.string().min(1).max(300)
});

const receiptStatusChangedPayloadSchema = z.object({
  actorId: z.string().uuid(),
  studentId: z.string().uuid(),
  receiptCode: z.string().min(1).max(80),
  reservationId: z.string().uuid().nullable(),
  totalAmount: z.string().min(1).max(80),
  previousStatus: z.string().min(1).max(80),
  nextStatus: z.enum(["VERIFIED", "VOIDED"]),
  reason: z.string().max(500).nullable()
});

const receiptCreatedPayloadSchema = z.object({
  actorId: z.string().uuid(),
  studentId: z.string().uuid(),
  receiptCode: z.string().min(1).max(80),
  reservationId: z.string().uuid(),
  referenceCode: z.string().min(1).max(80),
  totalAmount: z.string().min(1).max(80),
  status: z.literal("PENDING")
});

type ClaimedOutboxEvent = {
  id: string;
  type: string;
  entityId: string | null;
  payload: Prisma.JsonValue;
  attemptCount: number;
};

type NotificationDelivery = {
  userId: string;
  role: PrismaAppRole;
  type: PrismaNotificationType;
  title: string;
  message: string;
  actionUrl: string;
  dedupeKey: string;
};

export function outboxRetryDelayMs(attemptCount: number) {
  const exponent = Math.min(Math.max(attemptCount - 1, 0), 16);
  return Math.min(60 * 60 * 1000, 5_000 * (2 ** exponent));
}

async function createAuditOnce(event: ClaimedOutboxEvent, data: {
  actorId: string | null;
  action: string;
  entityType: string;
  summary: string;
  metadata: Prisma.InputJsonObject;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        ...data,
        entityId: event.entityId,
        dedupeKey: `${event.id}:audit`
      },
      select: { id: true }
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  }
}

async function createNotificationAndPush(delivery: NotificationDelivery) {
  let notificationId: string;

  try {
    const notification = await prisma.notification.create({
      data: {
        userId: delivery.userId,
        type: delivery.type,
        title: delivery.title,
        message: delivery.message,
        actionUrl: delivery.actionUrl,
        dedupeKey: delivery.dedupeKey
      },
      select: { id: true }
    });
    notificationId = notification.id;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await prisma.notification.findUnique({
      where: { dedupeKey: delivery.dedupeKey },
      select: { id: true }
    });
    if (!existing) throw error;
    notificationId = existing.id;
  }

  await publishRealtimeEvents(prisma, [{
    topic: REALTIME_TOPICS.notifications,
    dedupeKey: `${delivery.dedupeKey}:realtime`,
    entityId: notificationId,
    audienceUserIds: [delivery.userId],
    payload: { action: "created", notificationId }
  }]);

  await sendPushToUser(delivery.userId, {
    id: notificationId,
    title: delivery.title,
    message: delivery.message,
    type: delivery.type,
    url: delivery.actionUrl
  }, delivery.role);
}

async function processReservationCreated(event: ClaimedOutboxEvent) {
  if (!event.entityId) throw new Error("RESERVATION_CREATED requires an entity ID.");
  const payload = reservationCreatedPayloadSchema.parse(event.payload);
  const staffAndAdmins = await prisma.profile.findMany({
    where: { role: { in: ["STAFF", "ADMIN"] } },
    select: { id: true, role: true }
  });

  const deliveries: NotificationDelivery[] = [
    {
      userId: payload.studentId,
      role: "STUDENT",
      type: "RESERVATION",
      title: "Reservation submitted",
      message: `${payload.referenceCode} was submitted and is waiting for staff confirmation.`,
      actionUrl: "/student/reservations",
      dedupeKey: `${event.id}:student-created`
    },
    ...staffAndAdmins.map((profile) => ({
      userId: profile.id,
      role: profile.role,
      type: "RESERVATION" as const,
      title: "New student reservation",
      message: `${payload.referenceCode} needs review and confirmation.`,
      actionUrl: `/staff/reservations?query=${encodeURIComponent(payload.referenceCode)}`,
      dedupeKey: `${event.id}:staff-created:${profile.id}`
    })),
    ...payload.lowStockAlerts.flatMap((alert) => staffAndAdmins.map((profile) => ({
      userId: profile.id,
      role: profile.role,
      type: "LOW_STOCK" as const,
      title: alert.skuLabel
        ? `Low stock: ${alert.productName}`
        : alert.optionValue
          ? `Low stock: ${alert.productName} — ${alert.optionValue}`
          : `Low stock: ${alert.productName}`,
      message: alert.skuLabel
        ? `${alert.skuLabel} dropped to ${alert.newStock} pcs after reservation ${payload.referenceCode}.${alert.lowStockThreshold === undefined ? "" : ` Alert level is ${alert.lowStockThreshold} pcs.`}`
        : alert.optionValue
          ? `${alert.optionName ?? "Size"} ${alert.optionValue} dropped to ${alert.newStock} pcs after reservation ${payload.referenceCode}.${alert.lowStockThreshold === undefined ? "" : ` Alert level is ${alert.lowStockThreshold} pcs.`}`
          : `${alert.productName} dropped to ${alert.newStock} pcs after reservation ${payload.referenceCode}.`,
      actionUrl: `/staff/inventory?productId=${encodeURIComponent(alert.productId)}`,
      dedupeKey: `${event.id}:low-stock:${alert.skuId ?? alert.variantId ?? alert.productId}:${profile.id}`
    })))
  ];

  for (const delivery of deliveries) await createNotificationAndPush(delivery);

  await createAuditOnce(event, {
    actorId: payload.studentId,
    action: "RESERVATION_CREATED",
    entityType: "reservation",
    summary: `Created reservation ${payload.referenceCode}.`,
    metadata: {
      referenceCode: payload.referenceCode,
      itemCount: payload.itemCount,
      totalAmount: payload.totalAmount,
      paymentMethod: payload.paymentMethod,
      idempotencyKey: payload.idempotencyKey,
      outboxEventId: event.id
    }
  });
}

async function processReservationStatusChanged(event: ClaimedOutboxEvent) {
  if (!event.entityId) throw new Error("RESERVATION_STATUS_CHANGED requires an entity ID.");
  const payload = reservationStatusChangedPayloadSchema.parse(event.payload);
  await createNotificationAndPush({
    userId: payload.studentId,
    role: "STUDENT",
    type: payload.notificationType,
    title: payload.notificationTitle,
    message: payload.notificationMessage,
    actionUrl: "/student/reservations",
    dedupeKey: `${event.id}:student-status`
  });
  await createAuditOnce(event, {
    actorId: payload.actorId,
    action: "RESERVATION_STATUS_UPDATED",
    entityType: "reservation",
    summary: `Updated reservation ${payload.referenceCode} from ${payload.previousStatus} to ${payload.nextStatus}.`,
    metadata: {
      referenceCode: payload.referenceCode,
      previousStatus: payload.previousStatus,
      nextStatus: payload.nextStatus,
      outboxEventId: event.id
    }
  });
}

async function processReservationRescheduled(event: ClaimedOutboxEvent) {
  if (!event.entityId) throw new Error("RESERVATION_RESCHEDULED requires an entity ID.");
  const payload = reservationRescheduledPayloadSchema.parse(event.payload);
  const pickupStart = new Date(payload.pickupStart);
  const schedule = pickupStart.toLocaleString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  });
  await createNotificationAndPush({
    userId: payload.studentId,
    role: "STUDENT",
    type: "RESERVATION",
    title: "Pickup schedule updated",
    message: `${payload.referenceCode} was rescheduled to ${schedule}.`,
    actionUrl: "/student/reservations",
    dedupeKey: `${event.id}:student-rescheduled`
  });
}

async function processRestrictionExpired(event: ClaimedOutboxEvent) {
  if (!event.entityId) throw new Error("RESTRICTION_EXPIRED requires an entity ID.");
  const payload = restrictionExpiredPayloadSchema.parse(event.payload);
  await createNotificationAndPush({
    userId: payload.studentId,
    role: "STUDENT",
    type: "SYSTEM",
    title: "Reservation access restored",
    message: "Your temporary reservation restriction expired. You can reserve available items again.",
    actionUrl: "/student/shop",
    dedupeKey: `restriction-expired:${event.entityId}`
  });
  await createAuditOnce(event, {
    actorId: null,
    action: "STUDENT_RESTRICTION_EXPIRED",
    entityType: "account_restriction",
    summary: `Automatically expired reservation restriction ${event.entityId}.`,
    metadata: {
      studentId: payload.studentId,
      endedAt: payload.endedAt,
      outboxEventId: event.id
    }
  });
}

async function processProductImageDelete(event: ClaimedOutboxEvent) {
  const payload = productImageDeletePayloadSchema.parse(event.payload);
  await deleteProductImage(payload.path);
}

async function processReceiptStatusChanged(event: ClaimedOutboxEvent) {
  if (!event.entityId) throw new Error("RECEIPT_STATUS_CHANGED requires an entity ID.");
  const payload = receiptStatusChangedPayloadSchema.parse(event.payload);
  const verified = payload.nextStatus === "VERIFIED";
  const title = verified ? "Digital receipt verified" : "Digital receipt voided";
  const message = verified
    ? `${payload.receiptCode} is now verified and ready to download.`
    : payload.reason
      ? `${payload.receiptCode} was voided by commissary staff. Reason: ${payload.reason}`
      : `${payload.receiptCode} was voided by commissary staff.`;

  await createNotificationAndPush({
    userId: payload.studentId,
    role: "STUDENT",
    type: "RECEIPT",
    title,
    message,
    actionUrl: "/student/receipts",
    dedupeKey: `${event.id}:student-receipt`
  });
  await createAuditOnce(event, {
    actorId: payload.actorId,
    action: verified ? "RECEIPT_VERIFIED" : "RECEIPT_VOIDED",
    entityType: "receipt",
    summary: `${verified ? "Verified" : "Voided"} receipt ${payload.receiptCode}.`,
    metadata: {
      receiptCode: payload.receiptCode,
      studentId: payload.studentId,
      reservationId: payload.reservationId,
      totalAmount: payload.totalAmount,
      previousStatus: payload.previousStatus,
      reason: payload.reason,
      outboxEventId: event.id
    }
  });
}

async function processReceiptCreated(event: ClaimedOutboxEvent) {
  if (!event.entityId) throw new Error("RECEIPT_CREATED requires an entity ID.");
  const payload = receiptCreatedPayloadSchema.parse(event.payload);
  const staffAndAdmins = await prisma.profile.findMany({
    where: { role: { in: ["STAFF", "ADMIN"] } },
    select: { id: true, role: true }
  });

  const deliveries: NotificationDelivery[] = [
    {
      userId: payload.studentId,
      role: "STUDENT",
      type: "RECEIPT",
      title: "Digital receipt generated",
      message: `${payload.receiptCode} was created for ${payload.referenceCode} and is waiting for verification.`,
      actionUrl: "/student/receipts",
      dedupeKey: `${event.id}:student-receipt-created`
    },
    ...staffAndAdmins.map((profile) => ({
      userId: profile.id,
      role: profile.role,
      type: "RECEIPT" as const,
      title: "Receipt needs verification",
      message: `${payload.receiptCode} was generated for ${payload.referenceCode}.`,
      actionUrl: `/staff/receipt-verification?receiptId=${encodeURIComponent(event.entityId!)}`,
      dedupeKey: `${event.id}:staff-receipt-created:${profile.id}`
    }))
  ];

  for (const delivery of deliveries) await createNotificationAndPush(delivery);

  await createAuditOnce(event, {
    actorId: payload.actorId,
    action: "RECEIPT_GENERATED",
    entityType: "receipt",
    summary: `Generated receipt ${payload.receiptCode} for ${payload.referenceCode}.`,
    metadata: {
      receiptCode: payload.receiptCode,
      reservationId: payload.reservationId,
      referenceCode: payload.referenceCode,
      totalAmount: payload.totalAmount,
      outboxEventId: event.id
    }
  });
}

async function processEvent(event: ClaimedOutboxEvent) {
  if (event.type === OUTBOX_EVENT_TYPES.reservationCreated) {
    await processReservationCreated(event);
    return;
  }
  if (event.type === OUTBOX_EVENT_TYPES.reservationStatusChanged) {
    await processReservationStatusChanged(event);
    return;
  }
  if (event.type === OUTBOX_EVENT_TYPES.reservationRescheduled) {
    await processReservationRescheduled(event);
    return;
  }
  if (event.type === OUTBOX_EVENT_TYPES.restrictionExpired) {
    await processRestrictionExpired(event);
    return;
  }
  if (event.type === OUTBOX_EVENT_TYPES.receiptCreated) {
    await processReceiptCreated(event);
    return;
  }
  if (event.type === OUTBOX_EVENT_TYPES.receiptStatusChanged) {
    await processReceiptStatusChanged(event);
    return;
  }
  if (event.type === OUTBOX_EVENT_TYPES.productImageDelete) {
    await processProductImageDelete(event);
    return;
  }
  throw new Error(`Unsupported outbox event type: ${event.type}`);
}

async function claimOutboxEvents(limit: number) {
  return prisma.$queryRaw<ClaimedOutboxEvent[]>`
    UPDATE "outbox_events"
    SET
      "locked_at" = NOW(),
      "attempt_count" = "attempt_count" + 1
    WHERE "id" IN (
      SELECT "id"
      FROM "outbox_events"
      WHERE "processed_at" IS NULL
        AND "available_at" <= NOW()
        AND ("locked_at" IS NULL OR "locked_at" < NOW() - INTERVAL '5 minutes')
      ORDER BY "created_at" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING
      "id",
      "type",
      "entity_id" AS "entityId",
      "payload",
      "attempt_count" AS "attemptCount"
  `;
}

export async function runOutboxBatch(input: { limit?: number } = {}) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const events = await claimOutboxEvents(limit);
  let processed = 0;
  let failed = 0;

  for (const event of events) {
    try {
      await processEvent(event);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), lockedAt: null, lastError: null },
        select: { id: true }
      });
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown outbox processing error.";
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          lockedAt: null,
          availableAt: new Date(Date.now() + outboxRetryDelayMs(event.attemptCount)),
          lastError: message.slice(0, 2_000)
        },
        select: { id: true }
      });
      console.warn(`Outbox event ${event.id} failed: ${message}`);
      failed += 1;
    }
  }

  return { claimed: events.length, processed, failed };
}

/**
 * Ask Vercel to process committed outbox work after the response without making
 * the request wait for notifications or audit enrichment. The database event is
 * still the source of truth, so the scheduled maintenance job can safely retry
 * anything that does not finish here.
 */
export function scheduleOutboxProcessing() {
  if (!process.env.VERCEL) return;

  waitUntil(
    runOutboxBatch({ limit: 10 }).catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown outbox scheduling error.";
      console.warn(`Background outbox batch failed: ${message}`);
    })
  );
}
