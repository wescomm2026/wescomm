import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { createRateLimiter, userRateLimitKey } from "../middleware/rate-limit.js";
import { safelyRecordAuditLog } from "../services/audit-log.service.js";
import { uploadProductImage } from "../services/upload.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const uploadsRoutes = Router();

const productImageSchema = z.object({
  fileName: z.string().trim().min(1).max(120),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64: z.string().min(1).max(3_000_000)
});

const uploadLimiter = createRateLimiter({
  namespace: "product-image-upload",
  windowMs: 60 * 60 * 1000,
  max: 20,
  key: userRateLimitKey,
  message: "Product image upload limit reached. Please try again later."
});

uploadsRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"));

uploadsRoutes.post(
  "/product-image",
  uploadLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = productImageSchema.parse(request.body);
    const image = await uploadProductImage(input);
    await safelyRecordAuditLog({
      actorId: request.auth!.id,
      action: "PRODUCT_IMAGE_UPLOADED",
      entityType: "product_image",
      entityId: image.path,
      summary: `Uploaded product image ${input.fileName}.`,
      metadata: {
        fileName: input.fileName,
        contentType: input.contentType,
        path: image.path,
        url: image.url
      }
    });
    response.status(201).json({ image });
  })
);
