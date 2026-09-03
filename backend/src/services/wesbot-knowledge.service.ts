import { prisma } from "../lib/prisma.js";

const FAQ_CACHE_TTL_MS = 60_000;

type PublishedWesbotFaq = Awaited<ReturnType<typeof queryPublishedWesbotFaqs>>[number];

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
