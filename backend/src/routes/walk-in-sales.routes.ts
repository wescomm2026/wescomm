import { Router } from "express";
import { z } from "zod";
import { parseRecordWalkInSale } from "../domain/walk-in-sale-schemas.js";
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
    const input = parseRecordWalkInSale(request.body);
    const result = await recordWalkInSale({
      items: input.items,
      buyerName: input.buyerName,
      studentId: input.studentId ?? null,
      receiptCode: input.receiptCode ?? null,
      clientSaleId: input.clientSaleId,
      performedById: request.auth!.id,
      ...(input.collectionChannel === "TREASURER"
        ? {
            collectionChannel: "TREASURER" as const,
            officialReceiptNumber: input.officialReceiptNumber,
            treasuryReceiptInspected: input.treasuryReceiptInspected
          }
        : { collectionChannel: "COMMISSARY" as const, cashReceived: input.cashReceived })
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
