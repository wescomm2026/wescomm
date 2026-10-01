import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import {
  convertOpenOnlinePaymentToCash,
  runOnlinePaymentCashConversion
} from "../services/online-payment-conversion.service.js";
import { processPaymongoWebhook } from "../services/paymongo-webhook.service.js";
import { HttpError } from "../utils/http-error.js";
import type { NormalizedPaymongoWebhook } from "../utils/paymongo-webhook.js";

const futureIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const providerSessionId = () => `cs_test_${randomUUID().replaceAll("-", "")}`;

async function seedPayment(input: {
  reservationId: string;
  studentId: string;
  referenceCode: string;
  paymentStatus: "INITIALIZING" | "AWAITING_PAYMENT" | "PAID";
  attemptStatus?: "ACTIVE" | "EXPIRED" | "MANUAL_REVIEW_REQUIRED";
}) {
  const paymentId = randomUUID();
  const paidFields = input.paymentStatus === "PAID"
    ? {
        providerCheckoutSessionId: providerSessionId(),
        providerPaymentIntentId: `pi_test_${randomUUID().replaceAll("-", "")}`,
        providerPaymentId: `pay_test_${randomUUID().replaceAll("-", "")}`,
        paidAt: new Date()
      }
    : input.paymentStatus === "AWAITING_PAYMENT"
      ? {
          providerCheckoutSessionId: providerSessionId(),
          checkoutUrl: `https://checkout.paymongo.com/test/${randomUUID()}`,
          checkoutExpiresAt: new Date(futureIso)
        }
      : {};

  await prisma.onlinePayment.create({
    data: {
      id: paymentId,
      reservationId: input.reservationId,
      status: input.paymentStatus,
      amountCentavos: 12500,
      currency: "PHP",
      livemode: false,
      ...paidFields
    }
  });

  if (input.attemptStatus) {
    await prisma.onlinePaymentAttempt.create({
      data: {
        onlinePaymentId: paymentId,
        attemptNumber: 1,
        status: input.attemptStatus,
        providerIdempotencyKey: `conversion-test-${randomUUID()}`,
        requestHash: "a".repeat(64),
        requestPayload: {},
        providerCheckoutSessionId: providerSessionId(),
        checkoutUrl: `https://checkout.paymongo.com/test/${randomUUID()}`,
        checkoutExpiresAt: input.attemptStatus === "ACTIVE" ? new Date(futureIso) : new Date(),
        livemode: false
      }
    });
  }

  return paymentId;
}

async function paidWebhookFor(paymentId: string, providerEventId = `evt_test_${randomUUID().replaceAll("-", "")}`) {
  const payment = await prisma.onlinePayment.findUniqueOrThrow({
    where: { id: paymentId },
    select: {
      id: true,
      amountCentavos: true,
      currency: true,
      reservation: { select: { id: true, referenceCode: true } },
      attempts: {
        orderBy: { attemptNumber: "desc" },
        take: 1,
        select: { id: true, providerCheckoutSessionId: true }
      }
    }
  });
  const attempt = payment.attempts[0];
  if (!attempt?.providerCheckoutSessionId) throw new Error(`Payment ${paymentId} has no provider checkout attempt.`);

  const paymentIntentId = `pi_test_${randomUUID().replaceAll("-", "")}`;
  const providerPaymentId = `pay_test_${randomUUID().replaceAll("-", "")}`;
  const event: NormalizedPaymongoWebhook = {
    providerEventId,
    eventType: "checkout_session.payment.paid",
    livemode: false,
    checkoutSession: {
      id: attempt.providerCheckoutSessionId,
      referenceNumber: payment.reservation.referenceCode,
      metadata: {
        online_payment_attempt_id: attempt.id,
        online_payment_id: payment.id,
        reservation_id: payment.reservation.id
      },
      paymentIntentId,
      payments: [{
        id: providerPaymentId,
        status: "paid",
        amountCentavos: payment.amountCentavos,
        currency: payment.currency,
        feeCentavos: 250,
        netAmountCentavos: payment.amountCentavos - 250,
        paymentIntentId,
        sourceType: "gcash",
        paidAtSeconds: Math.floor(Date.now() / 1000)
      }]
    }
  };

  return {
    event,
    attemptId: attempt.id,
    payloadHash: createHash("sha256").update(JSON.stringify(event)).digest("hex")
  };
}

