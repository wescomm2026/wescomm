import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createWesbotConcernKey,
  detectWesbotIntent,
  extractReceiptCode,
  extractReservationReference,
  requestsHumanSupport,
  scoreWesbotTextMatch,
  shouldRecommendStaff
} from "../domain/wesbot.js";
import { isSafeAiRewrite } from "../services/wesbot.service.js";

test("WesBot recognizes common Taglish commissary intents", () => {
  assert.equal(detectWesbotIntent("May stock ba ng WUP polo medium?"), "PRODUCT_INQUIRY");
  assert.equal(detectWesbotIntent("Pwede ko ba i-cancel ang WES-2026-A1B2C3D4?"), "CANCELLATION_ELIGIBILITY");
  assert.equal(detectWesbotIntent("Paki-check ang GCash payment ko"), "PAYMENT_STATUS");
  assert.equal(detectWesbotIntent("Nasaan ang receipt RCT-2026-A1B2C3D4E5?"), "RECEIPT_STATUS");
  assert.equal(detectWesbotIntent("Kailan ko puwedeng kunin ang reservation?"), "PICKUP_INFORMATION");
});

test("explicit human requests are detected without treating normal bot questions as handoffs", () => {
  for (const message of [
    "Gusto ko makausap ng staff",
    "Talk to a real person please",
    "Ayoko sa bot, admin please"
  ]) {
    assert.equal(requestsHumanSupport(message), true, message);
    assert.equal(detectWesbotIntent(message), "HUMAN_HANDOFF", message);
  }

  assert.equal(requestsHumanSupport("May available bang staff uniform?"), false);
  assert.equal(requestsHumanSupport("Ano ang commissary hours?"), false);
});

test("reservation and receipt references are extracted exactly", () => {
  assert.equal(extractReservationReference("check wes-2026-a1b2c3d4 please"), "WES-2026-A1B2C3D4");
  assert.equal(extractReceiptCode("receipt: rct-2026-a1b2c3d4e5"), "RCT-2026-A1B2C3D4E5");
  assert.equal(extractReservationReference("WES-2026-NOT-A-CODE"), null);
  assert.equal(extractReceiptCode("RCT-2026-123"), null);
});

test("equivalent repeated questions share a concern key and recommend staff on the third occurrence", () => {
  const first = createWesbotConcernKey("PRODUCT_INQUIRY", "Available ba ang polo medium?");
  const second = createWesbotConcernKey("PRODUCT_INQUIRY", "Polo medium available?");
  assert.equal(first, second);
  assert.equal(shouldRecommendStaff(1), false);
  assert.equal(shouldRecommendStaff(2), false);
  assert.equal(shouldRecommendStaff(3), true);
});

test("product matching favors relevant database names", () => {
  const relevant = scoreWesbotTextMatch("BSIT polo medium", "WUP BSIT Department Polo - medium");
  const unrelated = scoreWesbotTextMatch("BSIT polo medium", "College of Nursing skirt - small");
  assert.ok(relevant > unrelated);
});

test("optional AI polish cannot change or omit grounded facts", () => {
  const grounded = "WES-2026-A1B2C3D4 payment status is Paid. Verified paid time: Aug 14, 2026, 2:30 PM.";
  assert.equal(
    isSafeAiRewrite(grounded, "Paid ang WES-2026-A1B2C3D4. Verified paid time: Aug 14, 2026, 2:30 PM."),
    true
  );
  assert.equal(
    isSafeAiRewrite(grounded, "WES-2026-A1B2C3D4 payment status is Pending. Verified time: Aug 14, 2026, 2:30 PM."),
    false
  );
  assert.equal(isSafeAiRewrite(grounded, "The payment is Paid."), false);
  assert.equal(
    isSafeAiRewrite(grounded, `${grounded} Source product: 42b65f73-e448-4de0-9655-ca9f76737f1e`),
    false
  );
});

test("WesBot migration preserves old conversations in staff-managed states and enforces sender identity", () => {
  const migration = readFileSync(
    new URL("../../prisma/migrations/20260814000000_add_wesbot_support/migration.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /WHEN "assigned_staff_id" IS NOT NULL THEN 'STAFF_ACTIVE'/);
  assert.match(migration, /ELSE 'WAITING_FOR_STAFF'/);
  assert.match(migration, /"sender_type" IN \('BOT', 'SYSTEM'\) AND "sender_id" IS NULL/);
  assert.match(migration, /"sender_type" IN \('STUDENT', 'STAFF'\) AND "sender_id" IS NOT NULL/);
});

test("WesBot replies are gated to bot-active conversations", () => {
  const service = readFileSync(path.resolve(process.cwd(), "src/services/message.service.ts"), "utf8");
  const wesbotService = readFileSync(path.resolve(process.cwd(), "src/services/wesbot.service.ts"), "utf8");
  assert.match(service, /conversation\.mode !== "BOT_ACTIVE"/);
  assert.match(service, /conversation\.mode === "BOT_ACTIVE" && env\.WESBOT_ENABLED/);
  assert.match(service, /mode: "WAITING_FOR_STAFF"/);
  assert.match(service, /conversation\.botReplyCount : 0/);
  assert.match(wesbotService, /const repeatCount = input\.repeatCount \+ 1/);
});

test("Staff takeover is atomic and only the current handler can reply", () => {
  const service = readFileSync(path.resolve(process.cwd(), "src/services/message.service.ts"), "utf8");
  assert.match(service, /CONVERSATION_ACCEPT_REQUIRED/);
  assert.match(service, /conversation\.assignedStaffId !== input\.senderId/);
  assert.match(service, /export async function takeOverConversation/);
  assert.match(service, /\.eq\("updated_at", conversation\.updatedAt\)/);
  assert.match(service, /CONVERSATION_OWNERSHIP_CHANGED/);
  assert.match(service, /SUPPORT_CONVERSATION_OWNERSHIP_TRANSFERRED/);
  assert.match(service, /insert_owned_staff_message/);
  assert.match(service, /input\.performedByRole !== "ADMIN" && conversation\.assignedStaffId !== input\.performedById/);
});

test("WesBot and Staff reply writes recheck ownership under a database row lock", () => {
  const service = readFileSync(path.resolve(process.cwd(), "src/services/message.service.ts"), "utf8");
  const migration = readFileSync(
    new URL("../../prisma/migrations/20260823000000_add_support_takeover_bot_guard/migration.sql", import.meta.url),
    "utf8"
  );

  assert.match(service, /insert_active_wesbot_reply/);
  assert.match(service, /if \(!botMessageData\) return null/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION "insert_active_wesbot_reply"/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION "insert_owned_staff_message"/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /"assigned_staff_id" IS DISTINCT FROM "p_staff_id"/);
  assert.match(migration, /REVOKE ALL ON FUNCTION "insert_owned_staff_message"[\s\S]*FROM authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION "insert_active_wesbot_reply"[\s\S]*TO service_role/);
});
