import { Prisma, type OnlinePayment, type OnlinePaymentAttempt } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import {
  assertGcashAmountCentavos,
  assertOnlinePaymentTransition,
  canSafelyRecoverPaymongoCreate,
  createProviderIdempotencyKey,
  paymentCanRetry,
  phpDecimalToCentavos
} from "../domain/online-payment.js";
import { prisma } from "../lib/prisma.js";
import type { AppRole } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import {
  buildPaymongoCheckoutRequest,
  createPaymongoCheckoutSessionFromRequest,
  isTrustedPaymongoCheckoutUrl,
  parseStoredPaymongoCheckoutRequest,
  type PaymongoCheckoutLineItem,
  type PaymongoCheckoutRequest
} from "./paymongo-client.js";
import {
  claimStudentReconciliation,
  expireCheckoutAttemptBestEffort,
  quarantineUnknownAttempt,
  reconcileCheckoutAttempt
} from "./paymongo-reconciliation.service.js";

const OPEN_ATTEMPT_STATUSES = ["CREATING", "CREATE_UNKNOWN", "ACTIVE", "EXPIRY_REQUESTED"] as const;

type PreparedCheckout =
  | { kind: "RESUME"; payment: OnlinePayment; attempt: OnlinePaymentAttempt }
  | { kind: "CALL_PROVIDER"; payment: OnlinePayment; attempt: OnlinePaymentAttempt; request: PaymongoCheckoutRequest }
  | { kind: "EXPIRE_FIRST"; payment: OnlinePayment; attempt: OnlinePaymentAttempt }
  | { kind: "QUARANTINE"; payment: OnlinePayment; attempt: OnlinePaymentAttempt };

function assertPaymongoEnabled() {
  if (!env.PAYMONGO_ENABLED || !env.PAYMONGO_SECRET_KEY || !env.PAYMONGO_WEBHOOK_SECRET) {
    throw new HttpError(503, "Online GCash payment is not available.", "PAYMONGO_DISABLED");
  }
}

export function getPaymentOptions() {
  return {
    paymongoGcash: {
      enabled: env.PAYMONGO_ENABLED,
      livemode: env.PAYMONGO_ENABLED && env.PAYMONGO_LIVEMODE
    }
  };
}

export function serializeOnlinePayment(payment: OnlinePayment) {
  const checkoutStillOpen = !payment.checkoutExpiresAt || payment.checkoutExpiresAt > new Date();
  return {
    id: payment.id,
    reservationId: payment.reservationId,
    status: payment.status,
    amountMinor: payment.amountCentavos,
    currency: payment.currency.trim(),
    livemode: payment.livemode,
    canResume: payment.status === "AWAITING_PAYMENT"
      && checkoutStillOpen
      && Boolean(payment.checkoutUrl),
    canRetry: paymentCanRetry(payment.status),
    providerReference: payment.providerPaymentId ?? payment.providerCheckoutSessionId,
    paidAt: payment.paidAt?.toISOString() ?? null,
    checkoutExpiresAt: payment.checkoutExpiresAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString()
  };
}

function assertPaymentMatchesReservation(input: {
  payment: OnlinePayment;
  amountCentavos: number;
}) {
  const { payment, amountCentavos } = input;
  if (
    payment.amountCentavos !== amountCentavos
    || payment.currency.trim() !== "PHP"
    || payment.livemode !== env.PAYMONGO_LIVEMODE
  ) {
    throw new HttpError(
      409,
      "The saved online payment does not match this reservation.",
      "ONLINE_PAYMENT_RECORD_MISMATCH"
    );
  }
}

function assertReservationCanStartCheckout(reservation: {
  studentId: string;
  paymentMethod: string;
  status: string;
}, studentId: string) {
  if (reservation.studentId !== studentId) throw new HttpError(404, "Reservation not found.");
  if (reservation.paymentMethod !== "PAYMONGO_GCASH") {
    throw new HttpError(409, "This reservation is not configured for online GCash payment.", "PAYMENT_METHOD_MISMATCH");
  }
  if (reservation.status !== "PENDING") {
    throw new HttpError(409, "This reservation can no longer start an online payment.", "RESERVATION_NOT_PAYABLE");
  }
}

