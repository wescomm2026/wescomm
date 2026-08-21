import { createHash } from "node:crypto";
import { ToolLoopAgent, isStepCount, tool } from "ai";
import { z } from "zod";
import { env } from "../config/env.js";
import { assertStudentCanCancelReservation } from "../domain/student-reservation-cancellation.js";
import {
  createWesbotConcernKey,
  detectWesbotIntent,
  extractReceiptCode,
  extractReservationReference,
  formatWesbotCurrency,
  formatWesbotDateTime,
  normalizeWesbotText,
  scoreWesbotTextMatch,
  shouldRecommendStaff,
  tokenizeWesbotText,
  type WesbotIntent
} from "../domain/wesbot.js";
import { listPublishedFaqs } from "./faq.service.js";
import { listProducts } from "./product.service.js";
import { listReceipts } from "./receipt.service.js";
import { listReservations } from "./reservation.service.js";

type WesbotProduct = Awaited<ReturnType<typeof listProducts>>[number];
type WesbotReservation = Awaited<ReturnType<typeof listReservations>>[number];
type WesbotReceipt = Awaited<ReturnType<typeof listReceipts>>[number];

export type WesbotReply = {
  message: string;
  intent: WesbotIntent;
  category: string;
  concernKey: string;
  sourceReferences: string[];
  handoffRequested: boolean;
  staffRecommended: boolean;
  usedAi: boolean;
};

type GroundedAnswer = Omit<WesbotReply, "message" | "usedAi"> & {
  draft: string;
};

const groundedAnswerContextSchema = z.object({
  draft: z.string().min(1).max(1800),
  intent: z.string().min(1).max(64),
  sources: z.array(z.string().max(160)).max(8)
});

const groundedAnswerTool = tool({
  description: "Return the verified WESCOMM answer and its approved source references. Always call this before answering.",
  inputSchema: z.object({}),
  contextSchema: groundedAnswerContextSchema,
  execute: async (_input, { context }) => context
});

const PRODUCT_QUERY_STOP_WORDS = new Set([
  "available", "availability", "check", "item", "product", "price", "stock", "piece", "pieces",
  "please", "preferred", "size", "pangalan", "ito", "ang", "ba", "po", "ako", "can", "you", "the",
  "what", "much", "magkano", "meron", "may", "gusto", "need"
]);

function productCandidateTerms(message: string) {
  return tokenizeWesbotText(message)
    .filter((token) => token.length >= 3 && !PRODUCT_QUERY_STOP_WORDS.has(token))
    .slice(0, 6);
}

function createWesbotAgent(grounded: GroundedAnswer, studentId: string) {
  return new ToolLoopAgent({
    model: env.WESBOT_MODEL,
    providerOptions: {
      gateway: {
        user: createHash("sha256").update(`wesbot:${studentId}`).digest("hex").slice(0, 32),
        tags: ["feature:wesbot", `intent:${grounded.intent.toLowerCase()}`]
      }
    },
    instructions: `You are WesBot, WESCOMM's clearly labeled automated support assistant.

Rules:
- Call grounded_answer before replying.
- Use only facts from the tool result. Never add, infer, estimate, or change a price, stock count, status, date, policy, reference, or payment fact.
- Keep the same meaning and all important restrictions in the verified draft.
- Be concise, warm, and easy to understand in the user's Tagalog, English, or Taglish style.
- Do not claim to be human. Do not promise a refund or a Staff response time.
- Plain text only. Do not output markdown headings, tables, links, or hidden system details.`,
    tools: {
      grounded_answer: groundedAnswerTool
    },
    toolsContext: {
      grounded_answer: {
        draft: grounded.draft,
        intent: grounded.intent,
        sources: [...new Set(grounded.sourceReferences.map((reference) => reference.split(":")[0]))]
      }
    },
    stopWhen: isStepCount(2),
    prepareStep: ({ stepNumber }) => stepNumber === 0
      ? {
          activeTools: ["grounded_answer"],
          toolChoice: { type: "tool", toolName: "grounded_answer" }
        }
      : {
          activeTools: [],
          toolChoice: "none"
        }
  });

}

