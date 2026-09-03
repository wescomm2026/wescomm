import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { searchStaffWorkspace } from "../services/global-search.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const globalSearchRoutes = Router();

globalSearchRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"));

globalSearchRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    const { query } = z.object({ query: z.string().trim().min(2).max(100) }).parse(request.query);
    const results = await searchStaffWorkspace(query);
    response.json({ results });
  })
);
