import { Router } from "express";
import { z } from "zod";
import { REPORT_RANGE_PRESETS } from "../domain/report-range.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { getReportSummary } from "../services/report.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { measureRequestPhase } from "../middleware/request-timing.js";

export const reportsRoutes = Router();

reportsRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"));

reportsRoutes.get(
  "/summary",
  asyncHandler(async (request, response) => {
    const query = z.object({
      preset: z.enum(REPORT_RANGE_PRESETS).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      granularity: z.enum(["AUTO", "DAILY", "MONTHLY"]).optional()
    }).parse(request.query);
    const summary = await measureRequestPhase(response, "report_aggregate", () => getReportSummary(query));
    response.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=15");
    response.json({ summary });
  })
);