function buildLineItems(reservation: {
  totalAmount: Prisma.Decimal;
  items: Array<{
    quantity: number;
    unitPrice: Prisma.Decimal;
    product: { name: string };
  }>;
}) {
  const amountCentavos = phpDecimalToCentavos(reservation.totalAmount);
  const lineItems: PaymongoCheckoutLineItem[] = reservation.items.map((item) => ({
    name: item.product.name,
    amountCentavos: phpDecimalToCentavos(item.unitPrice),
    quantity: item.quantity
  }));
  const lineTotal = lineItems.reduce((sum, item) => sum + item.amountCentavos * item.quantity, 0);

  if (
    !lineItems.length
    || lineItems.some((item) => (
      !Number.isSafeInteger(item.amountCentavos)
      || item.amountCentavos <= 0
      || !Number.isSafeInteger(item.quantity)
      || item.quantity <= 0
    ))
    || !Number.isSafeInteger(lineTotal)
    || lineTotal !== amountCentavos
  ) {
    throw new HttpError(
      409,
      "The reservation total could not be verified for online payment.",
      "PAYMENT_TOTAL_MISMATCH"
    );
  }

  assertGcashAmountCentavos(amountCentavos);
  return { amountCentavos, lineItems };
}

function requestHash(request: PaymongoCheckoutRequest) {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

async function prepareCheckoutAttempt(input: {
  reservationId: string;
  studentId: string;
  requestKey: string;
}): Promise<PreparedCheckout> {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: input.reservationId },
      include: {
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            product: { select: { name: true } }
          },
          orderBy: { createdAt: "asc" }
        },
        onlinePayment: true
      }
    });
    if (!reservation) throw new HttpError(404, "Reservation not found.");
    assertReservationCanStartCheckout(reservation, input.studentId);

    const { amountCentavos, lineItems } = buildLineItems(reservation);
    let payment = reservation.onlinePayment;
    if (!payment) {
      payment = await tx.onlinePayment.create({
        data: {
          id: randomUUID(),
          reservationId: reservation.id,
          amountCentavos,
          currency: "PHP",
          livemode: env.PAYMONGO_LIVEMODE
        }
      });
    }
    assertPaymentMatchesReservation({ payment, amountCentavos });
    if (payment.status === "PAID") {
      throw new HttpError(409, "This reservation is already paid.", "ONLINE_PAYMENT_ALREADY_PAID", {
        paymentId: payment.id
      });
    }
    if (!["INITIALIZING", "AWAITING_PAYMENT", "EXPIRED"].includes(payment.status)) {
      throw new HttpError(409, "This online payment can no longer open a checkout session.", "ONLINE_PAYMENT_NOT_RETRYABLE", {
        paymentId: payment.id,
        status: payment.status
      });
    }

    const openAttempt = await tx.onlinePaymentAttempt.findFirst({
      where: { onlinePaymentId: payment.id, status: { in: [...OPEN_ATTEMPT_STATUSES] } },
      orderBy: { attemptNumber: "desc" }
    });
    const now = new Date();
    if (openAttempt?.status === "ACTIVE") {
      if (
        openAttempt.checkoutUrl
        && isTrustedPaymongoCheckoutUrl(openAttempt.checkoutUrl)
        && openAttempt.checkoutExpiresAt
        && openAttempt.checkoutExpiresAt > now
      ) {
        return { kind: "RESUME", payment, attempt: openAttempt };
      }
      const expiring = await tx.onlinePaymentAttempt.update({
        where: { id: openAttempt.id },
        data: { status: "EXPIRY_REQUESTED", expireRequestedAt: openAttempt.expireRequestedAt ?? now }
      });
      return { kind: "EXPIRE_FIRST", payment, attempt: expiring };
    }
    if (openAttempt?.status === "EXPIRY_REQUESTED") {
      return { kind: "EXPIRE_FIRST", payment, attempt: openAttempt };
    }
    if (openAttempt && (openAttempt.status === "CREATING" || openAttempt.status === "CREATE_UNKNOWN")) {
      if (canSafelyRecoverPaymongoCreate(openAttempt.createdAt, now)) {
        return {
          kind: "CALL_PROVIDER",
          payment,
          attempt: openAttempt,
          request: parseStoredPaymongoCheckoutRequest(openAttempt.requestPayload)
        };
      }
      return { kind: "QUARANTINE", payment, attempt: openAttempt };
    }

    const latestAttempt = await tx.onlinePaymentAttempt.findFirst({
      where: { onlinePaymentId: payment.id },
      orderBy: { attemptNumber: "desc" },
      select: { attemptNumber: true }
    });
    const attemptId = randomUUID();
    const attemptNumber = (latestAttempt?.attemptNumber ?? 0) + 1;
    const returnPath = `/student/payments/${encodeURIComponent(payment.id)}`;
    const providerIdempotencyKey = createProviderIdempotencyKey({
      ...input,
      attemptId
    });
    const request = buildPaymongoCheckoutRequest({
      idempotencyKey: providerIdempotencyKey,
      referenceNumber: reservation.referenceCode,
      successUrl: `${env.PAYMONGO_RETURN_ORIGIN}${returnPath}?result=success`,
      cancelUrl: `${env.PAYMONGO_RETURN_ORIGIN}${returnPath}?result=cancelled`,
      metadata: {
        reservation_id: reservation.id,
        online_payment_id: payment.id,
        online_payment_attempt_id: attemptId
      },
      lineItems
    });
    const attempt = await tx.onlinePaymentAttempt.create({
      data: {
        id: attemptId,
        onlinePaymentId: payment.id,
        attemptNumber,
        status: "CREATING",
        providerIdempotencyKey,
        requestHash: requestHash(request),
        requestPayload: request as Prisma.InputJsonValue,
        livemode: env.PAYMONGO_LIVEMODE
      }
    });
    return { kind: "CALL_PROVIDER", payment, attempt, request };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });
}

