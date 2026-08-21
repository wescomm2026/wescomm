export const WESBOT_INTENTS = [
  "PRODUCT_INQUIRY",
  "RESERVATION_STATUS",
  "CANCELLATION_ELIGIBILITY",
  "PAYMENT_STATUS",
  "RECEIPT_STATUS",
  "PICKUP_INFORMATION",
  "POLICY_QUESTION",
  "HUMAN_HANDOFF",
  "GENERAL_SUPPORT"
] as const;

export type WesbotIntent = (typeof WESBOT_INTENTS)[number];

const HANDOFF_PATTERNS = [
  /\b(?:talk|speak|connect|chat)\s+(?:to|with)\s+(?:a\s+)?(?:real\s+)?(?:person|human|staff|admin|agent|commissary)\b/,
  /\b(?:real|human|live)\s+(?:person|staff|agent|support)\b/,
  /\b(?:staff|admin|agent)\s+(?:please|pls|po)\b/,
  /\b(?:gusto|nais|need|kailangan)\s+ko\s+(?:ng|makipag-usap\s+sa|makausap\s+na?)\s*(?:real\s+)?(?:tao|staff|admin|person|agent)\b/,
  /\b(?:ayoko|ayaw\s+ko)\s+(?:sa\s+)?(?:bot|ai|wesbot)\b/,
  /\b(?:makausap|kausapin)\s+(?:ang|yung|ng)?\s*(?:staff|admin|tao|commissary)\b/
];

const STOP_WORDS = new Set([
  "a", "about", "ako", "akong", "akin", "ang", "ano", "available", "availability", "ba", "bang", "check",
  "do", "for", "gusto", "how", "i", "in", "is", "it", "item", "ko", "kong", "lang", "may", "meron",
  "my", "na", "ng", "nga", "nito", "pa", "paki", "please", "po", "product", "sa", "size", "stock", "the",
  "this", "to", "ung", "un", "yong", "yung"
]);

export function normalizeWesbotText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokenizeWesbotText(value: string) {
  return normalizeWesbotText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function requestsHumanSupport(value: string) {
  const normalized = normalizeWesbotText(value);
  return HANDOFF_PATTERNS.some((pattern) => pattern.test(normalized));
}

function containsAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

export function detectWesbotIntent(value: string): WesbotIntent {
  const normalized = normalizeWesbotText(value);
  if (requestsHumanSupport(normalized)) return "HUMAN_HANDOFF";

  if (containsAny(normalized, ["cancel", "cancellation", "kansel", "kansela", "alisin reservation", "remove reservation"])) {
    return "CANCELLATION_ELIGIBILITY";
  }
  if (containsAny(normalized, ["payment", "paid", "paymongo", "gcash", "bayad", "nagbayad", "binayaran"])) {
    return "PAYMENT_STATUS";
  }
  if (containsAny(normalized, ["receipt", "resibo", "rct ", "rct-", "proof of purchase"])) {
    return "RECEIPT_STATUS";
  }
  if (containsAny(normalized, ["pickup", "pick up", "claim", "kunin", "kuha", "schedule", "commissary hours"])) {
    return "PICKUP_INFORMATION";
  }
  if (containsAny(normalized, ["reservation", "reserve", "reserved", "pending", "confirmed", "ready for pickup", "wes ", "wes-"])) {
    return "RESERVATION_STATUS";
  }
  if (containsAny(normalized, [
    "uniform", "polo", "blouse", "pants", "skirt", "pe ", "cpe", "bsba", "bsit", "bsa", "stock", "available",
    "availability", "price", "presyo", "magkano", "medium", "large", "small", "xl", "xxl", "item", "product"
  ])) {
    return "PRODUCT_INQUIRY";
  }
  if (containsAny(normalized, ["policy", "rule", "rules", "allowed", "pwede", "bawal", "no show", "restriction", "refund"])) {
    return "POLICY_QUESTION";
  }
  return "GENERAL_SUPPORT";
}

export function extractReservationReference(value: string) {
  return value.toUpperCase().match(/\bWES-\d{4}-[A-F0-9]{8}\b/)?.[0] ?? null;
}

export function extractReceiptCode(value: string) {
  return value.toUpperCase().match(/\bRCT-\d{4}-[A-F0-9]{10}\b/)?.[0] ?? null;
}

export function createWesbotConcernKey(intent: WesbotIntent, value: string) {
  const reference = extractReservationReference(value) ?? extractReceiptCode(value);
  if (reference) return `${intent}:${reference}`;

  const tokens = [...new Set(tokenizeWesbotText(value))].sort().slice(0, 8);
  return `${intent}:${tokens.join("-") || "general"}`;
}

export function shouldRecommendStaff(repeatCount: number) {
  return repeatCount >= 3;
}

export function scoreWesbotTextMatch(query: string, candidate: string) {
  const normalizedQuery = normalizeWesbotText(query);
  const normalizedCandidate = normalizeWesbotText(candidate);
  if (!normalizedQuery || !normalizedCandidate) return 0;
  if (normalizedCandidate.includes(normalizedQuery)) return 100;

  const queryTokens = tokenizeWesbotText(query);
  if (!queryTokens.length) return 0;
  const candidateTokens = new Set(tokenizeWesbotText(candidate));
  const matches = queryTokens.filter((token) => candidateTokens.has(token) || normalizedCandidate.includes(token));
  return matches.length * 10 + matches.reduce((score, token) => score + Math.min(token.length, 8), 0);
}

export function formatWesbotCurrency(value: string | number) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "PHP 0.00";
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
}

export function formatWesbotDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila"
  }).format(date);
}
