import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { createRateLimiter, userRateLimitKey } from "../middleware/rate-limit.js";
import { requireRole } from "../middleware/require-role.js";
import {
  createManualRestriction,
  liftRestriction,
  listRestrictionOverview,
  overturnOffense
} from "../services/restriction.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const staffRestrictionsRoutes = Router();

const identifierSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(5).max(500);
const overviewQuerySchema = z.object({
  query: z.string().trim().max(120).optional(),
  status: z.enum(["ALL", "RESTRICTED", "CLEAR"]).default("ALL")
});
const createRestrictionSchema = z.object({
  studentId: identifierSchema,
  duration: z.enum(["7_DAYS", "30_DAYS", "INDEFINITE"]),
  reason: reasonSchema
});
const reviewSchema = z.object({ reason: reasonSchema });

const restrictionWriteLimiter = createRateLimiter({
  namespace: "student-restriction-write",
  windowMs: 15 * 60 * 1000,
  max: 40,
  key: userRateLimitKey,
  message: "Student access review limit reached. Please wait before making more changes."
});

staffRestrictionsRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"));

staffRestrictionsRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    const filters = overviewQuerySchema.parse(request.query);
    const overview = await listRestrictionOverview(filters);
    response.json({ overview });
  })
);

staffRestrictionsRoutes.post(
  "/",
  restrictionWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = createRestrictionSchema.parse(request.body);
    const restriction = await createManualRestriction({
      ...input,
      createdById: request.auth!.id,
      actorRole: request.auth!.role
    });
    response.status(201).json({ restriction });
  })
);

staffRestrictionsRoutes.patch(
  "/:id/lift",
  restrictionWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = reviewSchema.parse(request.body);
    const restriction = await liftRestriction({
      restrictionId: identifierSchema.parse(request.params.id),
      reason: input.reason,
      liftedById: request.auth!.id,
      actorRole: request.auth!.role
    });
    response.json({ restriction });
  })
);

staffRestrictionsRoutes.patch(
  "/offenses/:id/overturn",
  requireRole("ADMIN"),
  restrictionWriteLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = reviewSchema.parse(request.body);
    const offense = await overturnOffense({
      offenseId: identifierSchema.parse(request.params.id),
      reason: input.reason,
      overturnedById: request.auth!.id
    });
    response.json({ offense });
  })
);
