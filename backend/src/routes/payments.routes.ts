import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { createRateLimiter, userRateLimitKey } from "../middleware/rate-limit.js";
import { requireRole } from "../middleware/require-role.js";
import {
  createOrResumeGcashCheckout,
  getOnlinePaymentById,
  getPaymentOptions
} from "../services/payment.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import {
  reconcileOnlinePayment,
  runPaymongoMaintenance
} from "../services/paymongo-reconciliation.service.js";
import { runOutboxBatch } from "../services/outbox.service.js";
import { deleteExpiredRealtimeEvents } from "../services/realtime-event.service.js";

const paymentIdSchema = z.string().uuid();
const checkoutSchema = z.object({
  reservationId: z.string().uuid()
});
const idempotencyKeySchema = z
  .string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Invalid payment request key.");

const checkoutLimiter = createRateLimiter({
  namespace: "paymongo-checkout",
  windowMs: 10 * 60 * 1000,
  max: 10,
  key: userRateLimitKey,
  message: "Too many payment attempts. Please wait before trying again."
});

const reconcileLimiter = createRateLimiter({
  namespace: "paymongo-reconcile",
  windowMs: 10 * 60 * 1000,
  max: 15,
  key: userRateLimitKey,
  message: "Too many reconciliation requests. Please wait before trying again."
});

const maintenanceLimiter = createRateLimiter({
  namespace: "paymongo-maintenance",
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many payment maintenance requests."
});

const maintenanceSchema = z.object({
  limit: z.number().int().min(1).max(50).default(25)
}).default({ limit: 25 });

function requireMaintenanceSecret(request: Request, _response: Response, next: NextFunction) {
  const configured = env.PAYMENT_MAINTENANCE_SECRET;
  const header = request.get("Authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!configured) return next(new HttpError(503, "Payment maintenance is not configured.", "PAYMENT_MAINTENANCE_DISABLED"));
  if (!supplied) return next(new HttpError(401, "Payment maintenance authorization is required."));
  const expectedDigest = createHash("sha256").update(configured).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  if (!timingSafeEqual(expectedDigest, suppliedDigest)) {
    return next(new HttpError(401, "Payment maintenance authorization is invalid."));
  }
  return next();
}

export const paymentsRoutes = Router();

paymentsRoutes.get(
  "/options",
  asyncHandler(async (_request, response) => {
    response.json(getPaymentOptions());
  })
);

paymentsRoutes.post(
  "/maintenance",
  requireMaintenanceSecret,
  maintenanceLimiter,
  asyncHandler(async (request, response) => {
    const { limit } = maintenanceSchema.parse(request.body ?? {});
    const [paymentMaintenance, outbox, deletedRealtimeEvents] = await Promise.all([
      runPaymongoMaintenance({ actorId: null, limit }),
      runOutboxBatch({ limit }),
      deleteExpiredRealtimeEvents()
    ]);
    response.json({ maintenance: paymentMaintenance, outbox, deletedRealtimeEvents });
  })
);

paymentsRoutes.post(
  "/gcash/checkout",
  requireAuth,
  requireRole("STUDENT"),
  checkoutLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const { reservationId } = checkoutSchema.parse(request.body);
    const requestKey = idempotencyKeySchema.parse(request.get("Idempotency-Key") ?? "");
    const result = await createOrResumeGcashCheckout({
      reservationId,
      studentId: request.auth!.id,
      requestKey
    });
    response.json(result);
  })
);

paymentsRoutes.post(
  "/:id/reconcile",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  reconcileLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const paymentId = paymentIdSchema.parse(request.params.id);
    await getOnlinePaymentById({
      paymentId,
      userId: request.auth!.id,
      role: request.auth!.role
    });
    const reconciliation = await reconcileOnlinePayment(paymentId, request.auth!.id);
    const payment = await getOnlinePaymentById({
      paymentId,
      userId: request.auth!.id,
      role: request.auth!.role
    });
    response.json({ payment, reconciliation });
  })
);

paymentsRoutes.get(
  "/:id",
  requireAuth,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const payment = await getOnlinePaymentById({
      paymentId: paymentIdSchema.parse(request.params.id),
      userId: request.auth!.id,
      role: request.auth!.role
    });
    response.json({ payment });
  })
);
