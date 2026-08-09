import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  hashPaymongoPayload,
  normalizePaymongoWebhookPayload,
  paymongoWebhookDedupeKey,
  PAYMONGO_WEBHOOK_TOLERANCE_SECONDS,
  verifyPaymongoWebhookSignature
} from "../utils/paymongo-webhook.js";
import { HttpError } from "../utils/http-error.js";

const webhookSecret = "whsec_test_wescomm_123456789";
const timestamp = 1_750_000_000;
const now = new Date(timestamp * 1_000);

function signatureFor(rawBody: Buffer, mode: "te" | "li", time = timestamp) {
  const signature = createHmac("sha256", webhookSecret)
    .update(`${time}.`)
    .update(rawBody)
    .digest("hex");
  return `t=${time},${mode}=${signature}`;
}

function hasHttpError(status: number, code: string) {
  return (error: unknown) => (
    error instanceof HttpError && error.status === status && error.code === code
  );
}

function checkoutSessionResource() {
  return {
    id: "cs_test_wescomm",
    type: "checkout_session",
    attributes: {
      reference_number: "WES-2026-0001",
      metadata: {
        reservation_id: "reservation-id",
        online_payment_id: "online-payment-id",
        ignored_number: 123
      },
      payment_intent: { id: "pi_test_wescomm" },
      payments: [
        {
          id: "pay_test_wescomm",
          type: "payment",
          attributes: {
            status: "paid",
            amount: 12_345,
            currency: "PHP",
            fee: 275,
            net_amount: 12_070,
            payment_intent_id: "pi_test_wescomm",
            paid_at: 1_750_000_001,
            source: { type: "gcash" }
          }
        }
      ]
    }
  };
}

test("current Hosted Checkout webhook envelopes normalize to the minimal payment contract", () => {
  const normalized = normalizePaymongoWebhookPayload({
    event_type: "send.webhook",
    data: {
      id: "evt_test_wescomm",
      type: "checkout_session.payment.paid",
      resource: "checkout_session",
      livemode: false,
      data: checkoutSessionResource()
    }
  });

  assert.deepEqual(normalized, {
    providerEventId: "evt_test_wescomm",
    eventType: "checkout_session.payment.paid",
    livemode: false,
    checkoutSession: {
      id: "cs_test_wescomm",
      referenceNumber: "WES-2026-0001",
      metadata: {
        reservation_id: "reservation-id",
        online_payment_id: "online-payment-id"
      },
      paymentIntentId: "pi_test_wescomm",
      payments: [{
        id: "pay_test_wescomm",
        status: "paid",
        amountCentavos: 12_345,
        currency: "PHP",
        feeCentavos: 275,
        netAmountCentavos: 12_070,
        paymentIntentId: "pi_test_wescomm",
        sourceType: "gcash",
        paidAtSeconds: 1_750_000_001
      }]
    }
  });
});

test("generic PayMongo event envelopes normalize without depending on raw PII", () => {
  const normalized = normalizePaymongoWebhookPayload({
    data: {
      id: "evt_generic_wescomm",
      type: "event",
      attributes: {
        type: "checkout_session.payment.paid",
        livemode: true,
        data: checkoutSessionResource()
      }
    }
  });

  assert.equal(normalized.providerEventId, "evt_generic_wescomm");
  assert.equal(normalized.eventType, "checkout_session.payment.paid");
  assert.equal(normalized.livemode, true);
  assert.equal(normalized.checkoutSession?.id, "cs_test_wescomm");
  assert.equal(normalized.checkoutSession?.payments[0]?.sourceType, "gcash");
});

