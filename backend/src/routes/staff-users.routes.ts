import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { listStaffVisibleUsers } from "../services/user.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const staffUsersRoutes = Router();

staffUsersRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"));

staffUsersRoutes.get(
  "/",
  asyncHandler(async (_request, response) => {
    const users = await listStaffVisibleUsers();
    response.json({ users });
  })
);
