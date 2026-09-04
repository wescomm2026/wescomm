import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("pickup policy activation is preview-locked, idempotent, and records automatic closure moves", () => {
  const service = source("src/services/pickup-policy.service.ts");
  const routes = source("src/routes/pickup.routes.ts");
  assert.match(routes, /expectedCurrentPolicyVersion/);
  assert.match(routes, /previewFingerprint/);
  assert.match(routes, /idempotencyKey: z\.string\(\)\.uuid\(\)/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /PICKUP_POLICY_PREVIEW_STALE/);
  assert.match(service, /source: "SYSTEM_CLOSURE"/);
  assert.match(service, /triggerKey/);
  assert.match(service, /RESERVATION_PICKUP_AUTO_RESCHEDULED/);
});

test("pickup slot capacity uses one atomic lock across booking, manual rescheduling, and closure moves", () => {
  const capacity = source("src/services/pickup-capacity.service.ts");
  const policy = source("src/services/pickup-policy.service.ts");
  const reservation = source("src/services/reservation.service.ts");
  const migration = source("prisma/migrations/20260901000000_add_pickup_slot_capacity/migration.sql");
  assert.match(capacity, /pg_advisory_xact_lock\(hashtext/);
  assert.match(capacity, /ACTIVE_PICKUP_CAPACITY_STATUSES/);
  assert.match(capacity, /pickupStart,[\s\S]*pickupEnd,[\s\S]*status:/);
  assert.match(policy, /assertPickupWindowCapacity/);
  assert.match(policy, /excludeReservationId: current\.id/);
  assert.match(policy, /error\.code === "P2034"/);
  assert.match(policy, /PICKUP_POLICY_PREVIEW_STALE/);
  assert.match(reservation, /validatePickupSelectionInTransaction\(tx, input\)/);
  assert.match(migration, /CHECK \("capacity" IS NULL OR "capacity" > 0\)/);
});

test("secure receipt token resolution requires authentication and limits students to owned receipts", () => {
  const routes = source("src/routes/receipts.routes.ts");
  const service = source("src/services/receipt.service.ts");
  assert.match(routes, /"\/resolve-token"[\s\S]*requireAuth/);
  assert.match(service, /resolveReceiptTokenForViewer/);
  assert.match(service, /role === "STUDENT" && receipt\.studentId !== userId/);
  assert.match(service, /RECEIPT_QR_RESOLVED/);
});

test("support edits retain encrypted revisions and enforce ownership, latest-message, handler, and time-window rules", () => {
  const service = source("src/services/message.service.ts");
  const routes = source("src/routes/messages.routes.ts");
  assert.match(routes, /expectedEditVersion/);
  assert.match(service, /conversationMessageRevision\.create/);
  assert.match(service, /previousMessage: message\.message/);
  assert.match(service, /newMessage: encryptedMessage/);
  assert.match(service, /conversation\.assignedStaffId !== input\.userId/);
  assert.match(service, /latest\?\.id !== message\.id/);
  assert.match(service, /30 \* 60 \* 1000/);
  assert.match(service, /SUPPORT_MESSAGE_EDITED/);
});

test("conversation archive is role-scoped, personal for students, and resolved-only for operations", () => {
  const service = source("src/services/message.service.ts");
  const replyMigration = source("prisma/migrations/20260904000000_restore_student_archived_support_on_reply/migration.sql");
  assert.match(service, /input\.archived && input\.role !== "STUDENT" && conversation\.status !== "RESOLVED"/);
  assert.match(service, /input\.archived && input\.role !== "STUDENT" \? \{ status: "RESOLVED" as const \} : \{\}/);
  assert.match(service, /studentArchivedAt/);
  assert.match(service, /operationsArchivedAt/);
  assert.match(service, /archiveScope/);
  assert.match(service, /status: "OPEN", student_archived_at: null, updated_at: message\.createdAt/);
  assert.match(replyMigration, /insert_active_wesbot_reply[\s\S]*"student_archived_at" = NULL/);
  assert.match(replyMigration, /insert_owned_staff_message[\s\S]*"student_archived_at" = NULL/);
});

test("conversation retention is Admin-only, recoverable for 90 days, and purge is preview-locked", () => {
  const service = source("src/services/message.service.ts");
  const routes = source("src/routes/messages.routes.ts");
  const migration = source("prisma/migrations/20260901010000_add_conversation_retention_purge/migration.sql");
  const adminUi = source("../frontend/components/staff/StaffMessagesExperience.tsx");
  assert.match(routes, /"\/:conversationId\/deletion"[\s\S]*requireRole\("ADMIN"\)/);
  assert.match(routes, /"\/:conversationId\/purge-preview"[\s\S]*requireRole\("ADMIN"\)/);
  assert.match(routes, /"\/:conversationId\/permanent"[\s\S]*requireRole\("ADMIN"\)/);
  assert.match(service, /conversation\.status !== "RESOLVED"/);
  assert.match(service, /!conversation\.operationsArchivedAt/);
  assert.match(service, /CONVERSATION_PURGE_RETENTION_DAYS/);
  assert.match(service, /PURGE_PREVIEW_STALE/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /SUPPORT_CONVERSATION_PERMANENTLY_PURGED/);
  assert.match(service, /conversationPurgeRecord\.create/);
  assert.match(service, /tx\.conversation\.delete/);
  assert.match(migration, /conversation_purge_records/);
  assert.match(migration, /conversation_purge_records ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.conversation_purge_records FROM PUBLIC/);
  assert.doesNotMatch(migration, /"subject"|"student_id"|"message" TEXT/);
  assert.match(adminUi, /isAdmin \? <button[\s\S]*setConversationView\("DELETED"\)/);
  assert.match(adminUi, /purgePhrase !== purgeDialog\.preview\.confirmationPhrase/);
  assert.match(adminUi, /useAccessibleDialog<HTMLElement>/);
});
