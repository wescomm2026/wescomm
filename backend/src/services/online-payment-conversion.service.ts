import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { OUTBOX_EVENT_TYPES } from "./outbox.service.js";
import {
  expireCheckoutAttemptBestEffort,
  reconcileCheckoutAttempt
} from "./paymongo-reconciliation.service.js";

/**
 * Cash-only migration support. Existing online (PayMongo GCash) records stay
 * readable forever, but any open, unpaid checkout is converted to cash so the
 * reservation can still be fulfilled.
 *
 * Conversion is two-phase so a late successful provider payment can never be
 * overwritten:
 * 1. The reservation stays PAYMONGO_GCASH while any attempt is unresolved.
 *    Unresolved attempts are marked EXPIRY_REQUESTED and the provider session
 *    is expired out-of-band; nothing else changes.
 * 2. Once every attempt is terminal and non-paid, a serializable transaction
 *    rechecks the payment and attempts again, then conditionally cancels the
 *    payment and switches the reservation to PAY_AT_COMMISSARY/COMMISSARY.
 *
 * A successful payment found at any point is preserved untouched, and a late
 * paid confirmation afterwards is routed to refund review by the webhook
 * machinery. Audit and notification delivery for a successful conversion
 * happen through the transactional outbox.
 */
export const ONLINE_PAYMENT_CONVERSION_STATUSES = ["INITIALIZING", "AWAITING_PAYMENT", "EXPIRED"] as const;

export const UNRESOLVED_CONVERSION_ATTEMPT_STATUSES = ["CREATING", "CREATE_UNKNOWN", "ACTIVE", "EXPIRY_REQUESTED"] as const;

export const PERMANENT_CONVERSION_ATTEMPT_BLOCKERS = ["PAID", "MANUAL_REVIEW_REQUIRED"] as const;

const PROVIDER_EXPIRABLE_ATTEMPT_STATUSES = ["ACTIVE", "EXPIRY_REQUESTED"] as const;

export type OnlinePaymentConversionAction = "CONVERT_TO_CASH" | "KEEP";

export const ONLINE_PAYMENT_CONVERSION_AUDIT_ACTION = "ONLINE_PAYMENT_CONVERTED_TO_CASH";

export type ConversionAttemptGate = "CONVERTIBLE" | "PAID_ATTEMPT" | "UNRESOLVED_ATTEMPT" | "MANUAL_REVIEW";

/**
 * Pure attempt gate: a payment is convertible only when it has no paid
 * attempt, no unresolved attempt (a provider outcome is still possible), and
 * no attempt under manual staff review. Terminal non-paid attempts (EXPIRED,
 * FAILED, ABANDONED) do not block conversion.
 */
export function classifyConversionAttemptGate(attemptStatuses: string[]): ConversionAttemptGate {
  if (attemptStatuses.length === 0) return "CONVERTIBLE";
  if (attemptStatuses.includes("PAID")) return "PAID_ATTEMPT";
  if (attemptStatuses.includes("MANUAL_REVIEW_REQUIRED")) return "MANUAL_REVIEW";
  if (attemptStatuses.some((status) => (UNRESOLVED_CONVERSION_ATTEMPT_STATUSES as readonly string[]).includes(status))) {
    return "UNRESOLVED_ATTEMPT";
  }
  return "CONVERTIBLE";
}

/**
 * Pure decision function: only open, unpaid online payments attached to a
 * PAYMONGO_GCASH reservation are eligible for conversion. Everything else
 * (paid, refund-related, already-cash reservations) is preserved.
 */
export function planOnlinePaymentConversion(input: {
  reservationPaymentMethod: string;
  onlinePaymentStatus: string | null;
}): OnlinePaymentConversionAction {
  if (input.reservationPaymentMethod !== "PAYMONGO_GCASH") return "KEEP";
  if (!input.onlinePaymentStatus) return "KEEP";
  if ((ONLINE_PAYMENT_CONVERSION_STATUSES as readonly string[]).includes(input.onlinePaymentStatus)) {
    return "CONVERT_TO_CASH";
  }
  return "KEEP";
}

export type OnlinePaymentConversionResult = {
  paymentId: string;
  reservationId: string;
  referenceCode: string;
  studentId: string | null;
  previousPaymentMethod: string;
  converted: boolean;
  skippedReason?: string;
  deferredAttemptIds?: string[];
};

