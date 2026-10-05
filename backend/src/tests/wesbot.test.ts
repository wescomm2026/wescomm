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
  shouldRecommendStaff,
  wesbotStaffEscalationTier
} from "../domain/wesbot.js";
import { redactWesbotAiContext, redactWesbotAiText } from "../domain/wesbot-ai-privacy.js";
import {
  classifyWesbotMessage,
  sanitizeWesbotRecordReference
} from "../services/wesbot-classifier.service.js";
import {
  buildWesbotEscalationReply,
  composeWesbotPlannedReply,
  isSafeAiRewrite,
  isSafeWesbotGeneralReply,
  productAnswer,
  productCandidateTerms,
  requiresImmediateStaffRecommendation,
  restoreWesbotGroundedPlaceholders,
  restoreWesbotPublicEmail,
  selectDirectWesbotFaq,
  validateWesbotPlanSelection,
  wesbotAnswerSimilarity,
  wesbotDraftDuplicatesRecentReply
} from "../services/wesbot.service.js";
import {
  rankWesbotFaqs,
  wesbotFactSourceId,
  wesbotFaqSourceId
} from "../services/wesbot-knowledge.service.js";

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
    assert.equal(routed.scope, "WESCOMM", message);
    assert.equal(routed.usedAi, false, message);
  }
});

test("plan selections cannot cite unknown facts or claim facts without a source", () => {
  const suppliedFactIds = [wesbotFaqSourceId("faq-1"), wesbotFactSourceId(0)];
  const base = {
    usedFactIds: [wesbotFaqSourceId("faq-1")],
    missingInformation: [] as string[],
    recommendStaff: false
  };

  assert.deepEqual(validateWesbotPlanSelection({
    plan: { ...base, strategy: "DIRECT_ANSWER" },
    suppliedFactIds
  }), { ok: true });

  assert.deepEqual(validateWesbotPlanSelection({
    plan: { ...base, strategy: "DIRECT_ANSWER", usedFactIds: ["faq:unknown"] },
    suppliedFactIds
  }), { ok: false, reason: "UNKNOWN_FACT_ID" });

  assert.deepEqual(validateWesbotPlanSelection({
    plan: { ...base, strategy: "RELATED_GUIDANCE", usedFactIds: [] },
    suppliedFactIds
  }), { ok: false, reason: "FACTUAL_CLAIM_WITHOUT_FACTS" });

  assert.deepEqual(validateWesbotPlanSelection({
    plan: { ...base, strategy: "CLARIFY_ONE_DETAIL", usedFactIds: [], missingInformation: ["reservation reference"] },
    suppliedFactIds
  }), { ok: true });

  assert.deepEqual(validateWesbotPlanSelection({
    plan: { ...base, strategy: "CLARIFY_ONE_DETAIL", usedFactIds: [], missingInformation: [] },
    suppliedFactIds
  }), { ok: false, reason: "CLARIFY_REQUIRES_ONE_DETAIL" });

  assert.deepEqual(validateWesbotPlanSelection({
    plan: { ...base, strategy: "CLARIFY_ONE_DETAIL", usedFactIds: [], missingInformation: ["reservation reference", "receipt code"] },
    suppliedFactIds
  }), { ok: false, reason: "CLARIFY_REQUIRES_ONE_DETAIL" });

  assert.deepEqual(validateWesbotPlanSelection({
    plan: { ...base, strategy: "STAFF_RECOMMENDED", usedFactIds: [], recommendStaff: false },
    suppliedFactIds
  }), { ok: false, reason: "STAFF_RECOMMENDATION_MISMATCH" });

  assert.deepEqual(validateWesbotPlanSelection({
    plan: { ...base, strategy: "STAFF_RECOMMENDED", usedFactIds: [], recommendStaff: true },
    suppliedFactIds
  }), { ok: true });
});

