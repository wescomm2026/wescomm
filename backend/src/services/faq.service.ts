import { supabaseAdmin } from "../lib/supabase.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";
import { HttpError } from "../utils/http-error.js";

type RawFaq = {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  is_published: boolean;
  updated_by_id: string | null;
  created_at: string;
  updated_at: string;
};

type FaqInput = {
  question: string;
  answer: string;
  category?: string | null;
  isPublished?: boolean;
  updatedById?: string | null;
};

const faqSelect = "id,question,answer,category,is_published,updated_by_id,created_at,updated_at";

function mapFaq(row: RawFaq) {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    category: row.category,
    isPublished: row.is_published,
    updatedById: row.updated_by_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listPublishedFaqs() {
  const { data, error } = await supabaseAdmin
    .from("faqs")
    .select(faqSelect)
    .eq("is_published", true)
    .order("category", { ascending: true, nullsFirst: false })
    .order("question", { ascending: true });

  if (error) throw HttpError.fromSupabase(error);
  return ((data ?? []) as RawFaq[]).map(mapFaq);
}

export async function listFaqs() {
  const { data, error } = await supabaseAdmin
    .from("faqs")
    .select(faqSelect)
    .order("updated_at", { ascending: false });

  if (error) throw HttpError.fromSupabase(error);
  return ((data ?? []) as RawFaq[]).map(mapFaq);
}

export async function createFaq(input: FaqInput) {
  const { data, error } = await supabaseAdmin
    .from("faqs")
    .insert({
      question: input.question.trim(),
      answer: input.answer.trim(),
      category: input.category?.trim() || null,
      is_published: input.isPublished ?? true,
      updated_by_id: input.updatedById ?? null
    })
    .select(faqSelect)
    .single();

  if (error) {
    if (error.code === "23505") throw new HttpError(409, "An FAQ with this question already exists.");
    throw HttpError.fromSupabase(error);
  }

  const faq = mapFaq(data as RawFaq);

  await safelyRecordAuditLog({
    actorId: input.updatedById,
    action: "FAQ_CREATED",
    entityType: "faq",
    entityId: faq.id,
    summary: `Created FAQ: ${faq.question}`,
    metadata: {
      category: faq.category,
      isPublished: faq.isPublished
    }
  });

  return faq;
}

export async function updateFaq(faqId: string, input: Partial<FaqInput>) {
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };

  if (input.question !== undefined) updates.question = input.question.trim();
  if (input.answer !== undefined) updates.answer = input.answer.trim();
  if (input.category !== undefined) updates.category = input.category?.trim() || null;
  if (input.isPublished !== undefined) updates.is_published = input.isPublished;
  if (input.updatedById !== undefined) updates.updated_by_id = input.updatedById;

  const { data, error } = await supabaseAdmin
    .from("faqs")
    .update(updates)
    .eq("id", faqId)
    .select(faqSelect)
    .maybeSingle();

  if (error) {
    if (error.code === "23505") throw new HttpError(409, "An FAQ with this question already exists.");
    throw HttpError.fromSupabase(error);
  }
  if (!data) throw new HttpError(404, "FAQ not found.");

  const faq = mapFaq(data as RawFaq);

  await safelyRecordAuditLog({
    actorId: input.updatedById,
    action: "FAQ_UPDATED",
    entityType: "faq",
    entityId: faq.id,
    summary: `Updated FAQ: ${faq.question}`,
    metadata: {
      changedFields: Object.keys(updates).filter((field) => field !== "updated_at"),
      category: faq.category,
      isPublished: faq.isPublished
    }
  });

  return faq;
}

export async function deleteFaq(faqId: string, performedById?: string) {
  const { data, error } = await supabaseAdmin
    .from("faqs")
    .delete()
    .eq("id", faqId)
    .select(faqSelect)
    .maybeSingle();

  if (error) throw HttpError.fromSupabase(error);
  if (!data) throw new HttpError(404, "FAQ not found.");

  const faq = mapFaq(data as RawFaq);

  await safelyRecordAuditLog({
    actorId: performedById,
    action: "FAQ_DELETED",
    entityType: "faq",
    entityId: faq.id,
    summary: `Deleted FAQ: ${faq.question}`,
    metadata: {
      category: faq.category,
      wasPublished: faq.isPublished
    }
  });

  return faq;
}
