import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "../services/notification.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const notificationsRoutes = Router();

notificationsRoutes.use(requireAuth);

notificationsRoutes.get(
  "/",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(50).optional(),
      before: z.string().datetime({ offset: true }).optional()
    }).parse(request.query);
    const result = await listNotifications(request.auth!.id, query);
    response.json(result);
  })
);

notificationsRoutes.get(
  "/unread-count",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const unreadCount = await getUnreadNotificationCount(request.auth!.id);
    response.json({ unreadCount });
  })
);

notificationsRoutes.patch(
  "/read-all",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const updatedCount = await markAllNotificationsRead(request.auth!.id);
    response.json({ updatedCount });
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
