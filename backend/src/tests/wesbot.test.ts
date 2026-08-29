import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createWesbotConcernKey,
  detectHighConfidenceWesbotIntent,
  detectWesbotIntent,
  extractReceiptCode,
  extractReservationReference,
  requestsHumanSupport,
  scoreWesbotTextMatch,
  shouldRecommendStaff
} from "../domain/wesbot.js";
import { redactWesbotAiContext, redactWesbotAiText } from "../domain/wesbot-ai-privacy.js";
import {
  classifyWesbotMessage,
  sanitizeWesbotConversationalReply,
  sanitizeWesbotRecordReference
} from "../services/wesbot-classifier.service.js";
import { isSafeAiRewrite, productAnswer, productCandidateTerms } from "../services/wesbot.service.js";

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

test("high-confidence routing covers semantic handoff phrases and exact account references", () => {
  for (const message of [
    "Please put me through to commissary personnel.",
    "I need a person, not an automated reply.",
    "Pwede tao na lang ang sumagot?",
    "Escalate this conversation to staff.",
    "Can someone from the commissary handle this?"
  ]) {
    assert.equal(detectHighConfidenceWesbotIntent(message)?.intent, "HUMAN_HANDOFF", message);
  }
  assert.equal(detectHighConfidenceWesbotIntent("Check WES-2026-A1B2C3D4")?.intent, "RESERVATION_STATUS");
  assert.equal(detectHighConfidenceWesbotIntent("Check RCT-2026-A1B2C3D4E5")?.intent, "RECEIPT_STATUS");
});

test("greetings and FAQ menus use the free deterministic path", async () => {
  for (const message of ["hello", "FAQ", "ano pwede itanong", "what can you do"]) {
    const detected = detectHighConfidenceWesbotIntent(message);
    assert.equal(detected?.intent, "GENERAL_SUPPORT", message);

    const routed = await classifyWesbotMessage({
      studentId: "00000000-0000-0000-0000-000000000001",
      message
    });
    assert.equal(routed.source, "DETERMINISTIC", message);
    assert.equal(routed.usedAi, false, message);
  }
});

test("AI conversational suggestions cannot introduce factual WESCOMM claims", () => {
  assert.equal(sanitizeWesbotConversationalReply({
    value: "Hi! I can help you check products, reservations, payments, receipts, pickup, or FAQs.",
    intent: "GENERAL_SUPPORT",
    needsClarification: false
  }), "Hi! I can help you check products, reservations, payments, receipts, pickup, or FAQs.");
  assert.equal(sanitizeWesbotConversationalReply({
    value: "The commissary opens at 8 and your payment is confirmed.",
    intent: "GENERAL_SUPPORT",
    needsClarification: false
  }), null);
  assert.equal(sanitizeWesbotConversationalReply({
    value: "Your order is ready for pickup.",
    intent: "RESERVATION_STATUS",
    needsClarification: false
  }), null);
});

test("semantic feature flag off preserves deterministic and legacy behavior without an AI call", async () => {
  const deterministic = await classifyWesbotMessage({
    studentId: "00000000-0000-0000-0000-000000000001",
    message: "Talk to a real person please"
  });
  assert.equal(deterministic.source, "DETERMINISTIC");
  assert.equal(deterministic.intent, "HUMAN_HANDOFF");
  assert.equal(deterministic.usedAi, false);

  const legacy = await classifyWesbotMessage({
    studentId: "00000000-0000-0000-0000-000000000001",
    message: "May stock ba ng WUP polo medium?"
  });
  assert.equal(legacy.source, "LEGACY");
  assert.equal(legacy.intent, "PRODUCT_INQUIRY");
  assert.equal(legacy.usedAi, false);
});

test("semantic record references must be present in the current message or recent context", () => {
  const context = [{ role: "student" as const, text: "Please check WES-2026-A1B2C3D4" }];
  assert.equal(sanitizeWesbotRecordReference({
    message: "What is its status?",
    context,
    candidate: "WES-2026-A1B2C3D4",
    type: "reservation"
  }), "WES-2026-A1B2C3D4");
  assert.equal(sanitizeWesbotRecordReference({
    message: "What is its status?",
    context,
    candidate: "WES-2026-DEADBEEF",
    type: "reservation"
  }), "WES-2026-A1B2C3D4");
  assert.equal(sanitizeWesbotRecordReference({
    message: "What is its status?",
    context: [
      ...context,
      { role: "student", text: "Also WES-2026-FFEEDDCC" }
    ],
    candidate: "WES-2026-DEADBEEF",
    type: "reservation"
  }), null);
  assert.equal(sanitizeWesbotRecordReference({
    message: "Check RCT-2026-A1B2C3D4E5",
    context: [],
    candidate: null,
    type: "receipt"
  }), "RCT-2026-A1B2C3D4E5");
});

test("reservation and receipt references are extracted exactly", () => {
  assert.equal(extractReservationReference("check wes-2026-a1b2c3d4 please"), "WES-2026-A1B2C3D4");
  assert.equal(extractReceiptCode("receipt: rct-2026-a1b2c3d4e5"), "RCT-2026-A1B2C3D4E5");
  assert.equal(extractReservationReference("WES-2026-NOT-A-CODE"), null);
  assert.equal(extractReceiptCode("RCT-2026-123"), null);
});

