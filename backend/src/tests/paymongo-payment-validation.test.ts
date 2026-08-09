import assert from "node:assert/strict";
import test from "node:test";
import {
  validateRecognizedPaidCheckout,
  type PersistedCheckoutAttempt,
  type RecognizedOnlinePayment
} from "../domain/paymongo-payment-validation.js";

const now = new Date("2026-08-01T04:00:00.000Z");
const onlinePayment: RecognizedOnlinePayment = {
  id: "22222222-2222-4222-8222-222222222222",
  status: "AWAITING_PAYMENT",
  amountCentavos: 10_000,
  currency: "PHP",
  livemode: false,
  providerPaymentIntentId: null,
  providerPaymentId: null,
  paidAt: null,
  createdAt: new Date("2026-08-01T03:30:00.000Z"),
  reservation: {
    id: "11111111-1111-4111-8111-111111111111",
    studentId: "44444444-4444-4444-8444-444444444444",
    referenceCode: "WES-2026-ABC123",
    paymentMethod: "PAYMONGO_GCASH",
    status: "PENDING"
  }
};
const attempt: PersistedCheckoutAttempt = {
  id: "33333333-3333-4333-8333-333333333333",
  onlinePaymentId: onlinePayment.id,
  providerCheckoutSessionId: "cs_older_persisted_attempt",
  providerPaymentIntentId: null,
  providerPaymentId: null,
  livemode: false,
  createdAt: new Date("2026-08-01T03:45:00.000Z")
};

function checkout(feeCentavos: number | null, netAmountCentavos: number | null) {
  return {
    id: "cs_older_persisted_attempt",
    referenceNumber: "WES-2026-ABC123",
    metadata: {
      reservation_id: onlinePayment.reservation.id,
      online_payment_id: onlinePayment.id,
      online_payment_attempt_id: attempt.id
    },
    paymentIntentId: "pi_valid_attempt",
    payments: [{
      id: "pay_valid_attempt",
      status: "paid",
      amountCentavos: 10_000,
      currency: "PHP",
      feeCentavos,
      netAmountCentavos,
      paymentIntentId: "pi_valid_attempt",
      sourceType: "gcash",
      paidAtSeconds: Math.floor(now.getTime() / 1000)
    }]
  };
}

test("a paid session from any persisted attempt is accepted after authoritative identity checks", () => {
  const result = validateRecognizedPaidCheckout({
    checkoutSession: checkout(150, 9_800),
    providerLivemode: false,
    onlinePayment,
    attempt,
    receivedAt: now
  });
  assert.equal(result.valid, true);
});

test("PayMongo fee and net values are independently range-checked without assuming they sum to amount", () => {
  const legitimateDifferentTotal = validateRecognizedPaidCheckout({
    checkoutSession: checkout(150, 9_800),
    providerLivemode: false,
    onlinePayment,
    attempt,
    receivedAt: now
  });
  assert.equal(legitimateDifferentTotal.valid, true);

  const invalidFee = validateRecognizedPaidCheckout({
    checkoutSession: checkout(10_001, 9_800),
    providerLivemode: false,
    onlinePayment,
    attempt,
    receivedAt: now
  });
  assert.deepEqual(invalidFee, { valid: false, reasonCode: "INVALID_PAYMENT_FEE" });
});

test("a provider session cannot be reassigned to a different persisted attempt", () => {
  const result = validateRecognizedPaidCheckout({
    checkoutSession: checkout(null, null),
    providerLivemode: false,
    onlinePayment,
    attempt: { ...attempt, providerCheckoutSessionId: "cs_some_other_session" },
    receivedAt: now
  });
  assert.deepEqual(result, { valid: false, reasonCode: "CHECKOUT_ATTEMPT_MISMATCH" });
});
