import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { createRateLimiter, ipRateLimitKey, userRateLimitKey } from "../middleware/rate-limit.js";
import { requireRole } from "../middleware/require-role.js";
import { createReceipt, listReceipts, markReceiptVerified, verifyReceipt, voidReceipt } from "../services/receipt.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";

export const receiptsRoutes = Router();

const createReceiptSchema = z.object({
  studentId: z.string().uuid(),
  reservationId: z.string().uuid().optional(),
  totalAmount: z.number().nonnegative().max(10_000_000)
});

const voidReceiptSchema = z.object({
  reason: z.string().trim().max(300).optional()
});

const receiptCodeSchema = z.string().trim().min(5).max(64).regex(/^[A-Za-z0-9-]+$/, "Invalid receipt code.");
const receiptIdSchema = z.string().uuid();
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
    const receipts = await listReceipts(request.auth!.id, request.auth!.role);
    response.json({ receipts });
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
    response.json({ receipt });
  })
);