async function prepareCheckoutAttemptWithConflictRetry(input: {
  reservationId: string;
  studentId: string;
  requestKey: string;
}) {
  try {
    return await prepareCheckoutAttempt(input);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      try {
        return await prepareCheckoutAttempt(input);
      } catch (retryError) {
        if (retryError instanceof HttpError) throw retryError;
        throw new HttpError(503, "Payment setup changed while processing. Please retry.", "PAYMENT_SETUP_RETRY", {
          retryable: true
        });
      }
    }
    throw error;
  }
}

async function markProviderCreateFailure(attemptId: string, error: unknown) {
  const retryable = error instanceof HttpError && error.details?.retryable === true;
  const code = error instanceof HttpError ? error.code ?? "PAYMONGO_CREATE_FAILED" : "PAYMONGO_CREATE_FAILED";
  const partialSessionId = error instanceof HttpError
    && typeof error.details?.providerCheckoutSessionId === "string"
    && /^cs_[A-Za-z0-9_-]+$/.test(error.details.providerCheckoutSessionId)
    ? error.details.providerCheckoutSessionId
    : null;
  if (partialSessionId) {
    await prisma.onlinePaymentAttempt.updateMany({
      where: { id: attemptId, status: { in: ["CREATING", "CREATE_UNKNOWN"] } },
      data: {
        status: "CREATE_UNKNOWN",
        providerCheckoutSessionId: partialSessionId,
        lastProviderErrorCode: code
      }
    });
    return;
  }
  if (retryable) {
    await prisma.onlinePaymentAttempt.updateMany({
      where: { id: attemptId, status: { in: ["CREATING", "CREATE_UNKNOWN"] } },
      data: { status: "CREATE_UNKNOWN", lastProviderErrorCode: code }
    });
    return;
  }

  // A definitive rejection is safe only for an attempt that has never had an
  // ambiguous provider outcome. Once CREATE_UNKNOWN, a later 4xx/auth response
  // does not prove the earlier request failed or that no session exists.
  await prisma.$transaction([
    prisma.onlinePaymentAttempt.updateMany({
      where: { id: attemptId, status: "CREATING" },
      data: { status: "FAILED", lastProviderErrorCode: code }
    }),
    prisma.onlinePaymentAttempt.updateMany({
      where: { id: attemptId, status: "CREATE_UNKNOWN" },
      data: { lastProviderErrorCode: code }
    })
  ]);
}

