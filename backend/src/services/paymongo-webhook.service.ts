import { Prisma } from "@prisma/client";
import {
  validateRecognizedPaidCheckout,
  type PersistedCheckoutAttempt,
  type RecognizedOnlinePayment
} from "../domain/paymongo-payment-validation.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";
import {
  paymongoWebhookDedupeKey,
  type NormalizedPaymongoWebhook
} from "../utils/paymongo-webhook.js";
import {
  applyVerifiedPaidCheckoutInTransaction,
  dispatchPaymentPush,
  recordRejectedPaymentAuditInTransaction
} from "./paymongo-payment-transition.service.js";

const PAID_CHECKOUT_EVENT = "checkout_session.payment.paid";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uniqueTargetIncludes(error: Prisma.PrismaClientKnownRequestError, field: string) {
  const target = error.meta?.target;
  return Array.isArray(target)
    ? target.some((entry) => String(entry).includes(field))
    : String(target ?? "").includes(field);
}

function isWebhookDedupeConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002"
    && (uniqueTargetIncludes(error, "dedupe_key") || uniqueTargetIncludes(error, "provider_event_id"));
}

async function recordStandaloneIgnoredEvent(input: {
  event: NormalizedPaymongoWebhook;
  payloadHash: string;
  dedupeKey: string;
}) {
  try {
    await prisma.paymongoWebhookEvent.create({
      data: {
        providerEventId: input.event.providerEventId,
        dedupeKey: input.dedupeKey,
        eventType: input.event.eventType,
        livemode: input.event.livemode,
        resourceId: input.event.checkoutSession?.id ?? null,
        payloadHash: input.payloadHash,
        status: "IGNORED"
      },
      select: { id: true }
    });
    return { acknowledged: true, duplicate: false, processed: false, rejected: false };
  } catch (error) {
    if (isWebhookDedupeConflict(error)) {
      return { acknowledged: true, duplicate: true, processed: false, rejected: false };
    }
    throw error;
  }
}

async function createRejectedEventInTransaction(input: {
  tx: Prisma.TransactionClient;
  event: NormalizedPaymongoWebhook;
  payloadHash: string;
  dedupeKey: string;
  receivedAt: Date;
  onlinePaymentId: string;
  referenceCode: string;
  reasonCode: string;
}) {
  await input.tx.paymongoWebhookEvent.create({
    data: {
      providerEventId: input.event.providerEventId,
      dedupeKey: input.dedupeKey,
      eventType: input.event.eventType,
      livemode: input.event.livemode,
      resourceId: input.event.checkoutSession?.id ?? null,
      payloadHash: input.payloadHash,
      status: "REJECTED",
      reasonCode: input.reasonCode,
      onlinePaymentId: input.onlinePaymentId,
      receivedAt: input.receivedAt,
      processedAt: new Date()
    },
    select: { id: true }
  });
  await recordRejectedPaymentAuditInTransaction({
    tx: input.tx,
    paymentId: input.onlinePaymentId,
    referenceCode: input.referenceCode,
    reasonCode: input.reasonCode,
    source: "WEBHOOK",
    livemode: input.event.livemode
  });
  return {
    disposition: "REJECTED" as const,
    reasonCode: input.reasonCode,
    paymentId: input.onlinePaymentId
  };
}

