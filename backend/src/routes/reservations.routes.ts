import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { createRateLimiter, userRateLimitKey } from "../middleware/rate-limit.js";
import { requireRole } from "../middleware/require-role.js";
import {
  cancelStudentReservation,
  createReservation,
  getReservation,
  listReservations,
  updateReservationStatus
} from "../services/reservation.service.js";
import { rescheduleReservation } from "../services/pickup-policy.service.js";
import { PAYMENT_METHODS, RESERVATION_STATUSES } from "../types/app.js";
import { asyncHandler } from "../utils/async-handler.js";
import { measureRequestPhase } from "../middleware/request-timing.js";
import { scheduleOutboxProcessing } from "../services/outbox.service.js";
import { invalidateOperationalReadCaches } from "../services/operational-cache.service.js";

export const reservationsRoutes = Router();

const createReservationSchema = z.object({
    paymentMethod: z.enum(PAYMENT_METHODS).default("PAY_AT_COMMISSARY"),
    pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pickup date must use YYYY-MM-DD."),
    pickupSlotId: z.string().uuid(),
    pickupPolicyVersion: z.number().int().positive(),
    policyAcceptance: z.object({
      accepted: z.boolean().optional(),
      version: z.string().trim().min(1).max(32).optional()
    }).strict().optional(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          skuId: z.string().uuid().optional(),
          variantSummary: z.string().trim().max(500).optional(),
          quantity: z.number().int().positive().max(20)
        })
      )
      .min(1)
      .max(25)
  });

const updateStatusSchema = z.object({
  status: z.enum(RESERVATION_STATUSES)
});
const rescheduleSchema = z.object({
  expectedScheduleRevision: z.number().int().positive(),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pickup date must use YYYY-MM-DD."),
  pickupSlotId: z.string().uuid(),
  pickupPolicyVersion: z.number().int().positive(),
  reason: z.string().trim().min(5).max(500)
});

const reservationIdSchema = z.string().uuid();
const reservationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  status: z.enum(RESERVATION_STATUSES).optional(),
  query: z.string().trim().max(120).optional(),
  referenceCode: z.string().trim().max(80).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional()
}).superRefine((input, context) => {
  if (input.dateFrom && input.dateTo && input.dateTo < input.dateFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "dateTo must not be before dateFrom.", path: ["dateTo"] });
  }
});
const idempotencyKeySchema = z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/, "Invalid checkout request key.");
const reservationCreateLimiter = createRateLimiter({
  namespace: "reservation-create",
  windowMs: 10 * 60 * 1000,
  max: 10,
  key: userRateLimitKey,
  message: "Too many reservation attempts. Please wait before submitting another reservation."
});
const reservationStatusLimiter = createRateLimiter({
  namespace: "reservation-status",
  windowMs: 10 * 60 * 1000,
  max: 100,
  key: userRateLimitKey
});

reservationsRoutes.get(
  "/",
  requireAuth,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const filters = reservationListQuerySchema.parse(request.query);
    const page = await measureRequestPhase(response, "reservation_query", () =>
      listReservations(request.auth!.id, request.auth!.role, filters)
    );
    response.json(page);
  })
);

reservationsRoutes.get(
  "/:id",
  requireAuth,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const reservation = await measureRequestPhase(response, "reservation_detail", () => getReservation(
      request.auth!.id, request.auth!.role, reservationIdSchema.parse(request.params.id)
    ));
    response.json({ reservation });
  })
);

reservationsRoutes.post(
  "/",
  requireAuth,
  requireRole("STUDENT"),
  reservationCreateLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = createReservationSchema.parse(request.body);
    const idempotencyKey = idempotencyKeySchema.parse(request.get("Idempotency-Key") ?? "");
    const result = await measureRequestPhase(response, "reservation_command", () => createReservation({
      studentId: request.auth!.id,
      idempotencyKey,
      ...input
    }));
    if (!result.idempotentReplay) await invalidateOperationalReadCaches();
    scheduleOutboxProcessing();
    response.setHeader("Idempotent-Replayed", result.idempotentReplay ? "true" : "false");
    response.status(result.idempotentReplay ? 200 : 201).json(result);
  })
);

reservationsRoutes.post(
  "/:id/cancel",
  requireAuth,
  requireRole("STUDENT"),
  reservationStatusLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const result = await measureRequestPhase(response, "reservation_cancel", () => cancelStudentReservation(
      reservationIdSchema.parse(request.params.id),
      request.auth!.id
    ));
    await invalidateOperationalReadCaches();
    scheduleOutboxProcessing();
    response.json(result);
  })
);

reservationsRoutes.patch(
  "/:id/status",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  reservationStatusLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = updateStatusSchema.parse(request.body);
    const result = await measureRequestPhase(response, "reservation_status", () =>
      updateReservationStatus(reservationIdSchema.parse(request.params.id), input.status, request.auth!.id)
    );
    await invalidateOperationalReadCaches();
    scheduleOutboxProcessing();
    response.json(result);
  })
);

reservationsRoutes.patch(
  "/:id/pickup",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  reservationStatusLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = rescheduleSchema.parse(request.body);
    const reservationId = await rescheduleReservation({
      reservationId: reservationIdSchema.parse(request.params.id),
      actorId: request.auth!.id,
      ...input
    });
    const reservation = await getReservation(request.auth!.id, request.auth!.role, reservationId);
    await invalidateOperationalReadCaches();
    scheduleOutboxProcessing();
    response.json({ reservation });
  })
);

reservationsRoutes.post(
  "/:id/no-show",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  reservationStatusLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const result = await updateReservationStatus(reservationIdSchema.parse(request.params.id), "NO_SHOW", request.auth!.id);
    await invalidateOperationalReadCaches();
    scheduleOutboxProcessing();
    response.json(result);
  })
);
