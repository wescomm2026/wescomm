import { Router } from "express";
import { pickupGuidanceSchema, staffNotificationPreferencesSchema } from "../domain/staff-settings.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";
import {
  getPickupGuidance,
  getStaffNotificationPreferences,
  savePickupGuidance,
  saveStaffNotificationPreferences
} from "../services/staff-settings.service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const staffSettingsRoutes = Router();

staffSettingsRoutes.use(requireAuth, requireRole("STAFF", "ADMIN"));

staffSettingsRoutes.get(
  "/notification-preferences",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.json(await getStaffNotificationPreferences(request.auth!.id));
  })
);

staffSettingsRoutes.put(
  "/notification-preferences",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const preferences = staffNotificationPreferencesSchema.parse(request.body);
    response.json(await saveStaffNotificationPreferences(request.auth!.id, preferences));
  })
);

staffSettingsRoutes.get(
  "/pickup-guidance",
  asyncHandler(async (_request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.json({ guidance: await getPickupGuidance() });
  })
);

staffSettingsRoutes.put(
  "/pickup-guidance",
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const { text } = pickupGuidanceSchema.parse(request.body);
    response.json({ guidance: await savePickupGuidance(request.auth!.id, text) });
  })
);