test("the server composes answers verbatim from cited facts, so invented policies cannot pass", () => {
  const factTextsById = new Map([
    [wesbotFaqSourceId("faq-refund"), "A paid cancellation is reviewed by Staff before any refund."],
    [wesbotFactSourceId(0), "WESCOMM is the Wesleyan University - Philippines commissary management system."]
  ]);
  const inventedPolicy = "Students may exchange any item without Staff approval.";

  const composed = composeWesbotPlannedReply({
    plan: {
      strategy: "DIRECT_ANSWER",
      usedFactIds: [wesbotFactSourceId(0)],
      missingInformation: [],
      recommendStaff: false
    },
    factTextsById,
    languageStyle: "clear English"
  });
  assert.equal(composed.answer, "WESCOMM is the Wesleyan University - Philippines commissary management system.");
  assert.doesNotMatch(composed.answer, new RegExp(inventedPolicy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const multiFact = composeWesbotPlannedReply({
    plan: {
      strategy: "RELATED_GUIDANCE",
      usedFactIds: [wesbotFactSourceId(0), wesbotFaqSourceId("faq-refund")],
      missingInformation: [],
      recommendStaff: false
    },
    factTextsById,
    languageStyle: "clear English"
  });
  assert.equal(
    multiFact.answer,
    "WESCOMM is the Wesleyan University - Philippines commissary management system. A paid cancellation is reviewed by Staff before any refund."
  );

  const clarify = composeWesbotPlannedReply({
    plan: {
      strategy: "CLARIFY_ONE_DETAIL",
      usedFactIds: [],
      missingInformation: ["reservation reference"],
      recommendStaff: false
    },
    factTextsById,
    languageStyle: "natural Taglish or Filipino"
  });
  assert.match(clarify.answer, /reservation reference/);

  const staff = composeWesbotPlannedReply({
    plan: {
      strategy: "STAFF_RECOMMENDED",
      usedFactIds: [wesbotFaqSourceId("faq-refund")],
      missingInformation: [],
      recommendStaff: true
    },
    factTextsById,
    languageStyle: "clear English"
  });
  assert.match(staff.answer, /A paid cancellation is reviewed by Staff before any refund/);
  assert.match(staff.answer, /Talk to Staff/);
});

test("only high-confidence unambiguous FAQ matches take the direct path", () => {
  const faq = (id: string, question: string, answer: string) => ({
    faq: {
      id,
      question,
      answer,
      category: "GENERAL",
      source: null,
      sourceVersion: null,
      variants: [] as { variant: string }[]
    },
    score: 0
  });

  const contained = [
    { ...faq("faq-pickup", "When can I pick up my reservation?", "Pickup follows the assigned window."), score: 111 },
    { ...faq("faq-hours", "What are the operating hours?", "10:00 AM to 4:30 PM."), score: 95 }
  ];
  assert.equal(selectDirectWesbotFaq("pick up my reservation", contained)?.faq.id, "faq-pickup");

  const weak = [{ ...faq("faq-reservation", "Reservations", "Reservations hold stock."), score: 18 }];
  assert.equal(selectDirectWesbotFaq("cancel", weak), null);

  const ambiguousHighScores = [
    { ...faq("faq-a", "How do I cancel a paid reservation?", "Paid cancellations need Staff review."), score: 111 },
    { ...faq("faq-b", "Can I get a refund?", "Refunds need Staff review."), score: 95 }
  ];
  assert.equal(selectDirectWesbotFaq("cancel paid reservation refund", ambiguousHighScores), null);

  const clearWinner = [
    { ...faq("faq-a", "How do I cancel a paid reservation?", "Paid cancellations need Staff review."), score: 90 },
    { ...faq("faq-b", "Can I get a refund?", "Refunds need Staff review."), score: 40 }
  ];
  assert.equal(selectDirectWesbotFaq("cancel paid reservation refund", clearWinner)?.faq.id, "faq-a");
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
  assert.equal(legacy.scope, "WESCOMM");
  assert.equal(legacy.usedAi, false);

  const outside = await classifyWesbotMessage({
    studentId: "00000000-0000-0000-0000-000000000001",
    message: "Who won the basketball game?"
  });
  assert.equal(outside.scope, "OUT_OF_SCOPE");
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

test("equivalent repeated questions share a concern key and escalate progressively", () => {
  const first = createWesbotConcernKey("PRODUCT_INQUIRY", "Available ba ang polo medium?");
  const second = createWesbotConcernKey("PRODUCT_INQUIRY", "Polo medium available?");
  assert.equal(first, second);
  assert.equal(shouldRecommendStaff(1), false);
  assert.equal(shouldRecommendStaff(2), true);
  assert.equal(shouldRecommendStaff(3), true);
  assert.equal(wesbotStaffEscalationTier(1), 0);
  assert.equal(wesbotStaffEscalationTier(2), 1);
  assert.equal(wesbotStaffEscalationTier(3), 2);
});

test("repeated and paraphrased replies are detected as duplicates before a second AI call", () => {
  const clarify = "Puwede kong i-check ang payment status ng reservation mo. Pakibigay ang reservation reference.";
  const clarifyParaphrase = "I-check ko ang payment status ng reservation mo. Kailangan ko ang reservation reference mo.";
  const statusAnswer = "Your reservation is Pending and no pickup window is assigned yet.";
  const statusParaphrase = "The reservation status is Pending, with no pickup window assigned.";
  const unrelated = "A paid cancellation needs Staff review before a refund.";

  assert.equal(wesbotAnswerSimilarity(clarify, clarify), 1);
  assert.equal(wesbotDraftDuplicatesRecentReply(clarify, [clarifyParaphrase]), true);
  assert.equal(wesbotDraftDuplicatesRecentReply(statusAnswer, [statusParaphrase]), true);
  assert.equal(wesbotDraftDuplicatesRecentReply(unrelated, [clarify, statusAnswer]), false);
  assert.equal(wesbotAnswerSimilarity("I couldn't find a reservation in your account.", "I couldn't find a receipt in your account.") < 0.8, true);

  const singleFaq = "A paid cancellation is reviewed by Staff before any refund.";
  const extendedFaq = `${singleFaq} Only Staff or Admin can verify or void a receipt.`;
  assert.equal(wesbotDraftDuplicatesRecentReply(extendedFaq, [singleFaq]), false);
});

test("strategy and staff recommendation stay consistent across the planner", () => {
  const service = readFileSync(path.resolve(process.cwd(), "src/services/wesbot.service.ts"), "utf8");
  assert.doesNotMatch(service, /staffRecommended:\s*false/);
  assert.match(service, /strategy: "STAFF_RECOMMENDED"/);
});

test("escalation replies never hand off automatically and recommend Staff", () => {
  const escalation = buildWesbotEscalationReply("Hindi ko makita payment ko", false);
  assert.match(escalation, /Talk to Staff/);
  assert.doesNotMatch(escalation, /queue|handoff|hand over/i);
  const strong = buildWesbotEscalationReply("Hindi ko makita payment ko", true);
  assert.match(strong, /strongly recommend/);
  assert.notEqual(strong, escalation);
});

test("ranked FAQ knowledge returns ids and scores instead of concatenated text", () => {
  const faqs = [
    {
      id: "faq-cancel-paid",
      question: "Can I cancel a paid reservation?",
      answer: "Paid cancellations go to Staff review before any refund.",
      category: "CANCELLATION",
      source: null,
      sourceVersion: null,
      variants: [{ variant: "Paid order cancellation" }]
    },
    {
      id: "faq-hours",
      question: "What are WESCOMM operating hours?",
      answer: "10:00 AM to 4:30 PM, closed on weekends.",
      category: "GENERAL",
      source: null,
      sourceVersion: null,
      variants: [{ variant: "Operating hours" }]
    }
  ];
  const ranked = rankWesbotFaqs("Pwede ko ba i-cancel ang paid reservation ko?", faqs);
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].faq.id, "faq-cancel-paid");
  assert.ok(ranked[0].score > 0);
  assert.equal(ranked.every((entry) => typeof entry.faq.id === "string" && typeof entry.score === "number"), true);
  assert.equal(wesbotFaqSourceId(ranked[0].faq.id), "faq:faq-cancel-paid");
  assert.equal(wesbotFactSourceId(3), "knowledge:3");
});

test("immediate Staff recommendation covers paid cancellations, missing records, and restrictions", () => {
  assert.equal(requiresImmediateStaffRecommendation({
    intent: "CANCELLATION_ELIGIBILITY",
    sourceReferences: ["account:reservations", "support:staff-review"],
    missingInformation: [],
    outcomeRecommendsStaff: true
  }), true);
  assert.equal(requiresImmediateStaffRecommendation({
    intent: "PAYMENT_STATUS",
    sourceReferences: ["account:reservations", "support:staff-review"],
    missingInformation: []
  }), true);
  assert.equal(requiresImmediateStaffRecommendation({
    intent: "RESERVATION_STATUS",
    sourceReferences: ["account:reservations"],
    missingInformation: ["student restriction"]
  }), true);
  assert.equal(requiresImmediateStaffRecommendation({
    intent: "PRODUCT_INQUIRY",
    sourceReferences: ["product:1", "inventory:live"],
    missingInformation: []
  }), false);
  assert.equal(requiresImmediateStaffRecommendation({
    intent: "GENERAL_SUPPORT",
    sourceReferences: ["support:clarification"],
    missingInformation: ["reservation reference"]
  }), false);
});

test("WesBot never hands off to Staff without an explicit student request", () => {
  const service = readFileSync(path.resolve(process.cwd(), "src/services/wesbot.service.ts"), "utf8");
  const handoffAssignments = service.match(/handoffRequested:\s*true/g) ?? [];
  assert.equal(handoffAssignments.length, 1);
  assert.match(service, /support:escalation/);
  assert.match(service, /buildWesbotEscalationReply/);
});

test("the classifier only routes and never composes the final conversational answer", () => {
  const classifier = readFileSync(path.resolve(process.cwd(), "src/services/wesbot-classifier.service.ts"), "utf8");
  assert.doesNotMatch(classifier, /conversationalReply/);
  assert.match(classifier, /needsClarification/);
  assert.match(classifier, /missingInformation/);
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
    audienceScope: "ALL_STUDENTS" as const,
    targetDepartments: [],
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

test("WesBot handles catalog typos and missing products without inventing facts", () => {
  const product = [{
    id: "nursing-uniform",
    name: "Nursing Uniform",
    description: null,
    imageUrl: null,
    price: "500.00",
    oldPrice: null,
    stock: 4,
    isOnSale: false,
    status: "IN_STOCK" as const,
    saleMode: "SIMPLE" as const,
    skuInventoryEnabled: false,
    inventorySetupRequired: false,
    createdAt: "2026-08-24T00:00:00.000Z",
    inventoryReconciledAt: "2026-08-24T00:00:00.000Z",
    audienceScope: "ALL_STUDENTS" as const,
    targetDepartments: [],
    category: { id: "category", name: "Uniforms", slug: "uniforms", iconUrl: null },
    aliases: [],
    variants: [],
    skus: []
  }] as Parameters<typeof productAnswer>[0];
  const entities = {
    productName: null,
    department: null,
    options: [],
    quantity: null,
    reservationReference: null,
    receiptCode: null,
    contextReference: null
  };

  assert.match(productAnswer(product, "Magkano ang Nursng Uniform?", entities).draft, /Nursing Uniform is/);
  assert.match(productAnswer(product, "Nursng", entities).draft, /possible catalog match: Nursing Uniform/);
  const missing = productAnswer([], "Magkano ang iPhone?", entities);
  assert.deepEqual(missing.sourceReferences, ["catalog:no-match"]);
  assert.match(missing.draft, /don't have a verified WESCOMM price or stock/);
  assert.doesNotMatch(missing.draft, /PHP|₱|\d+\.\d{2}/);
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

test("private account references use reversible single-use placeholders for AI wording", () => {
  const reservationDraft = "WES-2026-A1B2C3D4 is currently Pending.";
  assert.equal(
    restoreWesbotGroundedPlaceholders(reservationDraft, "Ang [RESERVATION_REFERENCE] ay kasalukuyang Pending."),
    "Ang WES-2026-A1B2C3D4 ay kasalukuyang Pending."
  );
  assert.equal(restoreWesbotGroundedPlaceholders(reservationDraft, "It is currently Pending."), null);
  assert.equal(
    restoreWesbotGroundedPlaceholders("No private reference here.", "Check [RESERVATION_REFERENCE]."),
    null
  );
});

test("general replies restore only the approved public email and reject invented contact values", () => {
  const facts = "Contact WESCOMM at wescomm2026@gmail.com. Open from 10:00 AM to 4:30 PM.";

  assert.equal(
    restoreWesbotPublicEmail("Contact [WESCOMM_PUBLIC_EMAIL]."),
    "Contact wescomm2026@gmail.com."
  );

  assert.equal(isSafeWesbotGeneralReply("Contact [wescomm_public_email].", facts), false);
  assert.equal(isSafeWesbotGeneralReply("Contact [EMAIL].", facts), false);
  assert.equal(isSafeWesbotGeneralReply("Contact [email].", facts), false);
  assert.equal(isSafeWesbotGeneralReply("Contact support@example.com.", facts), false);
  assert.equal(isSafeWesbotGeneralReply("Call us at 09171234567.", facts), false);

  assert.equal(isSafeWesbotGeneralReply("Contact wescomm2026@gmail.com.", facts), true);
});

test("Gemini loads lazily and grounded replies use the bounded generateText path", () => {
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
