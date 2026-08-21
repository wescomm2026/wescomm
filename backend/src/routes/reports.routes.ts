import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { getReportSummary } from "../services/report.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { measureRequestPhase } from "../middleware/request-timing.js";

export const reportsRoutes = Router();

reportsRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"));

reportsRoutes.get(
  "/summary",
  asyncHandler(async (_request, response) => {
    const summary = await measureRequestPhase(response, "report_aggregate", getReportSummary);
    response.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=15");
    response.json({ summary });
  })
);
