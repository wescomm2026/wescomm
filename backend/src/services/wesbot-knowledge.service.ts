import { WESCOMM_DEFAULT_KNOWLEDGE } from "../domain/wesbot-knowledge.js";
import { normalizeWesbotText, scoreWesbotTextMatch } from "../domain/wesbot.js";
import { prisma } from "../lib/prisma.js";

const FAQ_CACHE_TTL_MS = 60_000;
const KNOWLEDGE_CACHE_TTL_MS = 60_000;
const WESBOT_KNOWLEDGE_SETTING_KEY = "wesbot.knowledge";

type PublishedWesbotFaq = Awaited<ReturnType<typeof queryPublishedWesbotFaqs>>[number];

export type WesbotFaqEntry = PublishedWesbotFaq;

export type RankedWesbotFaq = {
  faq: PublishedWesbotFaq;
  score: number;
};

export const WESBOT_FAQ_SOURCE_ID_PREFIX = "faq:";
export const WESBOT_FACT_SOURCE_ID_PREFIX = "knowledge:";

export function wesbotFaqSourceId(faqId: string) {
  return `${WESBOT_FAQ_SOURCE_ID_PREFIX}${faqId}`;
}

export function wesbotFactSourceId(index: number) {
  return `${WESBOT_FACT_SOURCE_ID_PREFIX}${index}`;
}

function faqSearchText(faq: PublishedWesbotFaq) {
  return [
    faq.question,
    faq.answer,
    faq.category ?? "",
    ...faq.variants.map((variant) => variant.variant)
  ].join(" ");
}

/**
 * Ranks published FAQs against a student message. Pure apart from the
 * optional FAQ list, so it can be unit-tested without a database.
 */
export function rankWesbotFaqs(message: string, faqs: PublishedWesbotFaq[]): RankedWesbotFaq[] {
  return faqs
    .map((faq) => ({ faq, score: scoreWesbotTextMatch(message, faqSearchText(faq)) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.faq.question.localeCompare(right.faq.question));
}

/**
 * True when the normalized student query appears verbatim inside the FAQ's
 * searchable text. This is the only reliable "exact match" signal — the
 * token-overlap score alone cannot distinguish containment from a high
 * overlap score (which can exceed 100).
 */
export function isContainedWesbotFaqMatch(message: string, faq: PublishedWesbotFaq) {
  const query = normalizeWesbotText(message);
  if (!query) return false;
  return normalizeWesbotText(faqSearchText(faq)).includes(query);
}

export type RankedWesbotKnowledge = {
  rankedFaqs: RankedWesbotFaq[];
  facts: string[];
};

/** Loads published FAQs and approved knowledge facts, ranked for a message. */
export async function buildRankedWesbotKnowledge(message: string): Promise<RankedWesbotKnowledge> {
  const [faqs, facts] = await Promise.all([listPublishedWesbotFaqs(), listWesbotKnowledgeFacts()]);
  return { rankedFaqs: rankWesbotFaqs(message, faqs), facts };
}

let cachedFaqs: { value: PublishedWesbotFaq[]; expiresAt: number } | null = null;
let faqRequest: Promise<PublishedWesbotFaq[]> | null = null;

async function queryPublishedWesbotFaqs() {
  return prisma.faq.findMany({
    where: { isPublished: true },
    select: {
      id: true,
      question: true,
      answer: true,
      category: true,
      source: true,
      sourceVersion: true,
      variants: {
        select: { variant: true },
        orderBy: { variant: "asc" }
      }
    },
    orderBy: [{ category: "asc" }, { question: "asc" }]
  });
}

export async function listPublishedWesbotFaqs() {
  if (cachedFaqs && cachedFaqs.expiresAt > Date.now()) return cachedFaqs.value;
  if (faqRequest) return faqRequest;

  faqRequest = queryPublishedWesbotFaqs()
    .then((faqs) => {
      cachedFaqs = { value: faqs, expiresAt: Date.now() + FAQ_CACHE_TTL_MS };
      return faqs;
    })
    .finally(() => {
      faqRequest = null;
    });
  return faqRequest;
}

export function invalidateWesbotFaqCache() {
  cachedFaqs = null;
}

let cachedKnowledgeFacts: { value: string[]; expiresAt: number } | null = null;

function parseKnowledgeFacts(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const facts = value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
    return facts.length ? facts : null;
  }
  if (value && typeof value === "object" && Array.isArray((value as { facts?: unknown }).facts)) {
    const facts = ((value as { facts: unknown[] }).facts)
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
    return facts.length ? facts : null;
  }
  return null;
}

export async function listWesbotKnowledgeFacts() {
  if (cachedKnowledgeFacts && cachedKnowledgeFacts.expiresAt > Date.now()) {
    return cachedKnowledgeFacts.value;
  }

  let facts = WESCOMM_DEFAULT_KNOWLEDGE;
  try {
    const setting = await prisma.appSetting.findUnique({
      where: { key: WESBOT_KNOWLEDGE_SETTING_KEY }
    });
    const parsed = parseKnowledgeFacts(setting?.value);
    if (parsed) facts = parsed;
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    console.warn(`WesBot knowledge setting unavailable; using default knowledge (${name}).`);
  }

  cachedKnowledgeFacts = { value: facts, expiresAt: Date.now() + KNOWLEDGE_CACHE_TTL_MS };
  return facts;
}

export function invalidateWesbotKnowledgeCache() {
  cachedKnowledgeFacts = null;
}
