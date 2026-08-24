import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { createRateLimiter, ipRateLimitKey, userRateLimitKey } from "../middleware/rate-limit.js";
import { requireRole } from "../middleware/require-role.js";
import { createReceipt, getReceipt, listReceipts, markReceiptVerified, verifyReceipt, voidReceipt } from "../services/receipt.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { measureRequestPhase } from "../middleware/request-timing.js";
import { scheduleOutboxProcessing } from "../services/outbox.service.js";
import { invalidateDashboardAndReportCaches } from "../services/operational-cache.service.js";

export const receiptsRoutes = Router();

const createReceiptSchema = z.object({
  studentId: z.string().uuid(),
  reservationId: z.string().uuid().optional(),
  totalAmount: z.number().nonnegative().max(10_000_000)
});

const voidReceiptSchema = z.object({
  reason: z.string().trim().max(300).optional()
});

const receiptCodeSchema = z
  .string()
  .trim()
  .min(5)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/, "Invalid receipt code.")
  .transform((value) => value.toUpperCase());
const receiptIdSchema = z.string().uuid();
const receiptListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  status: z.enum(["PENDING", "VERIFIED", "VOIDED"]).optional(),
  query: z.string().trim().max(120).optional(),
  receiptCode: z.string().trim().max(80).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional()
}).superRefine((input, context) => {
  if (input.dateFrom && input.dateTo && input.dateTo < input.dateFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "dateTo must not be before dateFrom.", path: ["dateTo"] });
  }
});
const publicVerificationLimiter = createRateLimiter({
  namespace: "public-receipt-verification",
  windowMs: 15 * 60 * 1000,
  max: 30,
  key: ipRateLimitKey,
  message: "Too many receipt checks. Please wait before trying again."
});
const receiptWriteLimiter = createRateLimiter({
  namespace: "receipt-write",
  windowMs: 10 * 60 * 1000,
  max: 60,
  key: userRateLimitKey
});

receiptsRoutes.get(
  "/verify/:code",
  publicVerificationLimiter,
  asyncHandler(async (request, response) => {
    const receiptCode = receiptCodeSchema.parse(request.params.code);
    const receipt = await verifyReceipt(receiptCode);
    if (!receipt) throw new HttpError(404, "Receipt not found.");
    response.setHeader("Cache-Control", "no-store");
    response.json({ receipt });
  })
);

receiptsRoutes.get(
  "/",
  requireAuth,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const filters = receiptListQuerySchema.parse(request.query);
    const page = await measureRequestPhase(response, "receipt_query", () =>
      listReceipts(request.auth!.id, request.auth!.role, filters)
    );
    response.json(page);
  })
);

receiptsRoutes.get(
  "/:id",
  requireAuth,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const receipt = await measureRequestPhase(response, "receipt_detail", () =>
      getReceipt(request.auth!.id, request.auth!.role, receiptIdSchema.parse(request.params.id))
    );
    response.json({ receipt });
  })
);

receiptsRoutes.post(
  "/",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  receiptWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = createReceiptSchema.parse(request.body);
    const receipt = await createReceipt({
      ...input,
      issuedById: request.auth!.id
    });
    await invalidateDashboardAndReportCaches();
    response.status(201).json({ receipt });
  })
);

receiptsRoutes.patch(
  "/:id/verify",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  receiptWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const receipt = await markReceiptVerified(receiptIdSchema.parse(request.params.id), request.auth!.id);
    await invalidateDashboardAndReportCaches();
    scheduleOutboxProcessing();
    response.json({ receipt });
  })
);

receiptsRoutes.patch(
  "/:id/void",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  receiptWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = voidReceiptSchema.parse(request.body);
    const receipt = await voidReceipt(receiptIdSchema.parse(request.params.id), request.auth!.id, input.reason);
    await invalidateDashboardAndReportCaches();
    scheduleOutboxProcessing();
    response.json({ receipt });
  })
);
