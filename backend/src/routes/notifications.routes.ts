import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "../services/notification.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const notificationsRoutes = Router();

notificationsRoutes.use(requireAuth);

notificationsRoutes.get(
  "/",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const notifications = await listNotifications(request.auth!.id);
    response.json({ notifications });
  })
);

notificationsRoutes.patch(
  "/read-all",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const notifications = await markAllNotificationsRead(request.auth!.id);
    response.json({ notifications });
  })
);

notificationsRoutes.patch(
  "/:id/read",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const notificationId = z.string().uuid().parse(request.params.id);
    const notification = await markNotificationRead(notificationId, request.auth!.id);
    response.json({ notification });
  })
);
