import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { getStaffDashboardSummary } from "../services/dashboard.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const dashboardRoutes = Router();

dashboardRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"));

dashboardRoutes.get(
  "/summary",
  asyncHandler(async (request, response) => {
    const { fresh } = z.object({ fresh: z.literal("1").optional() }).parse(request.query);
    const dashboard = await getStaffDashboardSummary({ bypassCache: fresh === "1" });
    response.setHeader("Cache-Control", fresh === "1" ? "private, no-store, max-age=0" : "private, max-age=10");
    response.json({ dashboard });
  })
);
