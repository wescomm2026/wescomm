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
  restoreProduct,
  syncProductVariants,
  updateProduct,
  updateProductSaleMode,
  updateProductVariant
} from "../services/inventory.service.js";
import { PRODUCT_SALE_MODES, PRODUCT_STATUSES } from "../types/app.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { publishRealtimeEventsBestEffort, REALTIME_TOPICS } from "../services/realtime-event.service.js";
import { reconcileProductSkuInventory, restockProductSkus } from "../services/sku-inventory.service.js";
import { invalidateOperationalReadCaches } from "../services/operational-cache.service.js";

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

const inventoryIntegerSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? Number.NaN : value,
  z.coerce.number().int().nonnegative().max(10_000_000)
);

const variantSchema = z.object({
  optionName: z.string().trim().min(1).max(80),
  optionValue: z.string().trim().min(1).max(120),
  stock: inventoryIntegerSchema.default(0),
  lowStockThreshold: inventoryIntegerSchema.default(2)
});

const syncVariantsSchema = z.object({
  optionName: z.string().trim().min(1).max(80),
  variants: z.array(z.object({
    id: z.string().uuid().optional(),
    optionValue: z.string().trim().min(1).max(120),
    lowStockThreshold: inventoryIntegerSchema
  })).max(100)
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
    saleMode: z.enum(PRODUCT_SALE_MODES).default("SIMPLE"),
    stock: inventoryIntegerSchema.default(0),
    lowStockThreshold: inventoryIntegerSchema.default(10),
    variants: z.array(variantSchema).max(100).optional(),
    notes: z.string().trim().max(500).optional()
  })
  .refine((input) => input.categoryId || input.categorySlug || input.categoryName, {
    message: "Category is required.",
    path: ["categoryName"]
  })
  .superRefine((input, context) => {
    if (input.saleMode !== "OPTIONS" && (input.variants?.length ?? 0) > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only products sold with sizes/options can define selectable options.",
        path: ["variants"]
      });
    }
    if (input.saleMode === "OPTIONS" && (input.variants?.length ?? 0) === 0 && input.stock > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one option before opening stock for an option-based product.",
        path: ["variants"]
      });
    }
  });

const updateProductSchema = z.object({
  ...categorySchema,
  name: z.string().trim().min(2).max(160).optional(),
  description: optionalTextSchema,
  imageUrl: optionalTextSchema,
  price: z.coerce.number().nonnegative().max(10_000_000).optional(),
  oldPrice: optionalMoneySchema,
  status: z.enum(PRODUCT_STATUSES).optional(),
  stock: inventoryIntegerSchema.optional(),
  lowStockThreshold: inventoryIntegerSchema.optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(500).optional()
});

const restockSchema = z
  .object({
    mode: z.enum(["add", "set"]).default("add"),
    quantity: inventoryIntegerSchema,
    variantQuantities: z.array(z.object({
      variantId: z.string().uuid(),
      quantity: inventoryIntegerSchema
    })).max(100).optional(),
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

const inventoryStructureKeySchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9:_-]+$/);

const skuDefinitionSchema = z
  .object({
    variantIds: z.array(z.string().uuid()).max(12).optional(),
    optionValueKeys: z.array(inventoryStructureKeySchema).max(12).optional(),
    stock: inventoryIntegerSchema,
    lowStockThreshold: inventoryIntegerSchema.default(2)
  })
  .superRefine((input, context) => {
    if ((input.variantIds === undefined) === (input.optionValueKeys === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use exactly one option reference format for each inventory combination.",
        path: ["variantIds"]
      });
    }
  });

const skuOptionGroupSchema = z.object({
  key: inventoryStructureKeySchema,
  optionName: z.string().trim().min(1).max(80),
  values: z.array(z.object({
    key: inventoryStructureKeySchema,
    id: z.string().uuid().optional(),
    optionValue: z.string().trim().min(1).max(120),
    lowStockThreshold: inventoryIntegerSchema.default(2)
  })).min(1).max(100)
});

