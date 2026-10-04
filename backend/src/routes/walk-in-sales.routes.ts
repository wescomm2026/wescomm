import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { createRateLimiter, userRateLimitKey } from "../middleware/rate-limit.js";
import { requireRole } from "../middleware/require-role.js";
import { scheduleOutboxProcessing } from "../services/outbox.service.js";
import { invalidateOperationalReadCaches } from "../services/operational-cache.service.js";
import { publishRealtimeEventsBestEffort, REALTIME_TOPICS } from "../services/realtime-event.service.js";
import {
  listWalkInSales,
  recordWalkInSale,
  voidWalkInSale
} from "../services/walk-in-sale.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const walkInSalesRoutes = Router();

const walkInSaleItemSchema = z.object({
  productId: z.string().uuid(),
  skuId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  quantity: z.coerce.number().int().min(1).max(10_000_000)
}).refine((item) => !(item.skuId && item.variantId), {
  message: "Choose either a SKU combination or a variant, not both."
});

const recordWalkInSaleSchema = z.object({
  items: z.array(walkInSaleItemSchema).min(1).max(50),
  buyerName: z.string().trim().min(2).max(120),
  studentId: z.string().uuid().nullish(),
  receiptCode: z.string().trim().min(5).max(64).regex(/^[A-Za-z0-9-]+$/, "Invalid receipt code.").optional(),
  cashReceived: z.coerce.number().nonnegative().max(10_000_000).multipleOf(0.01),
  clientSaleId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid sale key.")
});

const walkInSaleListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  query: z.string().trim().max(120).optional(),
  status: z.enum(["PENDING", "VERIFIED", "VOIDED"]).optional()
});

const walkInSaleReceiptIdSchema = z.string().uuid();

const voidWalkInSaleSchema = z.object({
  reason: z.string().trim().min(5).max(300)
});

const walkInSaleWriteLimiter = createRateLimiter({
  namespace: "walk-in-sale-write",
  windowMs: 10 * 60 * 1000,
  max: 120,
  key: userRateLimitKey
});

walkInSalesRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"));

walkInSalesRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    const page = await listWalkInSales(walkInSaleListSchema.parse(request.query));
    response.json(page);
  })
);

walkInSalesRoutes.post(
  "/",
  walkInSaleWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = recordWalkInSaleSchema.parse(request.body);
    const result = await recordWalkInSale({
      items: input.items,
      buyerName: input.buyerName,
      studentId: input.studentId ?? null,
      receiptCode: input.receiptCode ?? null,
      cashReceived: input.cashReceived,
      clientSaleId: input.clientSaleId,
      performedById: request.auth!.id
    });
    if (result.created) {
      await invalidateOperationalReadCaches();
      await publishRealtimeEventsBestEffort([{
        topic: REALTIME_TOPICS.inventory,
        entityId: result.receipt.id,
        audienceRoles: ["STUDENT", "STAFF", "ADMIN"],
        payload: { action: "walk-in-sale-recorded", receiptCode: result.receipt.receiptCode }
      }]);
    }
    response.json({ receipt: result.receipt });
  })
);

walkInSalesRoutes.post(
  "/:receiptId/void",
  walkInSaleWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = voidWalkInSaleSchema.parse(request.body);
    const result = await voidWalkInSale({
      receiptId: walkInSaleReceiptIdSchema.parse(request.params.receiptId),
      reason: input.reason,
      voidedById: request.auth!.id
    });
    if (result.changed) {
      await invalidateOperationalReadCaches();
      scheduleOutboxProcessing();
      await publishRealtimeEventsBestEffort([{
        topic: REALTIME_TOPICS.inventory,
        entityId: result.receipt.id,
        audienceRoles: ["STUDENT", "STAFF", "ADMIN"],
        payload: { action: "walk-in-sale-voided", receiptCode: result.receipt.receiptCode }
      }]);
    }
    response.json({ receipt: result.receipt });
  })
);
