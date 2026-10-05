import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { getStudentOverview } from "../services/student-overview.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const studentOverviewRoutes = Router();

studentOverviewRoutes.get(
  "/",
  requireAuth,
  requireRole("STUDENT"),
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const overview = await getStudentOverview(request.auth!.id);
    response.setHeader("Cache-Control", "private, no-store");
    response.json({ overview });
  })
);
