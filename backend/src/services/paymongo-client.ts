import { z } from "zod";
import { env } from "../config/env.js";
import type {
  NormalizedPaymongoCheckoutSession,
  NormalizedPaymongoPayment
} from "../utils/paymongo-webhook.js";
import { HttpError } from "../utils/http-error.js";

const PAYMONGO_CREATE_CHECKOUT_URL = "https://api.paymongo.com/v2/checkout_sessions";
const PAYMONGO_CHECKOUT_V1_URL = "https://api.paymongo.com/v1/checkout_sessions";
const PAYMONGO_CHECKOUT_HOST = "checkout.paymongo.com";
const PAYMONGO_REQUEST_TIMEOUT_MS = 10_000;

export type PaymongoCheckoutLineItem = {
  name: string;
  amountCentavos: number;
  quantity: number;
};

export type CreatePaymongoCheckoutInput = {
  idempotencyKey: string;
  referenceNumber: string;
  successUrl: string;
  cancelUrl: string;
  metadata: {
    reservation_id: string;
    online_payment_id: string;
    online_payment_attempt_id: string;
  };
  lineItems: PaymongoCheckoutLineItem[];
};

export type PaymongoCheckoutSession = {
  id: string;
  checkoutUrl: string;
  livemode: boolean;
};

export type RetrievedPaymongoCheckoutSession = NormalizedPaymongoCheckoutSession & {
  status: "active" | "expired";
  checkoutUrl: string;
  livemode: boolean;
  createdAtSeconds: number | null;
};

type PaymongoOperation = "create" | "get" | "expire";

const checkoutRequestSchema = z.object({
  data: z.object({
    attributes: z.object({
      line_items: z.array(z.object({
        name: z.string().min(1).max(127),
        amount: z.number().int().positive(),
        currency: z.literal("PHP"),
        quantity: z.number().int().positive()
      }).strict()).min(1),
      payment_method_types: z.tuple([z.literal("gcash")]),
      reference_number: z.string().min(1),
      description: z.string().min(1),
      success_url: z.string().url(),
      cancel_url: z.string().url(),
      send_email_receipt: z.literal(false),
      show_description: z.literal(true),
      show_line_items: z.literal(true),
      metadata: z.object({
        reservation_id: z.string().uuid(),
        online_payment_id: z.string().uuid(),
        online_payment_attempt_id: z.string().uuid()
      }).strict()
    }).strict()
  }).strict()
}).strict();

export type PaymongoCheckoutRequest = z.infer<typeof checkoutRequestSchema>;

const checkoutSessionResponseSchema = z.object({
  data: z.object({
    id: z.string().regex(/^cs_[A-Za-z0-9_-]+$/),
    type: z.literal("checkout_session"),
    attributes: z.object({
      checkout_url: z.string().url(),
      livemode: z.boolean()
    }).passthrough()
  }).passthrough()
}).passthrough();

const checkoutSessionIdentityResponseSchema = z.object({
  data: z.object({
    id: z.string().regex(/^cs_[A-Za-z0-9_-]+$/)
  }).passthrough()
}).passthrough();

const providerPaymentSchema = z.object({
  id: z.string(),
  type: z.literal("payment").optional(),
  attributes: z.object({
    status: z.string(),
    amount: z.number().int().safe(),
    currency: z.string(),
    fee: z.number().int().safe().nullable().optional(),
    net_amount: z.number().int().safe().nullable().optional(),
    payment_intent_id: z.string().nullable().optional(),
    source: z.object({ type: z.string().nullable().optional() }).passthrough().nullable().optional(),
    paid_at: z.union([z.number().int().positive(), z.string()]).nullable().optional()
  }).passthrough()
}).passthrough();

const retrievedCheckoutSessionSchema = z.object({
  data: z.object({
    id: z.string().regex(/^cs_[A-Za-z0-9_-]+$/),
    type: z.literal("checkout_session"),
    attributes: z.object({
      checkout_url: z.string().url(),
      livemode: z.boolean(),
      status: z.enum(["active", "expired"]),
      reference_number: z.string().nullable(),
      metadata: z.record(z.string()),
      payment_intent: z.object({ id: z.string() }).passthrough().nullable().optional(),
      payments: z.array(providerPaymentSchema).optional().default([]),
      created_at: z.union([z.number().int().positive(), z.string()]).nullable().optional()
    }).passthrough()
  }).passthrough()
}).passthrough();

const expiredCheckoutSessionSchema = z.object({
  data: z.object({
    id: z.string().regex(/^cs_[A-Za-z0-9_-]+$/),
    type: z.literal("checkout_session"),
    attributes: z.object({ status: z.literal("expired") }).passthrough()
  }).passthrough()
}).passthrough();

function safeLineItemName(value: string) {
  const normalized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 127);
  return normalized || "WESCOMM item";
}

function unixSeconds(value: number | string | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.floor(milliseconds / 1000) : null;
}

