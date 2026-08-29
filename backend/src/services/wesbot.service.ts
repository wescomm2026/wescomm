import { generateText, type LanguageModelUsage } from "ai";
import { env } from "../config/env.js";
import { redactWesbotAiText } from "../domain/wesbot-ai-privacy.js";
import { assertStudentCanCancelReservation } from "../domain/student-reservation-cancellation.js";
import {
  createWesbotConcernKey,
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
import { listProducts } from "./product.service.js";
import { listReceipts } from "./receipt.service.js";
import { listReservations } from "./reservation.service.js";
import {
  classifyWesbotMessage,
  type WesbotContextMessage,
  type WesbotEntities,
  type WesbotRoutingDecision,
  type WesbotSuggestedActionId
} from "./wesbot-classifier.service.js";
import { listPublishedWesbotFaqs } from "./wesbot-knowledge.service.js";
import { getWesbotModel } from "./wesbot-ai-provider.js";
import {
  assertWesbotAiBudgetAvailable,
  recordWesbotAiUsage,
  WesbotAiBudgetExceededError,
  wesbotAiErrorCode
} from "./wesbot-ai-usage.service.js";

type WesbotProduct = Awaited<ReturnType<typeof listProducts>>[number];
type WesbotReservation = Awaited<ReturnType<typeof listReservations>>["items"][number];
type WesbotReceipt = Awaited<ReturnType<typeof listReceipts>>["items"][number];

export type WesbotReply = {
  message: string;
  intent: WesbotIntent;
  category: string;
  concernKey: string;
  sourceReferences: string[];
  handoffRequested: boolean;
  staffRecommended: boolean;
  usedAi: boolean;
  routing: WesbotRoutingDecision;
  suggestedActions: WesbotSuggestedAction[];
};

export type WesbotSuggestedAction = {
  id: WesbotSuggestedActionId;
  label: string;
  message: string;
};

type GroundedAnswer = Omit<WesbotReply, "message" | "usedAi" | "routing"> & {
  draft: string;
};

const SUGGESTED_ACTIONS: Record<WesbotSuggestedActionId, WesbotSuggestedAction> = {
  PRODUCTS: { id: "PRODUCTS", label: "Products", message: "Ano ang available na products?" },
  RESERVATIONS: { id: "RESERVATIONS", label: "My reservation", message: "Ano na ang status ng reservation ko?" },
  PAYMENTS: { id: "PAYMENTS", label: "GCash payment", message: "Paki-check ang status ng GCash payment ko." },
  RECEIPTS: { id: "RECEIPTS", label: "My receipt", message: "Paki-check ang latest receipt ko." },
  PICKUP: { id: "PICKUP", label: "Pickup", message: "Kailan ko puwedeng i-pick up ang reservation ko?" },
  CANCELLATION: { id: "CANCELLATION", label: "Cancellation", message: "Puwede ko pa bang i-cancel ang reservation ko?" },
  FAQ: { id: "FAQ", label: "Browse FAQs", message: "FAQ" },
  STAFF: { id: "STAFF", label: "Talk to Staff", message: "I want to talk to Staff." }
};

function suggestedActions(ids: WesbotSuggestedActionId[]) {
  return [...new Set(ids)].slice(0, 4).map((id) => SUGGESTED_ACTIONS[id]);
}

const PRODUCT_QUERY_STOP_WORDS = new Set([
  "available", "availability", "check", "item", "product", "price", "stock", "piece", "pieces",
  "please", "preferred", "size", "pangalan", "ito", "ang", "ba", "po", "ako", "can", "you", "the",
  "what", "much", "magkano", "meron", "may", "gusto", "need"
]);

const PRODUCT_NON_DISCRIMINATING_TERMS = new Set([
  "uniform", "uniforms", "set", "sets", "men", "mens", "women", "womens", "boy", "boys", "girl", "girls",
  "size", "sizes", "color", "colors", "small", "medium", "large", "xs", "xl", "xxl", "xxxl",
  "red", "blue", "black", "white", "green", "yellow", "gray", "grey", "navy"
]);

export function productCandidateTerms(message: string, entities: WesbotEntities) {
  const tokens = tokenizeWesbotText([
    message,
    entities.productName ?? "",
    entities.department ?? ""
  ].join(" "))
    .filter((token) => (token.length >= 3 || token === "pe" || token === "id") && !PRODUCT_QUERY_STOP_WORDS.has(token));
  return [...new Set(tokens)]
    .filter((token) => !PRODUCT_NON_DISCRIMINATING_TERMS.has(token))
    .slice(0, 3);
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
    ...product.aliases,
    ...product.variants.flatMap((variant) => [variant.optionName, variant.optionValue]),
    ...product.skus.flatMap((sku) => sku.options.flatMap((option) => [option.optionName, option.optionValue]))
  ].join(" ");
}

