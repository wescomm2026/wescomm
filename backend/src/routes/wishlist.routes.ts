import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { createRateLimiter, userRateLimitKey } from "../middleware/rate-limit.js";
import { requireRole } from "../middleware/require-role.js";
import {
  addWishlistItem,
  listWishlist,
  removeWishlistItem
} from "../services/wishlist.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const wishlistRoutes = Router();

const productIdSchema = z.string().uuid();
const wishlistWriteLimiter = createRateLimiter({
  namespace: "wishlist-write",
  windowMs: 10 * 60 * 1000,
  max: 120,
  key: userRateLimitKey,
  message: "Wishlist update limit reached. Please wait before making more changes."
});

wishlistRoutes.use(requireAuth, requireRole("STUDENT"));

wishlistRoutes.get(
  "/",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const wishlist = await listWishlist(request.auth!.id);
    response.json({ wishlist });
  })
);

wishlistRoutes.post(
  "/:productId",
  wishlistWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const wishlistItem = await addWishlistItem(
      request.auth!.id,
      productIdSchema.parse(request.params.productId)
    );
    response.json({ wishlistItem });
  })
);

wishlistRoutes.delete(
  "/:productId",
  wishlistWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    await removeWishlistItem(
      request.auth!.id,
      productIdSchema.parse(request.params.productId)
    );
    response.status(204).send();
  })
);
