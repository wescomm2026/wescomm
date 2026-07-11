import { Router } from "express";
import { z } from "zod";
import { listProducts, getProduct } from "../services/product.service.js";
import { createRateLimiter, ipRateLimitKey } from "../middleware/rate-limit.js";
import { PRODUCT_STATUSES } from "../types/app.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";

export const productsRoutes = Router();

const productQuerySchema = z.object({
  query: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  sort: z.string().trim().max(40).optional()
});

const productIdSchema = z.string().uuid();
const publicProductLimiter = createRateLimiter({
  namespace: "public-products",
  windowMs: 60 * 1000,
  max: 240,
  key: ipRateLimitKey
});

productsRoutes.get(
  "/",
  publicProductLimiter,
  asyncHandler(async (request, response) => {
    const filters = productQuerySchema.parse(request.query);
    const products = await listProducts(filters);
    response.json({ products });
  })
);

productsRoutes.get(
  "/:id",
  publicProductLimiter,
  asyncHandler(async (request, response) => {
    const product = await getProduct(productIdSchema.parse(request.params.id));
    if (!product) throw new HttpError(404, "Product not found.");
    response.json({ product });
  })
);