function skippedResult(input: {
  paymentId: string;
  reservationId: string;
  referenceCode: string;
  studentId: string | null;
  previousPaymentMethod: string;
  skippedReason: string;
}): OnlinePaymentConversionResult {
  return { ...input, converted: false };
}

/**
 * Converts one open online payment to cash. Idempotent and race-safe:
 * - a serializable transaction re-reads the payment and attempts,
 * - any paid payment or paid attempt is preserved (KEEP),
 * - unresolved attempts defer conversion and request provider expiry first,
 * - all writes are status-qualified, so a concurrent change wins instead of
 *   being overwritten.
 */
export async function convertOpenOnlinePaymentToCash(paymentId: string): Promise<OnlinePaymentConversionResult> {
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const payment = await tx.onlinePayment.findUnique({
          where: { id: paymentId },
          select: {
            id: true,
            status: true,
            reservation: {
              select: {
                id: true,
                studentId: true,
                referenceCode: true,
                paymentMethod: true
              }
            },
            attempts: {
              select: {
                id: true,
                status: true,
                providerCheckoutSessionId: true
              }
            }
          },
          relationLoadStrategy: "join"
        });
        if (!payment) throw new Error(`Online payment ${paymentId} not found.`);

        const base = skippedResult({
          paymentId: payment.id,
          reservationId: payment.reservation.id,
          referenceCode: payment.reservation.referenceCode,
          studentId: payment.reservation.studentId,
          previousPaymentMethod: payment.reservation.paymentMethod,
          skippedReason: ""
        });

        const action = planOnlinePaymentConversion({
          reservationPaymentMethod: payment.reservation.paymentMethod,
          onlinePaymentStatus: payment.status
        });
        if (action === "KEEP") {
          return { ...base, skippedReason: `status=${payment.status} method=${payment.reservation.paymentMethod}` };
        }

        const gate = classifyConversionAttemptGate(payment.attempts.map((attempt) => attempt.status));
        if (gate === "PAID_ATTEMPT") return { ...base, skippedReason: "ATTEMPT_ALREADY_PAID" };
        if (gate === "MANUAL_REVIEW") return { ...base, skippedReason: "ATTEMPT_MANUAL_REVIEW_REQUIRED" };
        if (gate === "UNRESOLVED_ATTEMPT") {
          // Phase 1: request provider expiry, keep everything else untouched
          // so a late paid confirmation can still be recorded.
          const now = new Date();
          await tx.onlinePaymentAttempt.updateMany({
            where: {
              onlinePaymentId: payment.id,
              status: { in: [...UNRESOLVED_CONVERSION_ATTEMPT_STATUSES] }
            },
            data: { status: "EXPIRY_REQUESTED", expireRequestedAt: now }
          });
          return {
            ...base,
            skippedReason: "PROVIDER_EXPIRY_PENDING",
            deferredAttemptIds: payment.attempts
              .filter((attempt) => (UNRESOLVED_CONVERSION_ATTEMPT_STATUSES as readonly string[]).includes(attempt.status))
              .map((attempt) => attempt.id)
          };
        }

        // Phase 2: every attempt is terminal and non-paid. Conditionally flip
        // the payment and reservation with status-qualified writes.
        const now = new Date();
        const cancelled = await tx.onlinePayment.updateMany({
          where: { id: payment.id, status: { in: [...ONLINE_PAYMENT_CONVERSION_STATUSES] } },
          data: { status: "CANCELLED", cancelledAt: now }
        });
        if (cancelled.count === 0) return { ...base, skippedReason: "PAYMENT_STATE_CHANGED" };

        const reservation = await tx.reservation.updateMany({
          where: { id: payment.reservation.id, paymentMethod: "PAYMONGO_GCASH" },
          data: {
            paymentMethod: "PAY_AT_COMMISSARY",
            preferredCollectionChannel: "COMMISSARY"
          }
        });
        if (reservation.count === 0) {
          throw new Error(`Reservation ${payment.reservation.id} changed while converting payment ${payment.id}.`);
        }

        await tx.outboxEvent.create({
          data: {
            type: OUTBOX_EVENT_TYPES.onlinePaymentConvertedToCash,
            entityId: payment.id,
            payload: {
              studentId: payment.reservation.studentId,
              reservationId: payment.reservation.id,
              referenceCode: payment.reservation.referenceCode,
              previousPaymentMethod: payment.reservation.paymentMethod
            }
          },
          select: { id: true }
        });

        return {
          paymentId: payment.id,
          reservationId: payment.reservation.id,
          referenceCode: payment.reservation.referenceCode,
          studentId: payment.reservation.studentId,
          previousPaymentMethod: payment.reservation.paymentMethod,
          converted: true
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 15_000 });

      return outcome;
    } catch (error) {
      const serializationConflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (serializationConflict && pass === 0) continue;
      if (serializationConflict) {
        // A concurrent webhook won the race. Skipping is safe: the payment is
        // either still open (retry later) or paid (preserved).
        console.warn(`Online payment conversion for ${paymentId} conflicted with a concurrent write; skipping.`);
        return {
          paymentId,
          reservationId: "",
          referenceCode: "",
          studentId: null,
          previousPaymentMethod: "",
          converted: false,
          skippedReason: "SERIALIZATION_CONFLICT"
        };
      }
      throw error;
    }
  }

  throw new Error(`Online payment conversion for ${paymentId} could not be completed.`);
}