function isRetryableWebhookConflict(error: unknown) {
  return error instanceof HttpError
    && error.status === 503
    && error.code === "PAYMENT_CONFIRMATION_RETRY";
}

async function processPaidWebhookWithRetry(input: {
  event: NormalizedPaymongoWebhook;
  payloadHash: string;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await processPaymongoWebhook(input);
    } catch (error) {
      if (!isRetryableWebhookConflict(error) || attempt === 2) throw error;
    }
  }
  throw new Error("Payment webhook retry loop ended unexpectedly.");
}

test("PostgreSQL conversion never overwrites a late successful payment", async () => {
  const suffix = randomUUID();
  const studentId = randomUUID();
  const reservationIds = Array.from({ length: 7 }, () => randomUUID());
  const paymentIds: string[] = [];

  try {
    await prisma.profile.create({
      data: { id: studentId, fullName: "Conversion Integrity Student", email: `conversion-student-${suffix}@example.invalid`, role: "STUDENT" }
    });
    await prisma.reservation.createMany({
      data: reservationIds.map((id, index) => ({
        id,
        studentId,
        referenceCode: `CVT-${suffix.slice(0, 8)}-${index + 1}`,
        status: "PENDING" as const,
        paymentMethod: "PAYMONGO_GCASH" as const,
        totalAmount: 125
      }))
    });

    // 1. Unresolved attempt defers conversion: reservation stays online-paid.
    const deferredPaymentId = await seedPayment({
      reservationId: reservationIds[0], studentId, referenceCode: "CVT-DEFERRED", paymentStatus: "AWAITING_PAYMENT", attemptStatus: "ACTIVE"
    });
    paymentIds.push(deferredPaymentId);
    const deferred = await convertOpenOnlinePaymentToCash(deferredPaymentId);
    assert.equal(deferred.converted, false);
    assert.equal(deferred.skippedReason, "PROVIDER_EXPIRY_PENDING");
    assert.ok(deferred.deferredAttemptIds && deferred.deferredAttemptIds.length === 1);
    assert.equal(
      (await prisma.onlinePayment.findUniqueOrThrow({ where: { id: deferredPaymentId }, select: { status: true } })).status,
      "AWAITING_PAYMENT"
    );
    assert.equal(
      (await prisma.onlinePaymentAttempt.findFirstOrThrow({ where: { onlinePaymentId: deferredPaymentId }, select: { status: true } })).status,
      "EXPIRY_REQUESTED"
    );
    assert.equal(
      (await prisma.reservation.findUniqueOrThrow({ where: { id: reservationIds[0] }, select: { paymentMethod: true } })).paymentMethod,
      "PAYMONGO_GCASH"
    );

    // 2. Terminal non-paid attempt converts atomically and idempotently.
    const convertiblePaymentId = await seedPayment({
      reservationId: reservationIds[1], studentId, referenceCode: "CVT-CONVERTED", paymentStatus: "AWAITING_PAYMENT", attemptStatus: "EXPIRED"
    });
    paymentIds.push(convertiblePaymentId);
    const converted = await convertOpenOnlinePaymentToCash(convertiblePaymentId);
    assert.equal(converted.converted, true);
    assert.equal(
      (await prisma.onlinePayment.findUniqueOrThrow({ where: { id: convertiblePaymentId }, select: { status: true } })).status,
      "CANCELLED"
    );
    const convertedReservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservationIds[1] },
      select: { paymentMethod: true, preferredCollectionChannel: true }
    });
    assert.equal(convertedReservation.paymentMethod, "PAY_AT_COMMISSARY");
    assert.equal(convertedReservation.preferredCollectionChannel, "COMMISSARY");
    assert.equal(
      await prisma.outboxEvent.count({ where: { entityId: convertiblePaymentId, type: "ONLINE_PAYMENT_CONVERTED_TO_CASH" } }),
      1
    );

    const replay = await convertOpenOnlinePaymentToCash(convertiblePaymentId);
    assert.equal(replay.converted, false);
    assert.equal(
      await prisma.outboxEvent.count({ where: { entityId: convertiblePaymentId, type: "ONLINE_PAYMENT_CONVERTED_TO_CASH" } }),
      1
    );

    // 3. A paid payment is preserved untouched.
    const paidPaymentId = await seedPayment({
      reservationId: reservationIds[2], studentId, referenceCode: "CVT-PAID", paymentStatus: "PAID"
    });
    paymentIds.push(paidPaymentId);
    const kept = await convertOpenOnlinePaymentToCash(paidPaymentId);
    assert.equal(kept.converted, false);
    assert.equal(
      (await prisma.onlinePayment.findUniqueOrThrow({ where: { id: paidPaymentId }, select: { status: true } })).status,
      "PAID"
    );
    assert.equal(
      (await prisma.reservation.findUniqueOrThrow({ where: { id: reservationIds[2] }, select: { paymentMethod: true } })).paymentMethod,
      "PAYMONGO_GCASH"
    );

    // 4. A real late webhook after conversion records money for staff/refund
    //    review without reverting the cash reservation.
    const latePaymentId = await seedPayment({
      reservationId: reservationIds[3], studentId, referenceCode: "CVT-LATE", paymentStatus: "AWAITING_PAYMENT", attemptStatus: "EXPIRED"
    });
    paymentIds.push(latePaymentId);
    const lateConverted = await convertOpenOnlinePaymentToCash(latePaymentId);
    assert.equal(lateConverted.converted, true);
    const lateWebhook = await paidWebhookFor(latePaymentId);
    const lateProcessed = await processPaidWebhookWithRetry(lateWebhook);
    assert.equal(lateProcessed.acknowledged, true);
    assert.equal(lateProcessed.processed, true);
    assert.equal(lateProcessed.rejected, false);
    assert.equal(
      (await prisma.onlinePayment.findUniqueOrThrow({ where: { id: latePaymentId }, select: { status: true } })).status,
      "REFUND_REVIEW_REQUIRED"
    );
    assert.equal(
      (await prisma.onlinePaymentAttempt.findUniqueOrThrow({ where: { id: lateWebhook.attemptId }, select: { status: true } })).status,
      "PAID"
    );
    assert.equal(
      (await prisma.reservation.findUniqueOrThrow({ where: { id: reservationIds[3] }, select: { paymentMethod: true } })).paymentMethod,
      "PAY_AT_COMMISSARY"
    );
    assert.equal(
      await prisma.auditLog.count({ where: { entityId: latePaymentId, action: "ONLINE_PAYMENT_REFUND_REVIEW_REQUIRED" } }),
      1
    );
    assert.equal(
      await prisma.notification.count({ where: { dedupeKey: `payment-refund-review:${latePaymentId}` } }),
      1
    );
    assert.equal(
      await prisma.paymongoWebhookEvent.count({ where: { onlinePaymentId: latePaymentId, status: "PROCESSED" } }),
      1
    );

    const lateDuplicate = await processPaidWebhookWithRetry(lateWebhook);
    assert.equal(lateDuplicate.duplicate, true);
    assert.equal(
      await prisma.auditLog.count({ where: { entityId: latePaymentId, action: "ONLINE_PAYMENT_REFUND_REVIEW_REQUIRED" } }),
      1
    );

    // 5. Race: conversion vs the real webhook processor. Retry an expected
    //    serializable conflict, then require a terminal paid outcome.
    for (let index = 0; index < 3; index += 1) {
      const racePaymentId = await seedPayment({
        reservationId: reservationIds[4 + index], studentId, referenceCode: `CVT-RACE-${index}`, paymentStatus: "AWAITING_PAYMENT", attemptStatus: "EXPIRED"
      });
      paymentIds.push(racePaymentId);
      const raceWebhook = await paidWebhookFor(racePaymentId);
      const [conversionOutcome, webhookOutcome] = await Promise.allSettled([
        convertOpenOnlinePaymentToCash(racePaymentId),
        processPaymongoWebhook(raceWebhook)
      ]);
      assert.equal(conversionOutcome.status, "fulfilled", "conversion must handle its serialization conflicts internally");

      if (webhookOutcome.status === "rejected") {
        assert.equal(isRetryableWebhookConflict(webhookOutcome.reason), true, "only a retryable webhook conflict is expected");
        const retried = await processPaidWebhookWithRetry(raceWebhook);
        assert.equal(retried.acknowledged, true);
        assert.equal(retried.rejected, false);
      } else {
        assert.equal(webhookOutcome.value.acknowledged, true);
        assert.equal(webhookOutcome.value.rejected, false);
      }

      const payment = await prisma.onlinePayment.findUniqueOrThrow({
        where: { id: racePaymentId },
        select: { status: true }
      });
      const reservation = await prisma.reservation.findUniqueOrThrow({
        where: { id: reservationIds[4 + index] },
        select: { paymentMethod: true }
      });

      if (payment.status === "PAID") {
        assert.equal(reservation.paymentMethod, "PAYMONGO_GCASH", "a paid payment must keep its online-paid reservation");
      } else if (payment.status === "REFUND_REVIEW_REQUIRED") {
        assert.equal(reservation.paymentMethod, "PAY_AT_COMMISSARY", "a cancelled payment must have a cash reservation");
        assert.equal(
          await prisma.outboxEvent.count({ where: { entityId: racePaymentId, type: "ONLINE_PAYMENT_CONVERTED_TO_CASH" } }),
          1
        );
      } else {
        assert.fail(`race must finish as PAID or REFUND_REVIEW_REQUIRED, got ${payment.status}`);
      }
      assert.equal(
        (await prisma.onlinePaymentAttempt.findUniqueOrThrow({ where: { id: raceWebhook.attemptId }, select: { status: true } })).status,
        "PAID"
      );
      assert.equal(
        await prisma.paymongoWebhookEvent.count({ where: { onlinePaymentId: racePaymentId, status: "PROCESSED" } }),
        1
      );
    }
  } finally {
    await prisma.paymongoWebhookEvent.deleteMany({ where: { onlinePaymentId: { in: paymentIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: paymentIds } } });
    await prisma.onlinePaymentAttempt.deleteMany({ where: { onlinePaymentId: { in: paymentIds } } });
    await prisma.onlinePayment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.outboxEvent.deleteMany({ where: { entityId: { in: paymentIds } } });
    await prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } });
    await prisma.profile.deleteMany({ where: { id: studentId } });
  }
});

