import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http-error.js";

export const PAYMONGO_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

type UnknownRecord = Record<string, unknown>;

export type NormalizedPaymongoPayment = {
  id: string;
  status: string;
  amountCentavos: number;
  currency: string;
  feeCentavos: number | null;
  netAmountCentavos: number | null;
  paymentIntentId: string | null;
  sourceType: string | null;
  paidAtSeconds: number | null;
};

export type NormalizedPaymongoCheckoutSession = {
  id: string;
  referenceNumber: string | null;
  metadata: Record<string, string>;
  paymentIntentId: string | null;
  payments: NormalizedPaymongoPayment[];
};

export type NormalizedPaymongoWebhook = {
  providerEventId: string | null;
  eventType: string;
  livemode: boolean;
  checkoutSession: NormalizedPaymongoCheckoutSession | null;
};

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integerValue(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function unixSecondsValue(value: unknown) {
  const integer = integerValue(value);
  if (integer !== null && integer > 0) return integer;
  if (typeof value !== "string") return null;

  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? Math.floor(milliseconds / 1000)
    : null;
}

function invalidWebhookPayload(): never {
  throw new HttpError(400, "PayMongo webhook payload is invalid.", "INVALID_PAYMONGO_WEBHOOK");
}

function optionalIntegerField(source: UnknownRecord, field: string) {
  if (!(field in source) || source[field] === null) return null;
  const parsed = integerValue(source[field]);
  return parsed === null ? invalidWebhookPayload() : parsed;
}

function optionalUnixSecondsField(source: UnknownRecord, field: string) {
  if (!(field in source) || source[field] === null) return null;
  const parsed = unixSecondsValue(source[field]);
  return parsed === null ? invalidWebhookPayload() : parsed;
}

function eventIdValue(value: unknown) {
  const id = stringValue(value);
  return id?.startsWith("evt_") ? id : null;
}

function stringMetadata(value: unknown) {
  const source = record(value);
  if (!source) return {};
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function normalizePayment(value: unknown): NormalizedPaymongoPayment {
  const payment = record(value);
  const attributes = record(payment?.attributes);
  const id = stringValue(payment?.id);
  const status = stringValue(attributes?.status);
  const amountCentavos = integerValue(attributes?.amount);
  const currency = stringValue(attributes?.currency);
  if (!payment || !attributes || !id || !status || amountCentavos === null || !currency) {
    return invalidWebhookPayload();
  }

  const source = record(attributes?.source);
  return {
    id,
    status,
    amountCentavos,
    currency,
    feeCentavos: optionalIntegerField(attributes, "fee"),
    netAmountCentavos: optionalIntegerField(attributes, "net_amount"),
    paymentIntentId: stringValue(attributes?.payment_intent_id),
    sourceType: stringValue(source?.type),
    paidAtSeconds: optionalUnixSecondsField(attributes, "paid_at")
  };
}

function normalizeCheckoutSession(value: unknown): NormalizedPaymongoCheckoutSession | null {
  const checkoutSession = record(value);
  const attributes = record(checkoutSession?.attributes);
  const id = stringValue(checkoutSession?.id);
  if (!id || !attributes) return null;

  const paymentIntent = record(attributes.payment_intent);
  let payments: NormalizedPaymongoPayment[] = [];
  if ("payments" in attributes) {
    if (!Array.isArray(attributes.payments)) return invalidWebhookPayload();
    payments = attributes.payments.map(normalizePayment);
  }

  return {
    id,
    referenceNumber: stringValue(attributes.reference_number),
    metadata: stringMetadata(attributes.metadata),
    paymentIntentId: stringValue(paymentIntent?.id),
    payments
  };
}

export function normalizePaymongoWebhookPayload(payload: unknown): NormalizedPaymongoWebhook {
  const root = record(payload);
  const topData = record(root?.data);
  if (!root || !topData) {
    throw new HttpError(400, "PayMongo webhook payload is invalid.", "INVALID_PAYMONGO_WEBHOOK");
  }

  // Current Hosted Checkout v2 delivery envelope documented by PayMongo.
  if (root.event_type === "send.webhook") {
    const eventType = stringValue(topData.type);
    if (!eventType || typeof topData.livemode !== "boolean") {
      throw new HttpError(400, "PayMongo webhook envelope is invalid.", "INVALID_PAYMONGO_WEBHOOK");
    }

    return {
      providerEventId: eventIdValue(root.id) ?? eventIdValue(topData.id),
      eventType,
      livemode: topData.livemode,
      checkoutSession: normalizeCheckoutSession(topData.data)
    };
  }

  // Generic event envelope still used by other PayMongo webhook examples.
  const attributes = record(topData.attributes);
  const eventType = stringValue(attributes?.type);
  if (!eventType || typeof attributes?.livemode !== "boolean") {
    throw new HttpError(400, "PayMongo webhook envelope is invalid.", "INVALID_PAYMONGO_WEBHOOK");
  }

  return {
    providerEventId: eventIdValue(topData.id),
    eventType,
    livemode: attributes.livemode,
    checkoutSession: normalizeCheckoutSession(attributes.data)
  };
}

function parseSignatureHeader(header: string) {
  const parts = new Map<string, string>();
  for (const component of header.split(",")) {
    const separator = component.indexOf("=");
    if (separator <= 0) continue;
    parts.set(component.slice(0, separator).trim(), component.slice(separator + 1).trim());
  }
  return parts;
}

export function verifyPaymongoWebhookSignature(input: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  webhookSecret: string;
  livemode: boolean;
  now?: Date;
  toleranceSeconds?: number;
}) {
  if (!input.signatureHeader) {
    throw new HttpError(401, "PayMongo webhook signature is missing.", "INVALID_PAYMONGO_SIGNATURE");
  }

  const parts = parseSignatureHeader(input.signatureHeader);
  const timestampText = parts.get("t") ?? "";
  const timestamp = Number(timestampText);
  const suppliedSignature = parts.get(input.livemode ? "li" : "te") ?? "";
  if (!/^\d+$/.test(timestampText) || !/^[0-9a-f]{64}$/i.test(suppliedSignature)) {
    throw new HttpError(401, "PayMongo webhook signature is invalid.", "INVALID_PAYMONGO_SIGNATURE");
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const tolerance = input.toleranceSeconds ?? PAYMONGO_WEBHOOK_TOLERANCE_SECONDS;
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > tolerance) {
    throw new HttpError(401, "PayMongo webhook timestamp is outside the allowed window.", "STALE_PAYMONGO_WEBHOOK");
  }

  const expectedHex = createHmac("sha256", input.webhookSecret)
    .update(`${timestampText}.`)
    .update(input.rawBody)
    .digest("hex");
  const supplied = Buffer.from(suppliedSignature, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new HttpError(401, "PayMongo webhook signature is invalid.", "INVALID_PAYMONGO_SIGNATURE");
  }
}

export function hashPaymongoPayload(rawBody: Buffer) {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function paymongoWebhookDedupeKey(providerEventId: string | null, payloadHash: string) {
  return providerEventId ? `event:${providerEventId}` : `payload:${payloadHash}`;
}
