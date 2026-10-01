import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { HttpError } from "../utils/http-error.js";
import {
  createReservationSchema,
  updateStatusSchema
} from "../domain/reservation-checkout-schemas.js";
import { getPaymentOptions, createOrResumeGcashCheckout } from "../services/payment.service.js";
import {
  planOnlinePaymentConversion,
  classifyConversionAttemptGate,
  ONLINE_PAYMENT_CONVERSION_STATUSES
} from "../services/online-payment-conversion.service.js";
import { validateRecognizedCheckoutIdentity } from "../domain/paymongo-payment-validation.js";
import { classifyReportPaymentRevenue } from "../domain/report-payment-classification.js";

function hasHttpError(status: number, code: string) {
  return (error: unknown) => (
    error instanceof HttpError && error.status === status && error.code === code
  );
}

function validReservationPayload(overrides: Record<string, unknown> = {}) {
  return {
    preferredCollectionChannel: "COMMISSARY",
    pickupDate: "2026-09-28",
    pickupSlotId: "11111111-1111-4111-8111-111111111111",
    pickupPolicyVersion: 1,
    items: [{ productId: "22222222-2222-4222-8222-222222222222", quantity: 1 }],
    ...overrides
  };
}

test("student reservations accept cash only and reject GCash/e-wallet values", () => {
  assert.equal(createReservationSchema.parse(validReservationPayload()).paymentMethod, "PAY_AT_COMMISSARY");
  assert.equal(
    createReservationSchema.parse(validReservationPayload({ paymentMethod: "PAY_AT_COMMISSARY" })).paymentMethod,
    "PAY_AT_COMMISSARY"
  );

  for (const rejected of ["PAYMONGO_GCASH", "E_WALLET_AT_PICKUP", "GCASH", "OTHER"]) {
    assert.throws(
      () => createReservationSchema.parse(validReservationPayload({ paymentMethod: rejected })),
      z.ZodError,
      `expected ${rejected} to be rejected`
    );
  }
});

test("both Commissary and Treasury collection channels are accepted at checkout", () => {
  assert.equal(
    createReservationSchema.parse(validReservationPayload({ preferredCollectionChannel: "COMMISSARY" })).preferredCollectionChannel,
    "COMMISSARY"
  );
  assert.equal(
    createReservationSchema.parse(validReservationPayload({ preferredCollectionChannel: "TREASURER" })).preferredCollectionChannel,
    "TREASURER"
  );
  assert.throws(
    () => createReservationSchema.parse(validReservationPayload({ preferredCollectionChannel: "GCASH" })),
    z.ZodError
  );
});

test("staff settlement accepts only CASH and records the collection channel", () => {
  const parsed = updateStatusSchema.parse({
    status: "COMPLETED",
    settlement: { paymentMethod: "CASH", collectionChannel: "TREASURER", officialReceiptNumber: "OR-102938" }
  });
  assert.equal(parsed.settlement?.paymentMethod, "CASH");
  assert.equal(parsed.settlement?.collectionChannel, "TREASURER");

  for (const rejected of ["GCASH", "OTHER", "PAYMONGO_GCASH"]) {
    assert.throws(
      () => updateStatusSchema.parse({
        status: "COMPLETED",
        settlement: { paymentMethod: rejected, collectionChannel: "COMMISSARY" }
      }),
      z.ZodError,
      `expected ${rejected} to be rejected`
    );
  }
});

test("reports separate current cash by channel from legacy counter and PayMongo payments", () => {
  const classified = classifyReportPaymentRevenue({
    methodGroups: [
      { method: "CASH", amount: "300", count: 2 },
      { method: "GCASH", amount: "75", count: 1 },
      { method: "PAYMONGO_GCASH", amount: "50", count: 1 }
    ],
    cashChannelGroups: [
      { channel: "COMMISSARY", amount: "100", count: 1 },
      { channel: "TREASURER", amount: "200", count: 1 }
    ]
  });

  assert.deepEqual(classified.cash, { amount: 300, payments: 2 });
  assert.deepEqual(classified.commissaryCash, { amount: 100, payments: 1 });
  assert.deepEqual(classified.treasuryCash, { amount: 200, payments: 1 });
  assert.deepEqual(classified.legacyInPerson, { amount: 75, payments: 1 });
  assert.deepEqual(classified.legacyOnline, { amount: 50, payments: 1 });
  assert.deepEqual(classified.inPerson, { amount: 375, payments: 3 });
});

test("payment options report cash-only with PayMongo GCash disabled", () => {
  const options = getPaymentOptions();
  assert.equal(options.cashOnly, true);
  assert.deepEqual(options.collectionChannels, ["COMMISSARY", "TREASURER"]);
  assert.equal(options.paymongoGcash.enabled, false);
  assert.equal(options.paymongoGcash.historicalOnly, true);
});

test("GCash checkout creation is discontinued with a stable error code", async () => {
  await assert.rejects(
    () => createOrResumeGcashCheckout({
      reservationId: "11111111-1111-4111-8111-111111111111",
      studentId: "22222222-2222-4222-8222-222222222222",
      requestKey: "browser-request-key"
    }),
    hasHttpError(410, "ONLINE_PAYMENTS_DISCONTINUED")
  );
});

