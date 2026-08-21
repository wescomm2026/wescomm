import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { getStaffDashboardSummary } from "../services/dashboard.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const dashboardRoutes = Router();

dashboardRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"));

dashboardRoutes.get(
  "/summary",
  asyncHandler(async (_request, response) => {
    const dashboard = await getStaffDashboardSummary();
    response.json({ dashboard });
  })
);
