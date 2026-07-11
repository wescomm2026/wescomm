import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { createRateLimiter, ipRateLimitKey, userRateLimitKey } from "../middleware/rate-limit.js";
import { createFaq, deleteFaq, listFaqs, listPublishedFaqs, updateFaq } from "../services/faq.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const faqsRoutes = Router();

const optionalTextSchema = z
  .string()
  .trim()
  .transform((value) => (value ? value : null))
  .nullable()
  .optional();

const createFaqSchema = z.object({
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(3).max(5000),
  category: optionalTextSchema,
  isPublished: z.boolean().optional()
});

const updateFaqSchema = z.object({
  question: z.string().trim().min(3).max(300).optional(),
  answer: z.string().trim().min(3).max(5000).optional(),
  category: optionalTextSchema,
  isPublished: z.boolean().optional()
});

const faqIdSchema = z.string().uuid();
const faqWriteLimiter = createRateLimiter({
  namespace: "faq-write",
  windowMs: 10 * 60 * 1000,
  max: 60,
  key: userRateLimitKey
});
const publicFaqLimiter = createRateLimiter({
  namespace: "public-faqs",
  windowMs: 60 * 1000,
  max: 120,
  key: ipRateLimitKey
});

faqsRoutes.get(
  "/",
  publicFaqLimiter,
  asyncHandler(async (_request, response) => {
    const faqs = await listPublishedFaqs();
    response.json({ faqs });
  })
);

faqsRoutes.get(
  "/manage",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  asyncHandler(async (_request, response) => {
    const faqs = await listFaqs();
    response.json({ faqs });
  })
);

faqsRoutes.post(
  "/",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  faqWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = createFaqSchema.parse(request.body);
    const faq = await createFaq({
      ...input,
      updatedById: request.auth!.id
    });
    response.status(201).json({ faq });
  })
);

faqsRoutes.patch(
  "/:id",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  faqWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = updateFaqSchema.parse(request.body);
    const faq = await updateFaq(faqIdSchema.parse(request.params.id), {
      ...input,
      updatedById: request.auth!.id
    });
    response.json({ faq });
  })
);

faqsRoutes.delete(
  "/:id",
  requireAuth,
  requireRole("STAFF", "ADMIN"),
  faqWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const faq = await deleteFaq(faqIdSchema.parse(request.params.id), request.auth!.id);
    response.json({ faq });
  })
);