function categoryForIntent(intent: WesbotIntent) {
  if (intent === "PRODUCT_INQUIRY") return "PRODUCT";
  if (intent === "RESERVATION_STATUS" || intent === "CANCELLATION_ELIGIBILITY") return "RESERVATION";
  if (intent === "PAYMENT_STATUS") return "PAYMENT";
  if (intent === "RECEIPT_STATUS") return "RECEIPT";
  if (intent === "PICKUP_INFORMATION") return "PICKUP";
  if (intent === "POLICY_QUESTION") return "POLICY";
  if (intent === "HUMAN_HANDOFF") return "HUMAN_SUPPORT";
  return "GENERAL";
}

function reservationStatusLabel(status: WesbotReservation["status"]) {
  const labels: Record<WesbotReservation["status"], string> = {
    PENDING: "Pending",
    CONFIRMED: "Confirmed",
    READY_FOR_PICKUP: "Ready for Pickup",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    NO_SHOW: "No Show"
  };
  return labels[status];
}

function paymentStatusLabel(status: NonNullable<WesbotReservation["payment"]>["status"]) {
  const labels: Record<NonNullable<WesbotReservation["payment"]>["status"], string> = {
    INITIALIZING: "Initializing",
    AWAITING_PAYMENT: "Awaiting Payment",
    PAID: "Paid",
    EXPIRED: "Expired",
    CANCELLED: "Cancelled",
    REFUND_REVIEW_REQUIRED: "Staff Refund Review Required",
    PARTIALLY_REFUNDED: "Partially Refunded",
    REFUNDED: "Refunded"
  };
  return labels[status];
}

function selectReservation(reservations: WesbotReservation[], message: string) {
  const requestedReference = extractReservationReference(message);
  if (requestedReference) {
    return {
      requestedReference,
      reservation: reservations.find((entry) => entry.referenceCode.toUpperCase() === requestedReference) ?? null
    };
  }

  const active = reservations.find((entry) => !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(entry.status));
  return { requestedReference: null, reservation: active ?? reservations[0] ?? null };
}

function productSearchText(product: WesbotProduct) {
  return [
    product.name,
    product.description ?? "",
    product.category?.name ?? "",
    ...product.variants.flatMap((variant) => [variant.optionName, variant.optionValue])
  ].join(" ");
}

