import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { createRateLimiter, userRateLimitKey } from "../middleware/rate-limit.js";
import {
  archiveProduct,
  createProduct,
  createProductVariant,
  deleteProductVariant,
  getInventoryProduct,
  listCategories,
  listInventory,
  restockProduct,
  updateProduct,
  updateProductVariant
} from "../services/inventory.service.js";
import { PRODUCT_STATUSES } from "../types/app.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { publishRealtimeEventsBestEffort, REALTIME_TOPICS } from "../services/realtime-event.service.js";

export const staffProductsRoutes = Router();

const optionalTextSchema = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => (value ? value : null))
  .nullable()
  .optional();

const optionalMoneySchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.coerce.number().nonnegative().max(10_000_000).nullable().optional()
);

const categorySchema = {
  categoryId: z.string().uuid().optional(),
  categorySlug: z.string().trim().min(1).max(120).optional(),
  categoryName: z.string().trim().min(1).max(120).optional(),
  categoryIconUrl: optionalTextSchema
};

const variantSchema = z.object({
  optionName: z.string().trim().min(1).max(80),
  optionValue: z.string().trim().min(1).max(120),
  stock: z.coerce.number().int().nonnegative().max(10_000_000).default(0)
});

const createProductSchema = z
  .object({
    ...categorySchema,
    name: z.string().trim().min(2).max(160),
    description: optionalTextSchema,
    imageUrl: optionalTextSchema,
    price: z.coerce.number().nonnegative().max(10_000_000),
    oldPrice: optionalMoneySchema,
    status: z.enum(PRODUCT_STATUSES).optional(),
    stock: z.coerce.number().int().nonnegative().max(10_000_000).default(0),
    lowStockThreshold: z.coerce.number().int().nonnegative().max(10_000_000).default(10),
    variants: z.array(variantSchema).max(100).optional(),
    notes: z.string().trim().max(500).optional()
  })
  .refine((input) => input.categoryId || input.categorySlug || input.categoryName, {
    message: "Category is required.",
    path: ["categoryName"]
  });

const updateProductSchema = z.object({
  ...categorySchema,
  name: z.string().trim().min(2).max(160).optional(),
  description: optionalTextSchema,
  imageUrl: optionalTextSchema,
  price: z.coerce.number().nonnegative().max(10_000_000).optional(),
  oldPrice: optionalMoneySchema,
  status: z.enum(PRODUCT_STATUSES).optional(),
  stock: z.coerce.number().int().nonnegative().max(10_000_000).optional(),
  lowStockThreshold: z.coerce.number().int().nonnegative().max(10_000_000).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(500).optional()
});

const restockSchema = z
  .object({
    mode: z.enum(["add", "set"]).default("add"),
    quantity: z.coerce.number().int().nonnegative().max(10_000_000),
    notes: z.string().trim().max(500).optional()
  })
  .superRefine((input, context) => {
    if (input.mode === "add" && input.quantity <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quantity must be greater than 0 when adding stock.",
        path: ["quantity"]
      });
    }
  });

const updateVariantSchema = variantSchema.partial();
const productIdSchema = z.string().uuid();
const variantIdSchema = z.string().uuid();
const inventoryListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  query: z.string().trim().max(120).optional(),
  categoryId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  status: z.enum(PRODUCT_STATUSES).optional()
});
const inventoryWriteLimiter = createRateLimiter({
  namespace: "inventory-write",
  windowMs: 10 * 60 * 1000,
  max: 100,
  key: userRateLimitKey,
  message: "Inventory update limit reached. Please wait before making more changes."
});

async function publishInventoryChange(productId: string, action: string) {
  await publishRealtimeEventsBestEffort([{
    topic: REALTIME_TOPICS.inventory,
    entityId: productId,
    audienceRoles: ["STAFF", "ADMIN"],
    payload: { action }
  }, {
    topic: REALTIME_TOPICS.dashboard,
    entityId: productId,
    audienceRoles: ["STAFF", "ADMIN"],
    payload: { action: `inventory-${action}` }
  }]);
}

staffProductsRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"));

staffProductsRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    const page = await listInventory(inventoryListQuerySchema.parse(request.query));
    response.json({ products: page.items, nextCursor: page.nextCursor });
  })
);

staffProductsRoutes.get(
  "/categories",
  asyncHandler(async (_request, response) => {
    const categories = await listCategories();
    response.json({ categories });
  })
);

staffProductsRoutes.get(
  "/:id",
  asyncHandler(async (request, response) => {
    const product = await getInventoryProduct(productIdSchema.parse(request.params.id));
    if (!product) throw new HttpError(404, "Product not found.");
    response.json({ product });
  })
);

staffProductsRoutes.post(
  "/",
  inventoryWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = createProductSchema.parse(request.body);
    const product = await createProduct(input, request.auth!.id);
    await publishInventoryChange(product.id, "created");
    response.status(201).json({ product });
  })
);

staffProductsRoutes.patch(
  "/:id",
  inventoryWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = updateProductSchema.parse(request.body);
    const product = await updateProduct(productIdSchema.parse(request.params.id), input, request.auth!.id);
    await publishInventoryChange(product.id, "updated");
    response.json({ product });
  })
);

staffProductsRoutes.delete(
  "/:id",
  inventoryWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const product = await archiveProduct(productIdSchema.parse(request.params.id), request.auth!.id);
    await publishInventoryChange(product.id, "archived");
    response.json({ product });
  })
);

staffProductsRoutes.post(
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
    await publishInventoryChange(product.id, "restocked");
    response.json({ product });
  })
);

staffProductsRoutes.post(
  "/:id/variants",
  inventoryWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = variantSchema.parse(request.body);
    const product = await createProductVariant(productIdSchema.parse(request.params.id), input, request.auth!.id);
    await publishInventoryChange(product.id, "variant-created");
    response.status(201).json({ product });
  })
);

staffProductsRoutes.patch(
  "/:id/variants/:variantId",
  inventoryWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = updateVariantSchema.parse(request.body);
    const product = await updateProductVariant(
      productIdSchema.parse(request.params.id),
      variantIdSchema.parse(request.params.variantId),
      input,
      request.auth!.id
    );
    await publishInventoryChange(product.id, "variant-updated");
    response.json({ product });
  })
);

staffProductsRoutes.delete(
  "/:id/variants/:variantId",
  inventoryWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const product = await deleteProductVariant(
      productIdSchema.parse(request.params.id),
      variantIdSchema.parse(request.params.variantId),
      request.auth!.id
    );
    await publishInventoryChange(product.id, "variant-deleted");
    response.json({ product });
  })
);
