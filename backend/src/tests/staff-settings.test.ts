import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_PICKUP_GUIDANCE,
  normalizePickupGuidance,
  normalizeStaffNotificationPreferences,
  pickupGuidanceSchema,
  preferenceForNotificationType,
  staffNotificationPreferencesSchema,
  staffWantsNotification
} from "../domain/staff-settings.js";

test("missing or malformed staff preferences default to receiving every alert", () => {
  assert.deepEqual(normalizeStaffNotificationPreferences(null), { lowStock: true, reservations: true, receipts: true });
  assert.deepEqual(normalizeStaffNotificationPreferences({ lowStock: false, receipts: "no" }), { lowStock: false, reservations: true, receipts: true });
});

test("only stock, reservation, and receipt broadcasts can be muted", () => {
  const muted = { lowStock: false, reservations: false, receipts: false };
  assert.equal(staffWantsNotification(muted, "LOW_STOCK"), false);
  assert.equal(staffWantsNotification(muted, "RESERVATION"), false);
  assert.equal(staffWantsNotification(muted, "RECEIPT"), false);
  assert.equal(staffWantsNotification(muted, "MESSAGE"), true);
  assert.equal(staffWantsNotification(muted, "PAYMENT"), true);
  assert.equal(preferenceForNotificationType("SYSTEM"), null);
});

test("preference and guidance payloads are strictly validated", () => {
  assert.throws(() => staffNotificationPreferencesSchema.parse({ lowStock: true, reservations: true }));
  assert.throws(() => staffNotificationPreferencesSchema.parse({ lowStock: true, reservations: true, receipts: true, extra: true }));
  assert.throws(() => pickupGuidanceSchema.parse({ text: "   " }));
  assert.throws(() => pickupGuidanceSchema.parse({ text: "x".repeat(301) }));
  assert.equal(pickupGuidanceSchema.parse({ text: "  Bring your school ID.  " }).text, "Bring your school ID.");
  assert.equal(normalizePickupGuidance({}), DEFAULT_PICKUP_GUIDANCE);
});

test("both staff alert fan-out paths honor personal preferences", () => {
  const source = (relativePath: string) => readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
  const notificationSource = source("src/services/notification.service.ts");
  const outboxSource = source("src/services/outbox.service.ts");
  assert.match(notificationSource, /filterStaffRecipientsByPreference\(/);
  assert.match(outboxSource, /applyStaffNotificationPreferences\(deliveries\)/);
  assert.doesNotMatch(outboxSource, /for \(const delivery of deliveries\) await createNotificationAndPush/);
});
