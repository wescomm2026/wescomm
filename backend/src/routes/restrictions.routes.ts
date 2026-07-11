import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { getStudentRestrictionSummary } from "../services/restriction.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const restrictionsRoutes = Router();

restrictionsRoutes.get(
  "/me",
  requireAuth,
  requireRole("STUDENT"),
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const restrictionSummary = await getStudentRestrictionSummary(request.auth!.id);
    response.json({ restrictionSummary });
  })
);
