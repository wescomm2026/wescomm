import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import { createRateLimiter, userRateLimitKey } from "../middleware/rate-limit.js";
import { listUsers, updateUserRole } from "../services/user.service.js";
import { APP_ROLES } from "../types/app.js";
import { asyncHandler } from "../utils/async-handler.js";

export const usersRoutes = Router();

usersRoutes.use(requireAuth, requireRole("ADMIN"));

const updateRoleSchema = z.object({
  role: z.enum(APP_ROLES)
});

const userIdSchema = z.string().uuid();
const roleUpdateLimiter = createRateLimiter({
  namespace: "admin-role-update",
  windowMs: 15 * 60 * 1000,
  max: 30,
  key: userRateLimitKey,
  message: "Role update limit reached. Please wait before making more changes."
});

usersRoutes.get(
  "/",
  asyncHandler(async (_request, response) => {
    const users = await listUsers();
    response.json({ users });
  })
);

usersRoutes.patch(
  "/:id/role",
  roleUpdateLimiter,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const input = updateRoleSchema.parse(request.body);
    const user = await updateUserRole(userIdSchema.parse(request.params.id), input.role, request.auth!.id);
    response.json({ user });
  })
);