/**
 * Phase 1 completion: after marking attempts EXPIRY_REQUESTED, expire the
 * provider sessions best-effort so a later run can safely convert.
 */
export async function expireDeferredConversionAttempts(
  attempts: Array<{ id: string; status: string; providerCheckoutSessionId: string | null }>
) {
  for (const attempt of attempts) {
    try {
      if (PROVIDER_EXPIRABLE_ATTEMPT_STATUSES.includes(attempt.status as (typeof PROVIDER_EXPIRABLE_ATTEMPT_STATUSES)[number])) {
        await expireCheckoutAttemptBestEffort(attempt.id);
      } else if (attempt.status === "CREATING" || attempt.status === "CREATE_UNKNOWN") {
        await reconcileCheckoutAttempt(attempt.id);
      }
    } catch (error) {
      console.warn(`Provider expiry for attempt ${attempt.id} skipped:`, error instanceof Error ? error.message : error);
    }
  }
}

export type OnlinePaymentConversionRun = {
  dryRun: boolean;
  scanned: number;
  converted: number;
  skipped: number;
  results: OnlinePaymentConversionResult[];
};

/**
 * Scans open online payments (bounded) and converts eligible ones to cash.
 * `dryRun: true` reports without writing anything.
 */
export async function runOnlinePaymentCashConversion(input: {
  limit: number;
  dryRun: boolean;
}): Promise<OnlinePaymentConversionRun> {
  const payments = await prisma.onlinePayment.findMany({
    where: {
      status: { in: [...ONLINE_PAYMENT_CONVERSION_STATUSES] },
      reservation: { paymentMethod: "PAYMONGO_GCASH" },
      attempts: {
        none: { status: { in: [...PERMANENT_CONVERSION_ATTEMPT_BLOCKERS] } }
      }
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: input.limit
  });

  const results: OnlinePaymentConversionResult[] = [];
  for (const { id } of payments) {
    if (input.dryRun) {
      const payment = await prisma.onlinePayment.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          reservation: { select: { id: true, referenceCode: true, paymentMethod: true, studentId: true } },
          attempts: { select: { status: true } }
        },
        relationLoadStrategy: "join"
      });
      const baseAction = payment
        ? planOnlinePaymentConversion({
            reservationPaymentMethod: payment.reservation.paymentMethod,
            onlinePaymentStatus: payment.status
          })
        : "KEEP";
      const gate = payment ? classifyConversionAttemptGate(payment.attempts.map((attempt) => attempt.status)) : "CONVERTIBLE";
      const converted = baseAction === "CONVERT_TO_CASH" && gate === "CONVERTIBLE";
      results.push({
        paymentId: id,
        reservationId: payment?.reservation.id ?? "",
        referenceCode: payment?.reservation.referenceCode ?? "",
        studentId: payment?.reservation.studentId ?? null,
        previousPaymentMethod: payment?.reservation.paymentMethod ?? "",
        converted,
        skippedReason: converted
          ? undefined
          : baseAction === "KEEP" ? "not eligible" : `attempts=${gate}`
      });
      continue;
    }
    const result = await convertOpenOnlinePaymentToCash(id);
    if (result.deferredAttemptIds?.length) {
      const attempts = await prisma.onlinePaymentAttempt.findMany({
        where: { id: { in: result.deferredAttemptIds } },
        select: { id: true, status: true, providerCheckoutSessionId: true }
      });
      await expireDeferredConversionAttempts(attempts);
    }
    results.push(result);
  }

  return {
    dryRun: input.dryRun,
    scanned: payments.length,
    converted: results.filter((result) => result.converted).length,
    skipped: results.filter((result) => !result.converted).length,
    results
  };
}
