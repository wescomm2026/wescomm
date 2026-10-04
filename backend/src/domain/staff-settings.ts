import { z } from "zod";

export type StaffNotificationPreferences = {
  lowStock: boolean;
  reservations: boolean;
  receipts: boolean;
};

export const DEFAULT_STAFF_NOTIFICATION_PREFERENCES: StaffNotificationPreferences = {
  lowStock: true,
  reservations: true,
  receipts: true
};

export const staffNotificationPreferencesSchema = z.object({
  lowStock: z.boolean(),
  reservations: z.boolean(),
  receipts: z.boolean()
}).strict();

export const PICKUP_GUIDANCE_MAX_LENGTH = 300;
export const DEFAULT_PICKUP_GUIDANCE = "Reservations are held until the selected pickup schedule. Unclaimed items are released after one business day.";

export const pickupGuidanceSchema = z.object({
  text: z.string().trim().min(1, "Enter the pickup guidance.").max(PICKUP_GUIDANCE_MAX_LENGTH, `Keep pickup guidance within ${PICKUP_GUIDANCE_MAX_LENGTH} characters.`)
}).strict();

export function staffNotificationPreferencesKey(userId: string) {
  return `staff.notification-preferences.${userId}`;
}

export const PICKUP_GUIDANCE_KEY = "staff.pickup-guidance";

/** Stored values may be partial or malformed; anything unrecognized falls back to "notify". */
export function normalizeStaffNotificationPreferences(value: unknown): StaffNotificationPreferences {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    lowStock: typeof source.lowStock === "boolean" ? source.lowStock : DEFAULT_STAFF_NOTIFICATION_PREFERENCES.lowStock,
    reservations: typeof source.reservations === "boolean" ? source.reservations : DEFAULT_STAFF_NOTIFICATION_PREFERENCES.reservations,
    receipts: typeof source.receipts === "boolean" ? source.receipts : DEFAULT_STAFF_NOTIFICATION_PREFERENCES.receipts
  };
}

export function normalizePickupGuidance(value: unknown) {
  const text = value && typeof value === "object" ? (value as Record<string, unknown>).text : null;
  return typeof text === "string" && text.trim() ? text.trim().slice(0, PICKUP_GUIDANCE_MAX_LENGTH) : DEFAULT_PICKUP_GUIDANCE;
}

/**
 * Team-wide alert types a staff member may mute. Messages, payments, and
 * system notices are always delivered because they need a human response.
 */
export function preferenceForNotificationType(type: string): keyof StaffNotificationPreferences | null {
  if (type === "LOW_STOCK") return "lowStock";
  if (type === "RESERVATION") return "reservations";
  if (type === "RECEIPT") return "receipts";
  return null;
}

export function staffWantsNotification(preferences: StaffNotificationPreferences, type: string) {
  const key = preferenceForNotificationType(type);
  return key ? preferences[key] : true;
}
