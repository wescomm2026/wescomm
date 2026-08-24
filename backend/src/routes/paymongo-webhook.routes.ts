import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { processPaymongoWebhook } from "../services/paymongo-webhook.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import {
  hashPaymongoPayload,
  normalizePaymongoWebhookPayload,
  verifyPaymongoWebhookSignature
} from "../utils/paymongo-webhook.js";
import { invalidateOperationalReadCaches } from "../services/operational-cache.service.js";

export const paymongoWebhookHandler: RequestHandler = asyncHandler(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");

  // The checkout kill switch must not stop confirmations for sessions that
  // were created earlier. Existing webhooks continue while a secret exists.
  if (!env.PAYMONGO_WEBHOOK_SECRET) {
    throw new HttpError(503, "PayMongo webhook processing is not configured.", "PAYMONGO_DISABLED");
  }
  if (!Buffer.isBuffer(request.body)) {
    throw new HttpError(415, "PayMongo webhook requires an application/json body.", "INVALID_PAYMONGO_CONTENT_TYPE");
  }

  const rawBody = request.body;
  verifyPaymongoWebhookSignature({
    rawBody,
    signatureHeader: request.get("Paymongo-Signature"),
    webhookSecret: env.PAYMONGO_WEBHOOK_SECRET,
    livemode: env.PAYMONGO_LIVEMODE
  });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new HttpError(400, "PayMongo webhook body contains invalid JSON.", "INVALID_PAYMONGO_WEBHOOK");
  }

  const event = normalizePaymongoWebhookPayload(payload);
  const result = await processPaymongoWebhook({
    event,
    payloadHash: hashPaymongoPayload(rawBody)
  });
  await invalidateOperationalReadCaches();

  response.status(200).json({ received: true, ...result });
});