test("open online payments convert to cash; paid and refund-related payments are preserved", () => {
  assert.deepEqual(ONLINE_PAYMENT_CONVERSION_STATUSES, ["INITIALIZING", "AWAITING_PAYMENT", "EXPIRED"]);

  for (const status of ONLINE_PAYMENT_CONVERSION_STATUSES) {
    assert.equal(planOnlinePaymentConversion({
      reservationPaymentMethod: "PAYMONGO_GCASH",
      onlinePaymentStatus: status
    }), "CONVERT_TO_CASH");
  }

  for (const status of ["PAID", "REFUND_REVIEW_REQUIRED", "PARTIALLY_REFUNDED", "REFUNDED", "CANCELLED"]) {
    assert.equal(planOnlinePaymentConversion({
      reservationPaymentMethod: "PAYMONGO_GCASH",
      onlinePaymentStatus: status
    }), "KEEP", `expected ${status} to be preserved`);
  }

  assert.equal(planOnlinePaymentConversion({
    reservationPaymentMethod: "PAY_AT_COMMISSARY",
    onlinePaymentStatus: "AWAITING_PAYMENT"
  }), "KEEP");
  assert.equal(planOnlinePaymentConversion({
    reservationPaymentMethod: "PAYMONGO_GCASH",
    onlinePaymentStatus: null
  }), "KEEP");
});

test("conversion defers on unresolved attempts and preserves paid or reviewed ones", () => {
  assert.equal(classifyConversionAttemptGate([]), "CONVERTIBLE");
  assert.equal(classifyConversionAttemptGate(["EXPIRED", "FAILED", "ABANDONED"]), "CONVERTIBLE");
  assert.equal(classifyConversionAttemptGate(["PAID", "EXPIRED"]), "PAID_ATTEMPT");
  assert.equal(classifyConversionAttemptGate(["MANUAL_REVIEW_REQUIRED"]), "MANUAL_REVIEW");
  assert.equal(classifyConversionAttemptGate(["ACTIVE"]), "UNRESOLVED_ATTEMPT");
  assert.equal(classifyConversionAttemptGate(["CREATING"]), "UNRESOLVED_ATTEMPT");
  assert.equal(classifyConversionAttemptGate(["CREATE_UNKNOWN"]), "UNRESOLVED_ATTEMPT");
  assert.equal(classifyConversionAttemptGate(["EXPIRY_REQUESTED", "FAILED"]), "UNRESOLVED_ATTEMPT");
});

test("late paid confirmations on converted reservations are accepted for refund review", () => {
  const attemptId = "11111111-1111-4111-8111-111111111111";
  const paymentId = "22222222-2222-4222-8222-222222222222";
  const reservationId = "33333333-3333-4333-8333-333333333333";
  const checkoutSession = {
    id: "cs_test_late",
    referenceNumber: "RSV-OLD",
    metadata: {
      online_payment_attempt_id: attemptId,
      online_payment_id: paymentId,
      reservation_id: reservationId
    },
    paymentIntentId: null,
    payments: []
  };
  const attempt = {
    id: attemptId,
    onlinePaymentId: paymentId,
    providerCheckoutSessionId: "cs_test_late",
    providerPaymentIntentId: null,
    providerPaymentId: null,
    livemode: false,
    createdAt: new Date("2026-08-01T00:00:00.000Z")
  };
  const onlinePayment = {
    id: paymentId,
    status: "CANCELLED" as const,
    amountCentavos: 12500,
    currency: "PHP",
    livemode: false,
    providerPaymentIntentId: null,
    providerPaymentId: null,
    paidAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    reservation: {
      id: reservationId,
      studentId: "44444444-4444-4444-8444-444444444444",
      referenceCode: "RSV-OLD",
      paymentMethod: "PAY_AT_COMMISSARY",
      status: "PENDING"
    }
  };

  assert.deepEqual(validateRecognizedCheckoutIdentity({
    checkoutSession,
    providerLivemode: false,
    onlinePayment,
    attempt
  }), { valid: true });

  assert.deepEqual(validateRecognizedCheckoutIdentity({
    checkoutSession,
    providerLivemode: false,
    onlinePayment: { ...onlinePayment, status: "AWAITING_PAYMENT" },
    attempt
  }), { valid: false, reasonCode: "PAYMENT_METHOD_MISMATCH" });
});

test("WesBot knowledge states the cash-only policy and keeps historical GCash context", () => {
  const knowledge = readFileSync(path.resolve(process.cwd(), "src/domain/wesbot-knowledge.ts"), "utf8");
  assert.match(knowledge, /accepts cash only for new reservations/);
  assert.match(knowledge, /Commissary or at the Treasury/);
  assert.match(knowledge, /Historical online GCash payments remain visible/);

  const service = readFileSync(path.resolve(process.cwd(), "src/services/wesbot.service.ts"), "utf8");
  assert.match(service, /label: "Payment status"/);
  assert.doesNotMatch(service, /label: "GCash payment"/);

  const classifier = readFileSync(path.resolve(process.cwd(), "src/services/wesbot-classifier.service.ts"), "utf8");
  assert.match(classifier, /including historical online GCash transactions/);
});