async function finalizeProviderCheckout(input: {
  paymentId: string;
  attemptId: string;
  session: { id: string; checkoutUrl: string; livemode: boolean };
}) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const attempt = await tx.onlinePaymentAttempt.findUnique({
      where: { id: input.attemptId },
      include: {
        onlinePayment: {
          include: { reservation: { select: { status: true } } }
        }
      }
    });
    if (!attempt || attempt.onlinePaymentId !== input.paymentId) {
      throw new HttpError(409, "Payment attempt changed while processing.", "ONLINE_PAYMENT_ATTEMPT_CONFLICT");
    }
    if (
      attempt.providerCheckoutSessionId
      && attempt.providerCheckoutSessionId !== input.session.id
    ) {
      throw new HttpError(409, "PayMongo returned conflicting checkout sessions.", "ONLINE_PAYMENT_SESSION_CONFLICT");
    }

    const payment = attempt.onlinePayment;
    const checkoutExpiresAt = new Date(
      attempt.createdAt.getTime() + env.PAYMONGO_CHECKOUT_TTL_MINUTES * 60 * 1000
    );
    const closed = payment.reservation.status !== "PENDING"
      || ["CANCELLED", "REFUND_REVIEW_REQUIRED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status);
    const wrongMode = input.session.livemode !== payment.livemode;
    const localExpired = checkoutExpiresAt <= now;
    const attemptAlreadyPaid = attempt.status === "PAID";
    const paidByAnotherAttempt = payment.status === "PAID" && !attemptAlreadyPaid;
    const shouldExpire = !attemptAlreadyPaid && (
      attempt.status === "EXPIRY_REQUESTED"
      || closed
      || wrongMode
      || localExpired
      || paidByAnotherAttempt
    );
    const attemptStatus = attemptAlreadyPaid
      ? "PAID" as const
      : shouldExpire ? "EXPIRY_REQUESTED" as const : "ACTIVE" as const;

    const savedAttempt = await tx.onlinePaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: attemptStatus,
        providerCheckoutSessionId: input.session.id,
        checkoutUrl: input.session.checkoutUrl,
        checkoutExpiresAt,
        providerCreatedAt: attempt.providerCreatedAt ?? attempt.createdAt,
        expireRequestedAt: attemptStatus === "EXPIRY_REQUESTED" ? attempt.expireRequestedAt ?? now : attempt.expireRequestedAt,
        lastProviderErrorCode: null
      }
    });

    let savedPayment = payment;
    if (!attemptAlreadyPaid && !shouldExpire) {
      assertOnlinePaymentTransition(payment.status, "AWAITING_PAYMENT");
      savedPayment = await tx.onlinePayment.update({
        where: { id: payment.id },
        data: {
          status: "AWAITING_PAYMENT",
          providerCheckoutSessionId: input.session.id,
          checkoutUrl: input.session.checkoutUrl,
          checkoutExpiresAt,
          expiredAt: null
        },
        include: { reservation: { select: { status: true } } }
      });
    }
    return {
      payment: savedPayment,
      attempt: savedAttempt,
      shouldExpire: attemptStatus === "EXPIRY_REQUESTED",
      wrongMode,
      closed,
      localExpired,
      paidByAnotherAttempt
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });
}