function findProductMatches(products: WesbotProduct[], message: string) {
  return products
    .map((product) => ({ product, score: scoreWesbotTextMatch(message, productSearchText(product)) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.product.name.localeCompare(right.product.name))
    .slice(0, 5);
}

function requestedProductOptions(product: WesbotProduct, message: string, entities: WesbotEntities) {
  const normalized = normalizeWesbotText(message);
  const padded = ` ${normalized} `;
  const requested = new Map<string, { optionName: string; optionValue: string }>();

  for (const entity of entities.options) {
    const entityName = normalizeWesbotText(entity.name);
    const entityValue = normalizeWesbotText(entity.value);
    const variant = product.variants.find((candidate) => (
      normalizeWesbotText(candidate.optionName) === entityName
      && normalizeWesbotText(candidate.optionValue) === entityValue
    ));
    if (variant) requested.set(entityName, { optionName: variant.optionName, optionValue: variant.optionValue });
  }

  for (const variant of product.variants) {
    const optionName = normalizeWesbotText(variant.optionName);
    const optionValue = normalizeWesbotText(variant.optionValue);
    if (!optionValue || requested.has(optionName)) continue;
    if (padded.includes(` ${optionValue} `)) {
      requested.set(optionName, { optionName: variant.optionName, optionValue: variant.optionValue });
    }
  }
  return [...requested.values()];
}

function skuMatchesOptions(sku: WesbotProduct["skus"][number], options: Array<{ optionName: string; optionValue: string }>) {
  return options.every((requested) => sku.options.some((option) => (
    normalizeWesbotText(option.optionName) === normalizeWesbotText(requested.optionName)
    && normalizeWesbotText(option.optionValue) === normalizeWesbotText(requested.optionValue)
  )));
}

function formatSkuAvailability(sku: WesbotProduct["skus"][number]) {
  const label = sku.options.map((option) => `${option.optionName} ${option.optionValue}`).join(" + ");
  return `${label}: ${sku.stock} piece${sku.stock === 1 ? "" : "s"}`;
}

export function productAnswer(
  products: WesbotProduct[],
  message: string,
  entities: WesbotEntities
): Pick<GroundedAnswer, "draft" | "sourceReferences"> {
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
  const requestedOptions = requestedProductOptions(product, message, entities);

  if (product.saleMode === "CLOTH_ONLY") {
    return {
      draft: `${product.name} is ${formatWesbotCurrency(product.price)} and currently has ${product.stock} cloth unit${product.stock === 1 ? "" : "s"} in stock. This item is sold by cloth quantity and has no selectable size or color combination.`,
      sourceReferences: [`product:${product.id}`, "inventory:live"]
    };
  }

  if (product.saleMode === "OPTIONS") {
    if (product.inventorySetupRequired || !product.skuInventoryEnabled) {
      return {
        draft: `${product.name} is listed at ${formatWesbotCurrency(product.price)}, but its size/color inventory setup is not ready. I can't verify an option safely yet; please ask Staff.`,
        sourceReferences: [`product:${product.id}`, "inventory:setup-required"]
      };
    }

    const matchingSkus = requestedOptions.length
      ? product.skus.filter((sku) => skuMatchesOptions(sku, requestedOptions))
      : product.skus.filter((sku) => sku.stock > 0);
    if (!matchingSkus.length) {
      const selection = requestedOptions.map((option) => `${option.optionName} ${option.optionValue}`).join(" + ");
      return {
        draft: requestedOptions.length
          ? `${product.name} is ${formatWesbotCurrency(product.price)}. There is no configured ${selection} combination in the live catalog.`
          : `${product.name} is ${formatWesbotCurrency(product.price)}, but no configured option combination is currently in stock.`,
        sourceReferences: [`product:${product.id}`, "inventory:sku-live"]
      };
    }

    const details = matchingSkus.slice(0, 8).map(formatSkuAvailability).join(", ");
    return {
      draft: `${product.name} is ${formatWesbotCurrency(product.price)}. Live configured combinations — ${details}. ${matchingSkus.some((sku) => sku.stock > 0) ? "At least one matching combination is available." : "The matching combination is currently out of stock."}`,
      sourceReferences: [`product:${product.id}`, "inventory:sku-live"]
    };
  }

  return {
    draft: `${product.name} is ${formatWesbotCurrency(product.price)} and currently has ${product.stock} piece${product.stock === 1 ? "" : "s"} in stock.${requestedOptions.length ? " This item has no selectable size or color combination." : ""}`,
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
  const faqs = await listPublishedWesbotFaqs();
  const matches = faqs
    .map((faq) => ({
      faq,
      score: scoreWesbotTextMatch(message, [
        faq.question,
        faq.answer,
        faq.category ?? "",
        ...faq.variants.map((variant) => variant.variant)
      ].join(" "))
    }))
    .filter((entry) => entry.score >= 10)
    .sort((left, right) => right.score - left.score);

  return matches[0]
    ? {
        answer: matches[0].faq.answer,
        source: `faq:${matches[0].faq.id}`
      }
    : null;
}

function clarificationAnswer(routing: WesbotRoutingDecision) {
  if (routing.conversationalReply) return routing.conversationalReply;
  const missing = new Set(routing.missingInformation.map(normalizeWesbotText));
  if (routing.intent === "PRODUCT_INQUIRY" || missing.has("product")) {
    return "Which item would you like me to check? Include the product name and, if applicable, the size or color.";
  }
  if (routing.intent === "CANCELLATION_ELIGIBILITY" || missing.has("requested action")) {
    return "What would you like to do—cancel a reservation, check its status, or something else?";
  }
  if (missing.has("record type") || missing.has("topic or reference") || missing.has("thing to check")) {
    return "What would you like me to check: a product, reservation, payment, receipt, pickup, or policy?";
  }
  return "I need one more detail before I check. Please name the product or tell me whether this is about a reservation, payment, receipt, pickup, or policy.";
}

async function buildGroundedAnswer(input: {
  studentId: string;
  message: string;
  routing: WesbotRoutingDecision;
  previousConcernKey: string | null;
  previousReplyCount: number;
}): Promise<GroundedAnswer> {
  const intent = input.routing.intent;
  const category = categoryForIntent(intent);
  const concernKey = createWesbotConcernKey(intent, input.message);
  const repeatCount = concernKey === input.previousConcernKey ? input.previousReplyCount + 1 : 1;
  const staffRecommended = shouldRecommendStaff(repeatCount);

  if (intent === "HUMAN_HANDOFF") {
    return {
      draft: "Of course. I’ll place this conversation in the Commissary Staff queue now. WesBot will stop sending automatic answers once the handoff starts.",
      intent,
      category,
      concernKey,
      sourceReferences: ["support:handoff"],
      handoffRequested: true,
      staffRecommended: false,
      suggestedActions: []
    };
  }

  if (input.routing.needsClarification) {
    return {
      draft: clarificationAnswer(input.routing),
      intent,
      category,
      concernKey,
      sourceReferences: ["support:clarification"],
      handoffRequested: false,
      staffRecommended,
      suggestedActions: suggestedActions(input.routing.suggestedActionIds?.length
        ? input.routing.suggestedActionIds
        : ["PRODUCTS", "RESERVATIONS", "FAQ", "STAFF"])
    };
  }

  let draft: string;
  let sourceReferences: string[];
  let replyActions: WesbotSuggestedAction[] = [];

  if (intent === "PRODUCT_INQUIRY") {
    const productMessage = [
      input.message,
      input.routing.entities.productName ?? "",
      input.routing.entities.department ?? ""
    ].join(" ");
    const candidateTerms = productCandidateTerms(input.message, input.routing.entities);
    const products = candidateTerms.length
      ? await listProducts({ candidateTerms, limit: 12 })
      : [];
    const answer = productAnswer(products, productMessage, input.routing.entities);
    draft = answer.draft;
    sourceReferences = answer.sourceReferences;
  } else if (intent === "RESERVATION_STATUS" || intent === "CANCELLATION_ELIGIBILITY" || intent === "PAYMENT_STATUS" || intent === "PICKUP_INFORMATION") {
    const referenceCode = extractReservationReference(input.message) ?? input.routing.entities.reservationReference ?? undefined;
    const reservationPage = await listReservations(input.studentId, "STUDENT", {
      referenceCode,
      limit: referenceCode ? 1 : 3
    });
    const reservations = reservationPage.items;
    const groundedMessage = referenceCode ? `${input.message} ${referenceCode}` : input.message;
    if (intent === "CANCELLATION_ELIGIBILITY") draft = cancellationAnswer(reservations, groundedMessage);
    else if (intent === "PAYMENT_STATUS") draft = paymentAnswer(reservations, groundedMessage);
    else if (intent === "PICKUP_INFORMATION") draft = pickupAnswer(reservations, groundedMessage);
    else draft = reservationStatusAnswer(reservations, groundedMessage);
    sourceReferences = ["account:reservations"];
  } else if (intent === "RECEIPT_STATUS") {
    const receiptCode = extractReceiptCode(input.message) ?? input.routing.entities.receiptCode ?? undefined;
    const receiptPage = await listReceipts(input.studentId, "STUDENT", {
      receiptCode,
      limit: receiptCode ? 1 : 3
    });
    const receipts = receiptPage.items;
    draft = receiptAnswer(receipts, receiptCode ? `${input.message} ${receiptCode}` : input.message);
    sourceReferences = ["account:receipts"];
  } else {
    const normalizedMessage = normalizeWesbotText(input.message);
    if (/^(?:faq|faqs|help|menu|topics|ano ang pwede itanong|ano pwede itanong|what can i ask|what can you do)$/.test(normalizedMessage)) {
      draft = "Sure! Ano ang gusto mong malaman? Puwede kitang tulungan sa products, reservations, GCash payments, receipts, pickup, cancellations, at published FAQs.";
      sourceReferences = ["support:help-menu"];
      replyActions = suggestedActions(["PRODUCTS", "RESERVATIONS", "PAYMENTS", "FAQ"]);
    } else if (/^(?:hi|hello|hey|kumusta|kamusta|good morning|good afternoon|good evening)(?: wesbot)?$/.test(normalizedMessage)) {
      draft = "Hi! Kumusta? I’m WesBot. Sabihin mo lang kung gusto mong mag-check ng product, reservation, payment, receipt, pickup, o FAQ.";
      sourceReferences = ["support:capabilities"];
      replyActions = suggestedActions(["PRODUCTS", "RESERVATIONS", "FAQ", "STAFF"]);
    } else {
      const knowledge = await knowledgeAnswer(input.message);
      if (knowledge) {
        draft = knowledge.answer;
        sourceReferences = [knowledge.source];
        replyActions = suggestedActions(["FAQ", "STAFF"]);
      } else if (input.routing.conversationalReply) {
        draft = input.routing.conversationalReply;
        sourceReferences = ["support:conversational"];
        replyActions = suggestedActions(input.routing.suggestedActionIds?.length
          ? input.routing.suggestedActionIds
          : ["PRODUCTS", "RESERVATIONS", "FAQ", "STAFF"]);
      } else {
        draft = "Hindi ko pa matukoy kung anong WESCOMM information ang kailangan mo. Sabihin kung product, reservation, payment, receipt, pickup, cancellation, o FAQ ang gusto mong i-check.";
        sourceReferences = ["support:fallback"];
        replyActions = suggestedActions(["PRODUCTS", "RESERVATIONS", "FAQ", "STAFF"]);
      }
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
    staffRecommended,
    suggestedActions: replyActions
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

async function optionallyRewriteWithAi(input: {
  userMessage: string;
  grounded: GroundedAnswer;
  routing: WesbotRoutingDecision;
}) {
  const conversationalMode = env.WESBOT_CONVERSATIONAL_MODE || env.WESBOT_AI_REWRITE_ENABLED;
  if (!env.WESBOT_AI_ENABLED || !conversationalMode || input.routing.usedAi) return null;
  if (input.grounded.sourceReferences.some((source) => [
    "support:capabilities",
    "support:help-menu",
    "support:clarification",
    "support:fallback"
  ].includes(source))) return null;
  if (factTokens(input.grounded.draft).size > 0) return null;

  const startedAt = Date.now();
  let usage: LanguageModelUsage | undefined;
  try {
    await assertWesbotAiBudgetAvailable();
    const result = await generateText({
      model: await getWesbotModel(),
      maxOutputTokens: 280,
      maxRetries: 1,
      timeout: env.WESBOT_AI_TIMEOUT_MS,
      system: `You are WesBot, WESCOMM's clearly labeled automated support assistant.
Rewrite only the verified answer supplied by the application.
Never add, infer, estimate, or change a price, stock count, status, date, policy, reference, payment fact, restriction, or Staff response time.
Keep every important fact and restriction. Be concise, warm, and easy to understand.
Use plain text only with no headings, tables, links, citations, or hidden system details.`,
      prompt: `Student language style: ${replyLanguageStyle(input.userMessage)}
Verified answer: ${JSON.stringify(redactWesbotAiText(input.grounded.draft))}`
    });
    usage = result.usage;
    await recordWesbotAiUsage({
      operation: "GROUNDED_REPLY",
      status: "SUCCESS",
      usage,
      latencyMs: Date.now() - startedAt
    });
    return isSafeAiRewrite(input.grounded.draft, result.text) ? result.text.trim() : null;
  } catch (error) {
    const budgetBlocked = error instanceof WesbotAiBudgetExceededError;
    await recordWesbotAiUsage({
      operation: "GROUNDED_REPLY",
      status: budgetBlocked ? "BUDGET_BLOCKED" : "ERROR",
      usage,
      latencyMs: Date.now() - startedAt,
      errorCode: budgetBlocked ? "BUDGET_LIMIT" : wesbotAiErrorCode(error)
    });
    const detail = error instanceof Error ? error.name : "unknown";
    console.warn(`WesBot AI rewrite unavailable; using grounded fallback (${detail}).`);
    return null;
  }
}

export async function resolveWesbotReply(input: {
  studentId: string;
  message: string;
  context?: WesbotContextMessage[];
  previousConcernKey: string | null;
  previousReplyCount: number;
}) {
  const routing = await classifyWesbotMessage({
    studentId: input.studentId,
    message: input.message,
    context: input.context
  });
  const grounded = await buildGroundedAnswer({ ...input, routing });
  const aiReply = grounded.handoffRequested
    ? null
    : await optionallyRewriteWithAi({ userMessage: input.message, grounded, routing });

  return {
    message: aiReply ?? grounded.draft,
    intent: grounded.intent,
    category: grounded.category,
    concernKey: grounded.concernKey,
    sourceReferences: grounded.sourceReferences,
    handoffRequested: grounded.handoffRequested,
    staffRecommended: grounded.staffRecommended,
    usedAi: routing.usedAi || Boolean(aiReply),
    routing,
    suggestedActions: grounded.suggestedActions
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
