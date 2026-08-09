import { Prisma } from "@prisma/client";
import { assertOnlinePaymentTransition } from "../domain/online-payment.js";
import type {
  PersistedCheckoutAttempt,
  RecognizedOnlinePayment,
  VerifiedPaidCheckout
} from "../domain/paymongo-payment-validation.js";
import type { OnlinePaymentStatus } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import { sendPushToUser } from "./push.service.js";

type PaymentPush = {
  id: string;
  userId: string;
  title: string;
  message: string;
  actionUrl: string;
};

export async function dispatchPaymentPush(notification: PaymentPush | null | undefined) {
  if (!notification) return;
  try {
    await sendPushToUser(notification.userId, {
      id: notification.id,
      title: notification.title,
      message: notification.message,
      type: "PAYMENT",
      url: notification.actionUrl
    }, "STUDENT");
  } catch (error) {
    console.warn("Payment push delivery skipped:", error instanceof Error ? error.message : error);
  }
}

function paidNextStatus(input: {
  previousStatus: OnlinePaymentStatus;
  reservationStatus: string;
  attemptAlreadyRecordedPaid: boolean;
}) {
  if (input.attemptAlreadyRecordedPaid) return input.previousStatus;
  if (
    (input.previousStatus === "INITIALIZING" || input.previousStatus === "AWAITING_PAYMENT")
    && input.reservationStatus === "PENDING"
  ) {
    return "PAID" as const;
  }
  if (input.previousStatus === "REFUND_REVIEW_REQUIRED") return input.previousStatus;
  return "REFUND_REVIEW_REQUIRED" as const;
}