export async function processPaymongoWebhook(input: {
  event: NormalizedPaymongoWebhook;
  payloadHash: string;
  receivedAt?: Date;
}) {
  const dedupeKey = paymongoWebhookDedupeKey(input.event.providerEventId, input.payloadHash);
  if (input.event.eventType !== PAID_CHECKOUT_EVENT) {
    return recordStandaloneIgnoredEvent({ ...input, dedupeKey });
  }

  const checkoutSession = input.event.checkoutSession;
  const onlinePaymentId = checkoutSession?.metadata.online_payment_id;
  if (!checkoutSession || !onlinePaymentId || !UUID_PATTERN.test(onlinePaymentId)) {
    return recordStandaloneIgnoredEvent({ ...input, dedupeKey });
  }

  const receivedAt = input.receivedAt ?? new Date();
  let transactionResult: {
    disposition: "DUPLICATE" | "IGNORED" | "REJECTED" | "PROCESSED";
    reasonCode?: string;
    paymentId?: string;
    pushNotification?: Awaited<ReturnType<typeof applyVerifiedPaidCheckoutInTransaction>>["pushNotification"];
    cleanupAttemptIds?: string[];
  };

  try {
    transactionResult = await prisma.$transaction(
      async (tx) => {
        const duplicate = await tx.paymongoWebhookEvent.findUnique({
          where: { dedupeKey },
          select: { id: true }
        });
        if (duplicate) return { disposition: "DUPLICATE" as const };

        const onlinePayment = await tx.onlinePayment.findUnique({
          where: { id: onlinePaymentId },
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
        });

        if (!onlinePayment) {
          await tx.paymongoWebhookEvent.create({
            data: {
              providerEventId: input.event.providerEventId,
              dedupeKey,
              eventType: input.event.eventType,
              livemode: input.event.livemode,
              resourceId: checkoutSession.id,
              payloadHash: input.payloadHash,
              status: "IGNORED",
              receivedAt,
              processedAt: new Date()
            },
            select: { id: true }
          });
          return { disposition: "IGNORED" as const };
        }

        const attemptId = checkoutSession.metadata.online_payment_attempt_id;
        const attempt = attemptId && UUID_PATTERN.test(attemptId)
          ? await tx.onlinePaymentAttempt.findUnique({ where: { id: attemptId } })
          : null;
        if (!attempt || attempt.onlinePaymentId !== onlinePayment.id) {
          return createRejectedEventInTransaction({
            tx,
            event: input.event,
            payloadHash: input.payloadHash,
            dedupeKey,
            receivedAt,
            onlinePaymentId: onlinePayment.id,
            referenceCode: onlinePayment.reservation.referenceCode,
            reasonCode: "UNKNOWN_CHECKOUT_ATTEMPT"
          });
        }

        const validation = validateRecognizedPaidCheckout({
          checkoutSession,
          providerLivemode: input.event.livemode,
          onlinePayment: onlinePayment as RecognizedOnlinePayment,
          attempt: attempt as PersistedCheckoutAttempt,
          receivedAt
        });
        if (!validation.valid) {
          return createRejectedEventInTransaction({
            tx,
            event: input.event,
            payloadHash: input.payloadHash,
            dedupeKey,
            receivedAt,
            onlinePaymentId: onlinePayment.id,
            referenceCode: onlinePayment.reservation.referenceCode,
            reasonCode: validation.reasonCode
          });
        }

        let transition: Awaited<ReturnType<typeof applyVerifiedPaidCheckoutInTransaction>>;
        try {
          transition = await applyVerifiedPaidCheckoutInTransaction({
            tx,
            onlinePayment: onlinePayment as RecognizedOnlinePayment,
            attempt: attempt as PersistedCheckoutAttempt & { status: string },
            verified: validation.value,
            source: "WEBHOOK",
            sourceId: input.event.providerEventId ?? dedupeKey
          });
        } catch (error) {
          if (error instanceof HttpError && error.code === "PROVIDER_ID_CONFLICT") {
            return createRejectedEventInTransaction({
              tx,
              event: input.event,
              payloadHash: input.payloadHash,
              dedupeKey,
              receivedAt,
              onlinePaymentId: onlinePayment.id,
              referenceCode: onlinePayment.reservation.referenceCode,
              reasonCode: "PROVIDER_ID_CONFLICT"
            });
          }
          throw error;
        }

        await tx.paymongoWebhookEvent.create({
          data: {
            providerEventId: input.event.providerEventId,
            dedupeKey,
            eventType: input.event.eventType,
            livemode: input.event.livemode,
            resourceId: checkoutSession.id,
            payloadHash: input.payloadHash,
            status: "PROCESSED",
            onlinePaymentId: onlinePayment.id,
            receivedAt,
            processedAt: new Date()
          },
          select: { id: true }
        });

        return {
          disposition: "PROCESSED" as const,
          paymentId: onlinePayment.id,
          pushNotification: transition.pushNotification,
          cleanupAttemptIds: transition.cleanupAttemptIds
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 }
    );
  } catch (error) {
    if (isWebhookDedupeConflict(error)) {
      return { acknowledged: true, duplicate: true, processed: false, rejected: false };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      const committedDuplicate = await prisma.paymongoWebhookEvent.findUnique({
        where: { dedupeKey },
        select: { id: true }
      });
      if (committedDuplicate) {
        return { acknowledged: true, duplicate: true, processed: false, rejected: false };
      }
      throw new HttpError(503, "Payment confirmation is temporarily busy. Please retry.", "PAYMENT_CONFIRMATION_RETRY", {
        retryable: true
      });
    }
    throw error;
  }

  if (transactionResult.disposition === "DUPLICATE") {
    return { acknowledged: true, duplicate: true, processed: false, rejected: false };
  }
  if (transactionResult.disposition === "IGNORED") {
    return { acknowledged: true, duplicate: false, processed: false, rejected: false };
  }
  if (transactionResult.disposition === "REJECTED") {
    return { acknowledged: true, duplicate: false, processed: false, rejected: true };
  }

  void dispatchPaymentPush(transactionResult.pushNotification);
  if (transactionResult.cleanupAttemptIds?.length) {
    void import("./paymongo-reconciliation.service.js").then(({ expireCheckoutAttemptBestEffort }) =>
      Promise.all(transactionResult.cleanupAttemptIds!.map((attemptId) =>
        expireCheckoutAttemptBestEffort(attemptId)
      ))
    ).catch((error) => {
      console.warn("PayMongo checkout cleanup deferred to maintenance:", error instanceof Error ? error.message : error);
    });
  }
  return { acknowledged: true, duplicate: false, processed: true, rejected: false };
}