function basicAuthorization() {
  if (!env.PAYMONGO_SECRET_KEY) {
    throw new HttpError(503, "PayMongo lifecycle operations are not configured.", "PAYMONGO_API_NOT_CONFIGURED");
  }
  return `Basic ${Buffer.from(`${env.PAYMONGO_SECRET_KEY}:`).toString("base64")}`;
}

export function mapPaymongoProviderError(status: number, operation: PaymongoOperation) {
  if (status === 401 || status === 403) {
    return new HttpError(502, "PayMongo credentials were rejected.", "PAYMONGO_AUTH_FAILED", { retryable: false });
  }
  if (operation === "get" && status === 404) {
    return new HttpError(404, "The PayMongo checkout session was not found.", "PAYMONGO_CHECKOUT_NOT_FOUND", {
      retryable: false
    });
  }
  if (operation === "expire" && status === 400) {
    return new HttpError(409, "The PayMongo checkout session is no longer expirable.", "PAYMONGO_CHECKOUT_NOT_EXPIRABLE", {
      retryable: false
    });
  }
  const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
  return new HttpError(
    retryable ? 503 : 502,
    retryable
      ? "The GCash checkout service is temporarily unavailable. Please try again."
      : operation === "create" ? "GCash checkout could not be created." : "PayMongo rejected the checkout request.",
    retryable ? "PAYMONGO_UNAVAILABLE" : `PAYMONGO_CHECKOUT_${operation.toUpperCase()}_REJECTED`,
    { retryable }
  );
}

export function mapInvalidPaymongoResponse(
  operation: PaymongoOperation,
  details: Record<string, unknown> = {}
) {
  if (operation === "create") {
    return new HttpError(
      503,
      "PayMongo returned an untrusted checkout response. The same checkout attempt will be checked before another payment is allowed.",
      "PAYMONGO_CREATE_OUTCOME_UNKNOWN",
      { retryable: true, outcomeUnknown: true, ...details }
    );
  }
  return new HttpError(502, "PayMongo returned an invalid response.", "INVALID_PAYMONGO_RESPONSE", {
    retryable: false
  });
}