const reconcileSkuInventorySchema = z
  .object({
    optionGroups: z.array(skuOptionGroupSchema).min(1).max(12).optional(),
    skus: z.array(skuDefinitionSchema).min(1).max(500),
    notes: z.string().trim().max(500).optional()
  })
  .superRefine((input, context) => {
    const valueCount = input.optionGroups?.reduce((total, group) => total + group.values.length, 0) ?? 0;
    if (valueCount > 100) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inventory structure may contain at most 100 option values.",
        path: ["optionGroups"]
      });
    }
  });

const saleModeSchema = z.object({
  saleMode: z.enum(PRODUCT_SALE_MODES)
});

const restockSkuInventorySchema = z.object({
  mode: z.enum(["add", "set"]).default("add"),
  quantities: z.array(z.object({
    skuId: z.string().uuid(),
    quantity: inventoryIntegerSchema
  })).min(1).max(500),
  notes: z.string().trim().max(500).optional()
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
  status: z.enum(PRODUCT_STATUSES).optional(),
  visibility: z.enum(["ACTIVE", "ARCHIVED"]).default("ACTIVE"),
  includeCategories: z.literal("1").optional()
});
const inventoryWriteLimiter = createRateLimiter({
  namespace: "inventory-write",
  windowMs: 10 * 60 * 1000,
  max: 100,
  key: userRateLimitKey,
  message: "Inventory update limit reached. Please wait before making more changes."
});

async function publishInventoryChange(productId: string, action: string) {
  await invalidateOperationalReadCaches();
  await publishRealtimeEventsBestEffort([{
    topic: REALTIME_TOPICS.inventory,
    entityId: productId,
    audienceRoles: ["STUDENT", "STAFF", "ADMIN"],
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
    const { includeCategories, ...filters } = inventoryListQuerySchema.parse(request.query);
    const [page, categories] = await Promise.all([
      listInventory(filters),
      includeCategories ? listCategories() : Promise.resolve(undefined)
    ]);
    response.json({ products: page.items, nextCursor: page.nextCursor, categories });
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

staffProductsRoutes.put(
  "/:id/sale-mode",
  inventoryWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = saleModeSchema.parse(request.body);
    const product = await updateProductSaleMode(
      productIdSchema.parse(request.params.id),
      input.saleMode,
      request.auth!.id
    );
    await publishInventoryChange(product.id, "sale-mode-updated");
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
  "/:id/restore",
  inventoryWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const product = await restoreProduct(productIdSchema.parse(request.params.id), request.auth!.id);
    await publishInventoryChange(product.id, "restored");
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
      variantQuantities: input.variantQuantities,
      notes: input.notes,
      performedById: request.auth!.id
    });
    await publishInventoryChange(product.id, "restocked");
    response.json({ product });
  })
);

staffProductsRoutes.put(
  "/:id/variants",
  inventoryWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = syncVariantsSchema.parse(request.body);
    const product = await syncProductVariants(
      productIdSchema.parse(request.params.id),
      input.optionName,
      input.variants,
      request.auth!.id
    );
    await publishInventoryChange(product.id, "variants-synced");
    response.json({ product });
  })
);

staffProductsRoutes.put(
  "/:id/sku-inventory",
  inventoryWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = reconcileSkuInventorySchema.parse(request.body);
    const product = await reconcileProductSkuInventory({
      productId: productIdSchema.parse(request.params.id),
      skus: input.skus,
      optionGroups: input.optionGroups,
      performedById: request.auth!.id,
      notes: input.notes
    });
    await publishInventoryChange(product.id, "sku-reconciled");
    response.json({ product });
  })
);

staffProductsRoutes.post(
  "/:id/skus/restock",
  inventoryWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = restockSkuInventorySchema.parse(request.body);
    const product = await restockProductSkus({
      productId: productIdSchema.parse(request.params.id),
      mode: input.mode,
      quantities: input.quantities,
      performedById: request.auth!.id,
      notes: input.notes
    });
    await publishInventoryChange(product.id, "sku-restocked");
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
