import { prisma } from "../lib/prisma.js";
import {
  DEFAULT_PICKUP_GUIDANCE,
  normalizePickupGuidance,
  normalizeStaffNotificationPreferences,
  PICKUP_GUIDANCE_KEY,
  preferenceForNotificationType,
  staffNotificationPreferencesKey,
  staffWantsNotification,
  type StaffNotificationPreferences
} from "../domain/staff-settings.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";

export async function getStaffNotificationPreferences(userId: string) {
  const setting = await prisma.appSetting.findUnique({
    where: { key: staffNotificationPreferencesKey(userId) },
    select: { value: true, updatedAt: true }
  });
  return {
    preferences: normalizeStaffNotificationPreferences(setting?.value),
    updatedAt: setting?.updatedAt.toISOString() ?? null
  };
}

export async function saveStaffNotificationPreferences(userId: string, preferences: StaffNotificationPreferences) {
  const key = staffNotificationPreferencesKey(userId);
  const previous = await getStaffNotificationPreferences(userId);
  const setting = await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: preferences, updatedById: userId },
    update: { value: preferences, updatedById: userId, updatedAt: new Date() },
    select: { value: true, updatedAt: true }
  });
  await safelyRecordAuditLog({
    actorId: userId,
    action: "STAFF_NOTIFICATION_PREFERENCES_UPDATED",
    entityType: "user",
    entityId: userId,
    summary: "Updated personal staff notification preferences",
    metadata: { previous: previous.preferences, next: preferences }
  });
  return {
    preferences: normalizeStaffNotificationPreferences(setting.value),
    updatedAt: setting.updatedAt.toISOString()
  };
}

export async function getPickupGuidance() {
  const setting = await prisma.appSetting.findUnique({
    where: { key: PICKUP_GUIDANCE_KEY },
    select: {
      value: true,
      updatedAt: true,
      updatedBy: { select: { fullName: true, email: true } }
    }
  });
  return {
    text: setting ? normalizePickupGuidance(setting.value) : DEFAULT_PICKUP_GUIDANCE,
    updatedAt: setting?.updatedAt.toISOString() ?? null,
    updatedBy: setting?.updatedBy ? setting.updatedBy.fullName || setting.updatedBy.email : null
  };
}

export async function savePickupGuidance(userId: string, text: string) {
  const previous = await getPickupGuidance();
  await prisma.appSetting.upsert({
    where: { key: PICKUP_GUIDANCE_KEY },
    create: { key: PICKUP_GUIDANCE_KEY, value: { text }, updatedById: userId },
    update: { value: { text }, updatedById: userId, updatedAt: new Date() }
  });
  await safelyRecordAuditLog({
    actorId: userId,
    action: "PICKUP_GUIDANCE_UPDATED",
    entityType: "app_setting",
    entityId: PICKUP_GUIDANCE_KEY,
    summary: "Updated staff pickup guidance",
    metadata: { previousText: previous.text, nextText: text }
  });
  return getPickupGuidance();
}

/**
 * Drops staff/admin recipients who muted this alert type. Reading preferences
 * is best-effort: if it fails, every recipient still receives the alert.
 */
export async function filterStaffRecipientsByPreference<T extends { userId: string }>(recipients: T[], type: string) {
  if (!recipients.length || !preferenceForNotificationType(type)) return recipients;
  try {
    const settings = await prisma.appSetting.findMany({
      where: { key: { in: recipients.map((recipient) => staffNotificationPreferencesKey(recipient.userId)) } },
      select: { key: true, value: true }
    });
    if (!settings.length) return recipients;
    const muted = new Set(settings
      .filter((setting) => !staffWantsNotification(normalizeStaffNotificationPreferences(setting.value), type))
      .map((setting) => setting.key));
    return recipients.filter((recipient) => !muted.has(staffNotificationPreferencesKey(recipient.userId)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown preference lookup error.";
    console.warn(`Unable to read staff notification preferences; delivering to all recipients: ${message}`);
    return recipients;
  }
}