async function callPaymongo(input: {
  url: string;
  method: "GET" | "POST";
  operation: PaymongoOperation;
  idempotencyKey?: string;
  body?: unknown;
  fetchImplementation: typeof fetch;
}) {
  let response: Response;
  try {
    response = await input.fetchImplementation(input.url, {
      method: input.method,
      headers: {
        Accept: "application/json",
        Authorization: basicAuthorization(),
        ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {})
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      redirect: "error",
      signal: AbortSignal.timeout(PAYMONGO_REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      503,
      "The GCash checkout service is temporarily unavailable. Please try again.",
      "PAYMONGO_UNAVAILABLE",
      { retryable: true }
    );
  }

  if (!response.ok) throw mapPaymongoProviderError(response.status, input.operation);

  try {
    return await response.json() as unknown;
  } catch {
    throw mapInvalidPaymongoResponse(input.operation);
  }
}

export function isTrustedPaymongoCheckoutUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === PAYMONGO_CHECKOUT_HOST
      && url.port === ""
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function buildPaymongoCheckoutRequest(input: CreatePaymongoCheckoutInput): PaymongoCheckoutRequest {
  return checkoutRequestSchema.parse({
    data: {
      attributes: {
        line_items: input.lineItems.map((item) => ({
          name: safeLineItemName(item.name),
          amount: item.amountCentavos,
          currency: "PHP",
          quantity: item.quantity
        })),
        payment_method_types: ["gcash"],
        reference_number: input.referenceNumber,
        description: `WESCOMM reservation ${input.referenceNumber}`,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        send_email_receipt: false,
        show_description: true,
        show_line_items: true,
        metadata: input.metadata
      }
    }
  });
}

export function parseStoredPaymongoCheckoutRequest(value: unknown) {
  return checkoutRequestSchema.parse(value);
}

async function createCheckoutSessionFromRequest(
  input: { idempotencyKey: string; request: PaymongoCheckoutRequest },
  fetchImplementation: typeof fetch,
  requireEnabled: boolean
): Promise<PaymongoCheckoutSession> {
  if (requireEnabled && !env.PAYMONGO_ENABLED) {
    throw new HttpError(503, "Online GCash payment is not available.", "PAYMONGO_DISABLED");
  }
  const request = checkoutRequestSchema.parse(input.request);
  const payload = await callPaymongo({
    url: PAYMONGO_CREATE_CHECKOUT_URL,
    method: "POST",
    operation: "create",
    idempotencyKey: input.idempotencyKey,
    body: request,
    fetchImplementation
  });
  return parseCreatedPaymongoCheckoutSession(payload);
}

export function parseCreatedPaymongoCheckoutSession(payload: unknown): PaymongoCheckoutSession {
  const result = checkoutSessionResponseSchema.safeParse(payload);
  if (!result.success || !isTrustedPaymongoCheckoutUrl(result.data.data.attributes.checkout_url)) {
    const identity = checkoutSessionIdentityResponseSchema.safeParse(payload);
    throw mapInvalidPaymongoResponse("create", identity.success
      ? { providerCheckoutSessionId: identity.data.data.id }
      : {});
  }
  return {
    id: result.data.data.id,
    checkoutUrl: result.data.data.attributes.checkout_url,
    livemode: result.data.data.attributes.livemode
  };
}

export async function createPaymongoCheckoutSessionFromRequest(
  input: { idempotencyKey: string; request: PaymongoCheckoutRequest },
  fetchImplementation: typeof fetch = fetch
) {
  return createCheckoutSessionFromRequest(input, fetchImplementation, true);
}

// Lifecycle recovery is allowed while the new-checkout kill switch is off.
// It reuses the exact immutable request and still-valid idempotency key. The
// caller stops one hour before the provider's 24-hour key window ends so a
// request cannot cross the boundary while in flight.
export async function recoverPaymongoCheckoutSessionFromRequest(
  input: { idempotencyKey: string; request: PaymongoCheckoutRequest },
  fetchImplementation: typeof fetch = fetch
) {
  return createCheckoutSessionFromRequest(input, fetchImplementation, false);
}

export async function createPaymongoCheckoutSession(
  input: CreatePaymongoCheckoutInput,
  fetchImplementation: typeof fetch = fetch
) {
  return createPaymongoCheckoutSessionFromRequest({
    idempotencyKey: input.idempotencyKey,
    request: buildPaymongoCheckoutRequest(input)
  }, fetchImplementation);
}

function normalizeProviderPayment(input: z.infer<typeof providerPaymentSchema>): NormalizedPaymongoPayment {
  const attributes = input.attributes;
  return {
    id: input.id,
    status: attributes.status,
    amountCentavos: attributes.amount,
    currency: attributes.currency,
    feeCentavos: attributes.fee ?? null,
    netAmountCentavos: attributes.net_amount ?? null,
    paymentIntentId: attributes.payment_intent_id ?? null,
    sourceType: attributes.source?.type ?? null,
    paidAtSeconds: unixSeconds(attributes.paid_at)
  };
}

export async function getPaymongoCheckoutSession(
  checkoutSessionId: string,
  fetchImplementation: typeof fetch = fetch
): Promise<RetrievedPaymongoCheckoutSession> {
  if (!/^cs_[A-Za-z0-9_-]+$/.test(checkoutSessionId)) {
    throw new HttpError(400, "Invalid PayMongo checkout session identifier.", "INVALID_CHECKOUT_SESSION");
  }
  const payload = await callPaymongo({
    url: `${PAYMONGO_CHECKOUT_V1_URL}/${encodeURIComponent(checkoutSessionId)}`,
    method: "GET",
    operation: "get",
    fetchImplementation
  });
  return parseRetrievedPaymongoCheckoutSession(payload);
}

export function parseRetrievedPaymongoCheckoutSession(payload: unknown): RetrievedPaymongoCheckoutSession {
  const result = retrievedCheckoutSessionSchema.safeParse(payload);
  if (!result.success || !isTrustedPaymongoCheckoutUrl(result.data.data.attributes.checkout_url)) {
    throw mapInvalidPaymongoResponse("get");
  }
  const { data } = result.data;
  return {
    id: data.id,
    status: data.attributes.status,
    checkoutUrl: data.attributes.checkout_url,
    livemode: data.attributes.livemode,
    referenceNumber: data.attributes.reference_number,
    metadata: data.attributes.metadata,
    paymentIntentId: data.attributes.payment_intent?.id ?? null,
    payments: data.attributes.payments.map(normalizeProviderPayment),
    createdAtSeconds: unixSeconds(data.attributes.created_at)
  };
}

export async function expirePaymongoCheckoutSession(
  checkoutSessionId: string,
  fetchImplementation: typeof fetch = fetch
) {
  if (!/^cs_[A-Za-z0-9_-]+$/.test(checkoutSessionId)) {
    throw new HttpError(400, "Invalid PayMongo checkout session identifier.", "INVALID_CHECKOUT_SESSION");
  }
  const payload = await callPaymongo({
    url: `${PAYMONGO_CHECKOUT_V1_URL}/${encodeURIComponent(checkoutSessionId)}/expire`,
    method: "POST",
    operation: "expire",
    fetchImplementation
  });
  return parseExpiredPaymongoCheckoutSession(payload, checkoutSessionId);
}

export function parseExpiredPaymongoCheckoutSession(payload: unknown, checkoutSessionId: string) {
  const result = expiredCheckoutSessionSchema.safeParse(payload);
  if (!result.success || result.data.data.id !== checkoutSessionId) {
    throw mapInvalidPaymongoResponse("expire");
  }
  return { id: result.data.data.id, status: result.data.data.attributes.status } as const;
}