test("Gemini-bound WesBot text removes direct identifiers while preserving intent", () => {
  const redacted = redactWesbotAiText(
    "Email me at student@wesleyan.edu.ph or 09171234567 about WES-2026-A1B2C3D4 and RCT-2026-A1B2C3D4E5."
  );
  assert.equal(
    redacted,
    "Email me at [EMAIL] or [PHONE] about [RESERVATION_REFERENCE] and [RECEIPT_CODE]."
  );
  assert.deepEqual(redactWesbotAiContext([
    { role: "student" as const, text: "My number is 2026123456" }
  ]), [
    { role: "student", text: "My number is [LONG_NUMBER]" }
  ]);
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

test("WesBot product lookup sends only discriminating bounded terms to the database", () => {
  const entities = {
    productName: null,
    department: null,
    options: [],
    quantity: null,
    reservationReference: null,
    receiptCode: null,
    contextReference: null
  };
  assert.deepEqual(productCandidateTerms("BSBA women's uniform set large red", entities), ["bsba"]);
  assert.deepEqual(productCandidateTerms("May red polo ba na medium?", entities), ["polo"]);
  assert.deepEqual(productCandidateTerms("PE shirt XL", entities), ["pe", "shirt"]);
  assert.deepEqual(productCandidateTerms("May large ba?", entities), []);
});

test("WesBot grounds option inventory by valid SKU combination and handles cloth-only items", () => {
  const common = {
    description: null,
    imageUrl: null,
    oldPrice: null,
    isOnSale: false,
    status: "IN_STOCK" as const,
    createdAt: "2026-08-24T00:00:00.000Z",
    inventoryReconciledAt: "2026-08-24T00:00:00.000Z",
    category: { id: "category", name: "Uniforms", slug: "uniforms", iconUrl: null },
    aliases: []
  };
  const optionProduct = [{
    ...common,
    id: "options-product",
    name: "Nursing Uniform",
    price: "500.00",
    stock: 3,
    saleMode: "OPTIONS" as const,
    skuInventoryEnabled: true,
    inventorySetupRequired: false,
    variants: [
      { optionName: "Size", optionValue: "M", stock: 2 },
      { optionName: "Color", optionValue: "Red", stock: 2 },
      { optionName: "Color", optionValue: "Blue", stock: 1 }
    ],
    skus: [{
      id: "sku-red-m",
      stock: 2,
      lowStockThreshold: 1,
      options: [
        { optionName: "Size", optionValue: "M" },
        { optionName: "Color", optionValue: "Red" }
      ]
    }]
  }] as Parameters<typeof productAnswer>[0];
  const entities = {
    productName: "Nursing Uniform",
    department: null,
    options: [],
    quantity: null,
    reservationReference: null,
    receiptCode: null,
    contextReference: null
  };

  assert.match(productAnswer(optionProduct, "Nursing Uniform M Red", entities).draft, /Size M \+ Color Red: 2 pieces/);
  assert.match(productAnswer(optionProduct, "Nursing Uniform M Blue", entities).draft, /no configured Size M \+ Color Blue combination/);

  const clothProduct = [{
    ...common,
    id: "cloth-product",
    name: "Uniform Cloth",
    price: "125.00",
    stock: 8,
    saleMode: "CLOTH_ONLY" as const,
    skuInventoryEnabled: false,
    inventorySetupRequired: false,
    variants: [],
    skus: []
  }] as Parameters<typeof productAnswer>[0];
  assert.match(productAnswer(clothProduct, "Uniform Cloth medium blue", entities).draft, /8 cloth units.*no selectable size or color combination/);
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

test("Gemini loads lazily and grounded polish stays to one provider call", () => {
  const provider = readFileSync(path.resolve(process.cwd(), "src/services/wesbot-ai-provider.ts"), "utf8");
  const service = readFileSync(path.resolve(process.cwd(), "src/services/wesbot.service.ts"), "utf8");
  assert.doesNotMatch(provider, /^import .*@ai-sdk\/google/m);
  assert.match(provider, /await import\("@ai-sdk\/google"\)/);
  assert.match(service, /generateText\(/);
  assert.doesNotMatch(service, /ToolLoopAgent|isStepCount\(2\)/);
  assert.match(service, /operation: "GROUNDED_REPLY"/);
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
  assert.match(service, /suggestedActions: reply\.suggestedActions/);
  assert.match(service, /mode: "WAITING_FOR_STAFF"/);
  assert.match(service, /previousConcernKey: conversation\.lastConcernKey/);
  assert.match(service, /previousReplyCount: conversation\.botReplyCount/);
  assert.match(wesbotService, /concernKey === input\.previousConcernKey \? input\.previousReplyCount \+ 1 : 1/);
});

test("semantic knowledge migration is server-only and indexed for lookup", () => {
  const migration = readFileSync(
    new URL("../../prisma/migrations/20260829000000_add_wesbot_semantic_knowledge/migration.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "product_aliases"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "faq_variants"/);
  assert.match(migration, /product_aliases_normalized_alias_trgm_idx/);
  assert.match(migration, /faq_variants_normalized_text_trgm_idx/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE "product_aliases" FROM PUBLIC/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE "faq_variants" FROM %I/);
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
