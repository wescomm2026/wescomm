import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { createRateLimiter, userRateLimitKey } from "../middleware/rate-limit.js";
import { listInventory, restockProduct } from "../services/inventory.service.js";
import { PRODUCT_STATUSES } from "../types/app.js";
import { asyncHandler } from "../utils/async-handler.js";
import { publishRealtimeEventsBestEffort, REALTIME_TOPICS } from "../services/realtime-event.service.js";

export const inventoryRoutes = Router();

const restockSchema = z.object({
  mode: z.enum(["add", "set"]).default("add"),
  quantity: z.coerce.number().int().nonnegative().max(10_000_000),
  notes: z.string().trim().max(500).optional()
}).superRefine((input, context) => {
  if (input.mode === "add" && input.quantity <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Quantity must be greater than 0 when adding stock.",
      path: ["quantity"]
    });
  }
});

const productIdSchema = z.string().uuid();
const inventoryListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  query: z.string().trim().max(120).optional(),
  categoryId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  status: z.enum(PRODUCT_STATUSES).optional()
});
const inventoryWriteLimiter = createRateLimiter({
  namespace: "legacy-inventory-write",
  windowMs: 10 * 60 * 1000,
  max: 100,
  key: userRateLimitKey
});

inventoryRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"));

inventoryRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    const page = await listInventory(inventoryListQuerySchema.parse(request.query));
    response.json({ inventory: page.items, nextCursor: page.nextCursor });
  })
);

inventoryRoutes.post(
  "/:id/restock",
  inventoryWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = restockSchema.parse(request.body);
    const product = await restockProduct({
      productId: productIdSchema.parse(request.params.id),
      quantity: input.quantity,
      mode: input.mode,
      notes: input.notes,
      performedById: request.auth!.id
    });
    await publishRealtimeEventsBestEffort([{
      topic: REALTIME_TOPICS.inventory,
      entityId: product.id,
      audienceRoles: ["STAFF", "ADMIN"],
      payload: { action: "restocked" }
    }, {
      topic: REALTIME_TOPICS.dashboard,
      entityId: product.id,
      audienceRoles: ["STAFF", "ADMIN"],
      payload: { action: "inventory-restocked" }
    }]);
    response.json({ product });
  })
);