test("permanent conversion skips cannot starve a later convertible payment", async () => {
  const suffix = randomUUID();
  const studentId = randomUUID();
  const reservationIds = Array.from({ length: 26 }, () => randomUUID());
  const paymentIds: string[] = [];

  try {
    await prisma.profile.create({
      data: {
        id: studentId,
        fullName: "Conversion Batch Student",
        email: `conversion-batch-${suffix}@example.invalid`,
        role: "STUDENT"
      }
    });
    await prisma.reservation.createMany({
      data: reservationIds.map((id, index) => ({
        id,
        studentId,
        referenceCode: `CVB-${suffix.slice(0, 8)}-${index + 1}`,
        status: "PENDING" as const,
        paymentMethod: "PAYMONGO_GCASH" as const,
        totalAmount: 125
      }))
    });

    for (let index = 0; index < 25; index += 1) {
      paymentIds.push(await seedPayment({
        reservationId: reservationIds[index],
        studentId,
        referenceCode: `CVB-BLOCKED-${index + 1}`,
        paymentStatus: "AWAITING_PAYMENT",
        attemptStatus: "MANUAL_REVIEW_REQUIRED"
      }));
    }
    const convertiblePaymentId = await seedPayment({
      reservationId: reservationIds[25],
      studentId,
      referenceCode: "CVB-CONVERTIBLE",
      paymentStatus: "AWAITING_PAYMENT",
      attemptStatus: "EXPIRED"
    });
    paymentIds.push(convertiblePaymentId);

    const run = await runOnlinePaymentCashConversion({ limit: 1, dryRun: true });
    assert.equal(run.scanned, 1);
    assert.equal(run.converted, 1);
    assert.equal(run.results[0]?.paymentId, convertiblePaymentId);
  } finally {
    await prisma.onlinePaymentAttempt.deleteMany({ where: { onlinePaymentId: { in: paymentIds } } });
    await prisma.onlinePayment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } });
    await prisma.profile.deleteMany({ where: { id: studentId } });
  }
});
