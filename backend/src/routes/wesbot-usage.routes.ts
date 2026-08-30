import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { getWesbotAiUsageSummary } from "../services/wesbot-ai-usage.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const wesbotUsageRoutes = Router();

wesbotUsageRoutes.use(requireAuth, requireRole("ADMIN"));

wesbotUsageRoutes.get(
  "/usage",
  asyncHandler(async (_request, response) => {
    const usage = await getWesbotAiUsageSummary();
    response.setHeader("Cache-Control", "private, no-store");
    response.json({ usage });
  })
);