function findProductMatches(products: WesbotProduct[], message: string) {
  return products
    .map((product) => ({ product, score: scoreWesbotTextMatch(message, productSearchText(product)) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.product.name.localeCompare(right.product.name))
    .slice(0, 5);
}

function requestedVariants(product: WesbotProduct, message: string) {
  const normalized = normalizeWesbotText(message);
  const tokens = new Set(tokenizeWesbotText(message));
  return product.variants.filter((variant) => {
    const value = normalizeWesbotText(variant.optionValue);
    return value.length > 1 && (tokens.has(value) || normalized.includes(value));
  });
}

function productAnswer(products: WesbotProduct[], message: string): Pick<GroundedAnswer, "draft" | "sourceReferences"> {
  const matches = findProductMatches(products, message);
  if (!matches.length) {
    return {
      draft: "Please tell me the item name, course or department, and preferred size so I can check the live WESCOMM catalog.",
      sourceReferences: ["catalog:products"]
    };
  }

  const best = matches[0];
  const nearMatches = matches.filter((entry) => entry.score >= best.score - 4);
  if (nearMatches.length > 1 && best.score < 30) {
    return {
      draft: `I found several possible items: ${nearMatches.slice(0, 4).map(({ product }) => `${product.name} (${formatWesbotCurrency(product.price)})`).join(", ")}. Which one would you like me to check?`,
      sourceReferences: nearMatches.slice(0, 4).map(({ product }) => `product:${product.id}`)
    };
  }

  const product = best.product;
  const variants = requestedVariants(product, message);
  if (variants.length) {
    const details = variants.map((variant) => `${variant.optionName} ${variant.optionValue}: ${variant.stock} piece${variant.stock === 1 ? "" : "s"}`).join(", ");
    return {
      draft: `${product.name} is ${formatWesbotCurrency(product.price)}. Current live availability — ${details}. ${variants.some((variant) => variant.stock > 0) ? "At least one requested option is available." : "The requested option is currently out of stock."}`,
      sourceReferences: [`product:${product.id}`, "inventory:live"]
    };
  }

  if (product.variants.length) {
    const available = product.variants.filter((variant) => variant.stock > 0).slice(0, 8);
    const variantText = available.length
      ? available.map((variant) => `${variant.optionValue} (${variant.stock})`).join(", ")
      : "no variants currently in stock";
    return {
      draft: `${product.name} is ${formatWesbotCurrency(product.price)}. Available options and current stock: ${variantText}.`,
      sourceReferences: [`product:${product.id}`, "inventory:live"]
    };
  }

  return {
    draft: `${product.name} is ${formatWesbotCurrency(product.price)} and currently has ${product.stock} piece${product.stock === 1 ? "" : "s"} in stock.`,
    sourceReferences: [`product:${product.id}`, "inventory:live"]
  };
}

function reservationStatusAnswer(reservations: WesbotReservation[], message: string) {
  const selected = selectReservation(reservations, message);
  if (!selected.reservation) {
    return selected.requestedReference
      ? `I couldn't find ${selected.requestedReference} in your account. Check the code or ask Staff for help.`
      : "You do not have a reservation I can verify right now.";
  }

  const reservation = selected.reservation;
  const pickupStart = formatWesbotDateTime(reservation.pickupStart);
  const pickupEnd = formatWesbotDateTime(reservation.pickupEnd);
  const pickup = pickupStart && pickupEnd ? ` Pickup window: ${pickupStart} to ${pickupEnd}.` : " No pickup window has been assigned yet.";
  return `${reservation.referenceCode} is currently ${reservationStatusLabel(reservation.status)}.${pickup}`;
}

function cancellationAnswer(reservations: WesbotReservation[], message: string) {
  const selected = selectReservation(reservations, message);
  if (!selected.reservation) {
    return selected.requestedReference
      ? `I couldn't find ${selected.requestedReference} in your account. I can't verify whether it can be cancelled.`
      : "I couldn't find a reservation in your account to check for cancellation.";
  }

  const reservation = selected.reservation;
  try {
    assertStudentCanCancelReservation({
      studentId: reservation.studentId,
      reservationStudentId: reservation.studentId,
      currentStatus: reservation.status,
      nextStatus: "CANCELLED",
      paymentMethod: reservation.paymentMethod,
      paymentStatus: reservation.payment?.status ?? null
    });
    return `${reservation.referenceCode} is still Pending and has no payment issue that blocks self-cancellation. You may cancel it from My Reservations.`;
  } catch {
    if (reservation.status !== "PENDING") {
      return `${reservation.referenceCode} is already ${reservationStatusLabel(reservation.status)}, so you can no longer cancel it directly. Please use Talk to Staff if cancellation review is needed.`;
    }
    if (reservation.payment?.status === "PAID") {
      return `${reservation.referenceCode} has a successful Online GCash payment. Do not self-cancel it; authorized Staff or Admin must review the cancellation and refund.`;
    }
    return `${reservation.referenceCode} cannot be self-cancelled because its payment state requires Staff review. Please use Talk to Staff.`;
  }
}

function paymentAnswer(reservations: WesbotReservation[], message: string) {
  const selected = selectReservation(reservations, message);
  if (!selected.reservation) {
    return selected.requestedReference
      ? `I couldn't find ${selected.requestedReference} in your account, so I can't verify its payment.`
      : "I couldn't find a reservation in your account to check for payment.";
  }

  const reservation = selected.reservation;
  if (!reservation.payment) {
    if (reservation.paymentMethod === "PAY_AT_COMMISSARY" || reservation.paymentMethod === "CASH") {
      return `${reservation.referenceCode} is set to Pay at Commissary. No online payment is recorded.`;
    }
    return `${reservation.referenceCode} has no verified online payment record yet.`;
  }

  const paidAt = formatWesbotDateTime(reservation.payment.paidAt);
  return `${reservation.referenceCode} payment status is ${paymentStatusLabel(reservation.payment.status)}.${paidAt ? ` Verified paid time: ${paidAt}.` : ""}`;
}

function receiptAnswer(receipts: WesbotReceipt[], message: string) {
  const requestedCode = extractReceiptCode(message);
  const receipt = requestedCode
    ? receipts.find((entry) => entry.receiptCode.toUpperCase() === requestedCode)
    : receipts[0];

  if (!receipt) {
    return requestedCode
      ? `I couldn't find ${requestedCode} in your account. Check the code or use Talk to Staff.`
      : "You do not have a digital receipt I can verify right now.";
  }

  return `${receipt.receiptCode} is currently ${String(receipt.status).replaceAll("_", " ")}. It was issued on ${formatWesbotDateTime(receipt.issuedAt) ?? "the recorded issue date"} for ${formatWesbotCurrency(receipt.totalAmount)}.`;
}

function pickupAnswer(reservations: WesbotReservation[], message: string) {
  const selected = selectReservation(reservations, message);
  if (!selected.reservation) return "I couldn't find an active reservation with a pickup schedule in your account.";

  const reservation = selected.reservation;
  const start = formatWesbotDateTime(reservation.pickupStart);
  const end = formatWesbotDateTime(reservation.pickupEnd);
  if (!start || !end) return `${reservation.referenceCode} has no assigned pickup window yet. Please wait for confirmation or ask Staff.`;
  return `${reservation.referenceCode} has a pickup window from ${start} to ${end}. Current reservation status: ${reservationStatusLabel(reservation.status)}.`;
}

async function knowledgeAnswer(message: string) {
  const faqs = await listPublishedFaqs();
  const matches = faqs
    .map((faq) => ({ faq, score: scoreWesbotTextMatch(message, `${faq.question} ${faq.answer} ${faq.category ?? ""}`) }))
    .filter((entry) => entry.score >= 10)
    .sort((left, right) => right.score - left.score);

  return matches[0]
    ? {
        answer: matches[0].faq.answer,
        source: `faq:${matches[0].faq.id}`
      }
    : null;
}

async function buildGroundedAnswer(input: {
  studentId: string;
  message: string;
  repeatCount: number;
}): Promise<GroundedAnswer> {
  const intent = detectWesbotIntent(input.message);
  const category = categoryForIntent(intent);
  const concernKey = createWesbotConcernKey(intent, input.message);
  const repeatCount = input.repeatCount + 1;
  const staffRecommended = shouldRecommendStaff(repeatCount);

  if (intent === "HUMAN_HANDOFF") {
    return {
      draft: "Of course. I’ll place this conversation in the Commissary Staff queue now. WesBot will stop sending automatic answers once the handoff starts.",
      intent,
      category,
      concernKey,
      sourceReferences: ["support:handoff"],
      handoffRequested: true,
      staffRecommended: false
    };
  }

  let draft: string;
  let sourceReferences: string[];

  if (intent === "PRODUCT_INQUIRY") {
    const candidateTerms = productCandidateTerms(input.message);
    const products = candidateTerms.length
      ? await listProducts({ candidateTerms, limit: 25 })
      : [];
    const answer = productAnswer(products, input.message);
    draft = answer.draft;
    sourceReferences = answer.sourceReferences;
  } else if (intent === "RESERVATION_STATUS" || intent === "CANCELLATION_ELIGIBILITY" || intent === "PAYMENT_STATUS" || intent === "PICKUP_INFORMATION") {
    const referenceCode = extractReservationReference(input.message) ?? undefined;
    const reservations = await listReservations(input.studentId, "STUDENT", {
      referenceCode,
      limit: referenceCode ? 1 : 3
    });
    if (intent === "CANCELLATION_ELIGIBILITY") draft = cancellationAnswer(reservations, input.message);
    else if (intent === "PAYMENT_STATUS") draft = paymentAnswer(reservations, input.message);
    else if (intent === "PICKUP_INFORMATION") draft = pickupAnswer(reservations, input.message);
    else draft = reservationStatusAnswer(reservations, input.message);
    sourceReferences = ["account:reservations"];
  } else if (intent === "RECEIPT_STATUS") {
    const receiptCode = extractReceiptCode(input.message) ?? undefined;
    const receipts = await listReceipts(input.studentId, "STUDENT", {
      receiptCode,
      limit: receiptCode ? 1 : 3
    });
    draft = receiptAnswer(receipts, input.message);
    sourceReferences = ["account:receipts"];
  } else {
    const knowledge = await knowledgeAnswer(input.message);
    if (knowledge) {
      draft = knowledge.answer;
      sourceReferences = [knowledge.source];
    } else if (/^(hi|hello|hey|good\s+(?:morning|afternoon|evening)|kumusta|kamusta)\b/.test(normalizeWesbotText(input.message))) {
      draft = "Hi! I’m WesBot, WESCOMM’s automated assistant. I can check products, live availability, your reservations, payments, receipts, pickup information, and approved FAQs. You can also ask to talk to Staff anytime.";
      sourceReferences = ["support:capabilities"];
    } else {
      draft = "I couldn't verify a specific answer from the WESCOMM catalog, your account records, or the published FAQs. Please add an item name or reference code, or choose Talk to Staff.";
      sourceReferences = ["support:fallback"];
    }
  }

  if (staffRecommended) {
    draft += " It looks like this concern may need Staff assistance. You can choose Talk to Staff and I’ll hand over this conversation.";
  }

  return {
    draft,
    intent,
    category,
    concernKey,
    sourceReferences,
    handoffRequested: false,
    staffRecommended
  };
}

function factTokens(value: string) {
  return new Set(value.toUpperCase().match(/\b(?:WES-\d{4}-[A-F0-9]{8}|RCT-\d{4}-[A-F0-9]{10}|\d+(?:\.\d+)?)\b/g) ?? []);
}

const AI_CRITICAL_FACT_PHRASES = [
  "awaiting payment",
  "staff refund review required",
  "partially refunded",
  "ready for pickup",
  "pay at commissary",
  "online gcash",
  "out of stock",
  "no pickup window",
  "cannot",
  "can no longer",
  "may cancel",
  "initializing",
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "expired",
  "refunded",
  "paid"
] as const;

function criticalFactPhrases(value: string) {
  const normalized = ` ${normalizeWesbotText(value)} `;
  return new Set(AI_CRITICAL_FACT_PHRASES.filter((phrase) => normalized.includes(` ${phrase} `)));
}

function sameSet(left: Set<string>, right: Set<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export function isSafeAiRewrite(draft: string, candidate: string) {
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length > 1800) return false;
  if (/\b(?:product|faq|account|inventory|support):|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(trimmed)) {
    return false;
  }
  return sameSet(factTokens(draft), factTokens(trimmed))
    && sameSet(criticalFactPhrases(draft), criticalFactPhrases(trimmed));
}

function replyLanguageStyle(message: string) {
  const normalized = normalizeWesbotText(message);
  return /\b(?:ako|ang|ano|ba|bayad|gusto|kailan|ko|may|meron|ng|paki|po|pwede|sa|yung)\b/.test(normalized)
    ? "natural Taglish or Filipino"
    : "clear English";
}

async function optionallyRewriteWithAi(input: { studentId: string; userMessage: string; grounded: GroundedAnswer }) {
  if (!env.WESBOT_AI_ENABLED) return null;

  try {
    const result = await createWesbotAgent(input.grounded, input.studentId).generate({
      prompt: `Rewrite the verified grounded answer in ${replyLanguageStyle(input.userMessage)}. Preserve every fact, number, reference, status, and restriction.`
    });
    return isSafeAiRewrite(input.grounded.draft, result.text) ? result.text.trim() : null;
  } catch (error) {
    const detail = error instanceof Error ? error.name : "unknown";
    console.warn(`WesBot AI rewrite unavailable; using grounded fallback (${detail}).`);
    return null;
  }
}

export async function resolveWesbotReply(input: {
  studentId: string;
  message: string;
  repeatCount: number;
}) {
  const grounded = await buildGroundedAnswer(input);
  const aiReply = grounded.handoffRequested
    ? null
    : await optionallyRewriteWithAi({ studentId: input.studentId, userMessage: input.message, grounded });

  return {
    message: aiReply ?? grounded.draft,
    intent: grounded.intent,
    category: grounded.category,
    concernKey: grounded.concernKey,
    sourceReferences: grounded.sourceReferences,
    handoffRequested: grounded.handoffRequested,
    staffRecommended: grounded.staffRecommended,
    usedAi: Boolean(aiReply)
  } satisfies WesbotReply;
}

export function buildWesbotHandoffSummary(input: {
  subject: string;
  intent?: string | null;
  studentMessages: string[];
  reason: string;
}) {
  const recentMessages = input.studentMessages
    .map((message) => message.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(-3)
    .map((message) => message.slice(0, 220));
  const category = input.intent ? input.intent.replaceAll("_", " ").toLowerCase() : "general support";
  return [
    `Topic: ${input.subject.slice(0, 120)}.`,
    `Category: ${category}.`,
    `Escalation: ${input.reason.slice(0, 180)}.`,
    recentMessages.length ? `Recent student messages: ${recentMessages.join(" | ")}` : null
  ].filter(Boolean).join(" ").slice(0, 1000);
}