export async function applyVerifiedPaidCheckoutInTransaction(input: {
  tx: Prisma.TransactionClient;
  onlinePayment: RecognizedOnlinePayment;
  attempt: PersistedCheckoutAttempt & { status: string };
  verified: VerifiedPaidCheckout;
  actorId?: string | null;
  source: "WEBHOOK" | "RECONCILIATION";
  sourceId?: string | null;
}) {
  const { tx, onlinePayment, attempt, verified } = input;
  const attemptConflict = await tx.onlinePaymentAttempt.findFirst({
    where: {
      id: { not: attempt.id },
      OR: [
        { providerCheckoutSessionId: verified.checkoutSession.id },
        { providerPaymentIntentId: verified.paymentIntentId },
        { providerPaymentId: verified.payment.id }
      ]
    },
    select: { id: true }
  });
  const paymentConflict = await tx.onlinePayment.findFirst({
    where: {
      id: { not: onlinePayment.id },
      OR: [
        { providerCheckoutSessionId: verified.checkoutSession.id },
        { providerPaymentIntentId: verified.paymentIntentId },
        { providerPaymentId: verified.payment.id }
      ]
    },
    select: { id: true }
  });
  if (attemptConflict || paymentConflict) {
    throw new HttpError(409, "Provider payment identifiers are already linked elsewhere.", "PROVIDER_ID_CONFLICT");
  }

  const attemptAlreadyRecordedPaid = attempt.status === "PAID"
    && attempt.providerPaymentId === verified.payment.id
    && attempt.providerPaymentIntentId === verified.paymentIntentId;
  const previousStatus = onlinePayment.status as OnlinePaymentStatus;
  const nextStatus = paidNextStatus({
    previousStatus,
    reservationStatus: onlinePayment.reservation.status,
    attemptAlreadyRecordedPaid
  });
  assertOnlinePaymentTransition(previousStatus, nextStatus);

  await tx.onlinePaymentAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "PAID",
      providerCheckoutSessionId: verified.checkoutSession.id,
      providerPaymentIntentId: verified.paymentIntentId,
      providerPaymentId: verified.payment.id,
      paidAt: verified.paidAt,
      feeCentavos: verified.payment.feeCentavos,
      netAmountCentavos: verified.payment.netAmountCentavos,
      lastReconciledAt: new Date(),
      lastProviderErrorCode: null
    },
    select: { id: true }
  });

  await tx.onlinePayment.update({
    where: { id: onlinePayment.id },
    data: {
      status: nextStatus,
      providerCheckoutSessionId: verified.checkoutSession.id,
      providerPaymentIntentId: verified.paymentIntentId,
      providerPaymentId: verified.payment.id,
      feeCentavos: verified.payment.feeCentavos,
      netAmountCentavos: verified.payment.netAmountCentavos,
      // Aggregate provider identifiers, fee, net, and timestamp all describe
      // the same latest verified charge. Earlier charges remain immutable on
      // their individual attempt rows for refund review.
      paidAt: verified.paidAt,
      lastReconciledAt: new Date()
    },
    select: { id: true }
  });

  const cleanupAttempts = await tx.onlinePaymentAttempt.findMany({
    where: {
      onlinePaymentId: onlinePayment.id,
      id: { not: attempt.id },
      status: { in: ["CREATING", "CREATE_UNKNOWN", "ACTIVE", "EXPIRY_REQUESTED"] }
    },
    select: { id: true }
  });
  if (cleanupAttempts.length) {
    await tx.onlinePaymentAttempt.updateMany({
      where: { id: { in: cleanupAttempts.map((entry) => entry.id) } },
      data: { status: "EXPIRY_REQUESTED", expireRequestedAt: new Date() }
    });
  }

  const statusChanged = previousStatus !== nextStatus;
  const requiresRefundReview = nextStatus === "REFUND_REVIEW_REQUIRED";
  const metadata: Prisma.InputJsonObject = {
    referenceCode: onlinePayment.reservation.referenceCode,
    attemptId: attempt.id,
    checkoutSessionId: verified.checkoutSession.id,
    providerPaymentId: verified.payment.id,
    previousStatus,
    nextStatus,
    source: input.source,
    livemode: onlinePayment.livemode,
    ...(input.sourceId ? { sourceId: input.sourceId } : {})
  };

  await tx.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: statusChanged
        ? requiresRefundReview ? "ONLINE_PAYMENT_REFUND_REVIEW_REQUIRED" : "ONLINE_PAYMENT_CONFIRMED"
        : "ONLINE_PAYMENT_CONFIRMATION_RECORDED",
      entityType: "online_payment",
      entityId: onlinePayment.id,
      summary: statusChanged
        ? requiresRefundReview
          ? `Payment for reservation ${onlinePayment.reservation.referenceCode} requires manual refund review.`
          : `Confirmed online GCash payment for reservation ${onlinePayment.reservation.referenceCode}.`
        : `Recorded an idempotent payment confirmation for reservation ${onlinePayment.reservation.referenceCode}.`,
      metadata
    },
    select: { id: true }
  });

  let pushNotification: PaymentPush | null = null;
  if (statusChanged) {
    const notification = await tx.notification.upsert({
      where: {
        dedupeKey: requiresRefundReview
          ? `payment-refund-review:${onlinePayment.id}`
          : `payment-paid:${onlinePayment.id}`
      },
      create: {
        userId: onlinePayment.reservation.studentId,
        type: "PAYMENT",
        title: requiresRefundReview ? "GCash payment needs review" : "GCash payment confirmed",
        message: requiresRefundReview
          ? `${onlinePayment.reservation.referenceCode} received a payment after checkout was closed. Staff review is required.`
          : `${onlinePayment.reservation.referenceCode} has a confirmed online GCash payment.`,
        actionUrl: `/student/payments/${onlinePayment.id}`,
        dedupeKey: requiresRefundReview
          ? `payment-refund-review:${onlinePayment.id}`
          : `payment-paid:${onlinePayment.id}`
      },
      update: {},
      select: { id: true, userId: true, title: true, message: true, actionUrl: true }
    });
    pushNotification = {
      id: notification.id,
      userId: notification.userId,
      title: notification.title,
      message: notification.message,
      actionUrl: notification.actionUrl ?? `/student/payments/${onlinePayment.id}`
    };
  }

  return {
    previousStatus,
    nextStatus,
    pushNotification,
    cleanupAttemptIds: cleanupAttempts.map((entry) => entry.id)
  };
}

export async function recordRejectedPaymentAuditInTransaction(input: {
  tx: Prisma.TransactionClient;
  paymentId: string;
  referenceCode: string;
  reasonCode: string;
  source: "WEBHOOK" | "RECONCILIATION";
  actorId?: string | null;
  livemode: boolean;
}) {
  await input.tx.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: `ONLINE_PAYMENT_${input.source}_REJECTED`,
      entityType: "online_payment",
      entityId: input.paymentId,
      summary: `Rejected a mismatched payment confirmation for reservation ${input.referenceCode}.`,
      metadata: {
        reasonCode: input.reasonCode,
        source: input.source,
        livemode: input.livemode
      }
    },
    select: { id: true }
  });
}