export async function createOrResumeGcashCheckout(input: {
  reservationId: string;
  studentId: string;
  requestKey: string;
}) {
  assertPaymongoEnabled();

  for (let pass = 0; pass < 2; pass += 1) {
    const prepared = await prepareCheckoutAttemptWithConflictRetry(input);
    if (prepared.kind === "RESUME") {
      if (!prepared.attempt.checkoutUrl || !isTrustedPaymongoCheckoutUrl(prepared.attempt.checkoutUrl)) {
        throw new HttpError(500, "The saved GCash checkout destination is invalid.", "INVALID_CHECKOUT_DESTINATION");
      }
      return { payment: serializeOnlinePayment(prepared.payment), checkoutUrl: prepared.attempt.checkoutUrl };
    }
    if (prepared.kind === "EXPIRE_FIRST") {
      const result = await expireCheckoutAttemptBestEffort(prepared.attempt.id, input.studentId);
      if (result.expired && pass === 0) continue;
      throw new HttpError(409, "The previous GCash checkout is still closing. Please try again shortly.", "PAYMENT_EXPIRY_PENDING", {
        retryable: true,
        paymentId: prepared.payment.id
      });
    }
    if (prepared.kind === "QUARANTINE") {
      await quarantineUnknownAttempt(prepared.attempt.id, input.studentId);
      throw new HttpError(
        409,
        "This unconfirmed GCash checkout needs staff review. Do not submit another online payment.",
        "PAYMENT_ATTEMPT_REVIEW_REQUIRED",
        { paymentId: prepared.payment.id }
      );
    }

    let checkoutSession: Awaited<ReturnType<typeof createPaymongoCheckoutSessionFromRequest>>;
    try {
      checkoutSession = await createPaymongoCheckoutSessionFromRequest({
        idempotencyKey: prepared.attempt.providerIdempotencyKey,
        request: prepared.request
      });
    } catch (error) {
      await markProviderCreateFailure(prepared.attempt.id, error);
      throw error;
    }

    let finalized: Awaited<ReturnType<typeof finalizeProviderCheckout>>;
    try {
      finalized = await finalizeProviderCheckout({
        paymentId: prepared.payment.id,
        attemptId: prepared.attempt.id,
        session: checkoutSession
      });
    } catch (error) {
      // A successful provider response must never be silently discarded. If a
      // database race prevents persistence, reconciliation can recover only if
      // the provider call is retried with this same, still-valid key.
      await markProviderCreateFailure(prepared.attempt.id, new HttpError(
        503,
        "The checkout was created but could not be saved yet.",
        "CHECKOUT_PERSISTENCE_RETRY",
        { retryable: true }
      ));
      throw error;
    }

    if (finalized.shouldExpire) {
      await expireCheckoutAttemptBestEffort(finalized.attempt.id, input.studentId);
    }
    if (finalized.localExpired) {
      throw new HttpError(409, "This GCash checkout hold expired before it could be resumed.", "PAYMENT_HOLD_EXPIRED", {
        paymentId: finalized.payment.id
      });
    }
    if (finalized.wrongMode) {
      throw new HttpError(502, "GCash checkout returned the wrong payment mode.", "PAYMONGO_MODE_MISMATCH");
    }
    if (finalized.closed) {
      throw new HttpError(409, "This reservation can no longer start an online payment.", "RESERVATION_NOT_PAYABLE");
    }
    if (finalized.payment.status === "PAID" || finalized.paidByAnotherAttempt) {
      throw new HttpError(409, "This reservation is already paid.", "ONLINE_PAYMENT_ALREADY_PAID", {
        paymentId: finalized.payment.id
      });
    }
    if (!finalized.attempt.checkoutUrl || !isTrustedPaymongoCheckoutUrl(finalized.attempt.checkoutUrl)) {
      throw new HttpError(502, "GCash checkout returned an invalid destination.", "INVALID_CHECKOUT_DESTINATION");
    }
    return {
      payment: serializeOnlinePayment(finalized.payment),
      checkoutUrl: finalized.attempt.checkoutUrl
    };
  }

  throw new HttpError(503, "GCash checkout could not be prepared. Please retry.", "PAYMENT_SETUP_RETRY", {
    retryable: true
  });
}

async function loadAccessibleOnlinePayment(input: {
  paymentId: string;
  userId: string;
  role: AppRole;
}) {
  const payment = await prisma.onlinePayment.findUnique({
    where: { id: input.paymentId },
    include: { reservation: { select: { studentId: true } } }
  });
  if (!payment || (input.role === "STUDENT" && payment.reservation.studentId !== input.userId)) {
    throw new HttpError(404, "Online payment not found.");
  }
  return payment;
}

export async function getOnlinePaymentById(input: {
  paymentId: string;
  userId: string;
  role: AppRole;
}) {
  let payment = await loadAccessibleOnlinePayment(input);
  if (input.role === "STUDENT" && env.PAYMONGO_SECRET_KEY) {
    const attemptId = await claimStudentReconciliation(payment.id);
    if (attemptId) {
      try {
        await reconcileCheckoutAttempt(attemptId);
        payment = await loadAccessibleOnlinePayment(input);
      } catch (error) {
        console.warn("Student payment reconciliation skipped:", error instanceof Error ? error.message : error);
      }
    }
  }
  return serializeOnlinePayment(payment);
}