test("malformed envelopes and malformed payment records fail closed", () => {
  assert.throws(
    () => normalizePaymongoWebhookPayload(null),
    hasHttpError(400, "INVALID_PAYMONGO_WEBHOOK")
  );
  assert.throws(
    () => normalizePaymongoWebhookPayload({ event_type: "send.webhook", data: { livemode: false } }),
    hasHttpError(400, "INVALID_PAYMONGO_WEBHOOK")
  );

  const resource = checkoutSessionResource();
  resource.attributes.payments[0]!.attributes.amount = 12_345.67;
  assert.throws(
    () => normalizePaymongoWebhookPayload({
      event_type: "send.webhook",
      data: {
        type: "checkout_session.payment.paid",
        livemode: false,
        data: resource
      }
    }),
    hasHttpError(400, "INVALID_PAYMONGO_WEBHOOK")
  );

  for (const [field, value] of [
    ["fee", "275"],
    ["net_amount", 12_070.5],
    ["paid_at", "not-a-date"]
  ] as const) {
    const malformed = checkoutSessionResource();
    malformed.attributes.payments[0]!.attributes[field] = value as never;
    assert.throws(
      () => normalizePaymongoWebhookPayload({
        event_type: "send.webhook",
        data: {
          type: "checkout_session.payment.paid",
          livemode: false,
          data: malformed
        }
      }),
      hasHttpError(400, "INVALID_PAYMONGO_WEBHOOK"),
      field
    );
  }
});

test("test-mode signatures bind the exact raw bytes and accepted timestamp", () => {
  const rawBody = Buffer.from('{"amount":12345,"currency":"PHP"}', "utf8");
  const signatureHeader = `${signatureFor(rawBody, "te")},li=${"0".repeat(64)}`;

  assert.doesNotThrow(() => verifyPaymongoWebhookSignature({
    rawBody,
    signatureHeader,
    webhookSecret,
    livemode: false,
    now
  }));

  assert.throws(
    () => verifyPaymongoWebhookSignature({
      rawBody: Buffer.from('{"currency":"PHP","amount":12345}', "utf8"),
      signatureHeader,
      webhookSecret,
      livemode: false,
      now
    }),
    hasHttpError(401, "INVALID_PAYMONGO_SIGNATURE")
  );
});

test("live mode verifies li and never falls back to the test signature", () => {
  const rawBody = Buffer.from("{}", "utf8");

  assert.doesNotThrow(() => verifyPaymongoWebhookSignature({
    rawBody,
    signatureHeader: signatureFor(rawBody, "li"),
    webhookSecret,
    livemode: true,
    now
  }));

  assert.throws(
    () => verifyPaymongoWebhookSignature({
      rawBody,
      signatureHeader: signatureFor(rawBody, "te"),
      webhookSecret,
      livemode: true,
      now
    }),
    hasHttpError(401, "INVALID_PAYMONGO_SIGNATURE")
  );
});

test("missing, malformed, and stale webhook signatures are rejected", () => {
  const rawBody = Buffer.from("{}", "utf8");

  assert.throws(
    () => verifyPaymongoWebhookSignature({ rawBody, signatureHeader: undefined, webhookSecret, livemode: false, now }),
    hasHttpError(401, "INVALID_PAYMONGO_SIGNATURE")
  );
  assert.throws(
    () => verifyPaymongoWebhookSignature({ rawBody, signatureHeader: "t=abc,te=bad", webhookSecret, livemode: false, now }),
    hasHttpError(401, "INVALID_PAYMONGO_SIGNATURE")
  );

  const staleTime = timestamp - PAYMONGO_WEBHOOK_TOLERANCE_SECONDS - 1;
  assert.throws(
    () => verifyPaymongoWebhookSignature({
      rawBody,
      signatureHeader: signatureFor(rawBody, "te", staleTime),
      webhookSecret,
      livemode: false,
      now
    }),
    hasHttpError(401, "STALE_PAYMONGO_WEBHOOK")
  );

  const boundaryTime = timestamp - PAYMONGO_WEBHOOK_TOLERANCE_SECONDS;
  assert.doesNotThrow(() => verifyPaymongoWebhookSignature({
    rawBody,
    signatureHeader: signatureFor(rawBody, "te", boundaryTime),
    webhookSecret,
    livemode: false,
    now
  }));
});

test("payload hashes and webhook dedupe keys are deterministic and PII-free", () => {
  const rawBody = Buffer.from('{"customer_email":"student@wesleyan.edu.ph"}', "utf8");
  const payloadHash = hashPaymongoPayload(rawBody);

  assert.match(payloadHash, /^[0-9a-f]{64}$/);
  assert.equal(payloadHash, hashPaymongoPayload(rawBody));
  assert.equal(payloadHash.includes("student@wesleyan.edu.ph"), false);
  assert.equal(paymongoWebhookDedupeKey("evt_123", payloadHash), "event:evt_123");
  assert.equal(paymongoWebhookDedupeKey(null, payloadHash), `payload:${payloadHash}`);
});
