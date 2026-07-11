"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit3, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  createFaqFromApi,
  deleteFaqFromApi,
  getManageFaqsFromApi,
  updateFaqFromApi,
  type BackendFaq
} from "@/lib/api";

type FaqDraft = {
  id?: string;
  question: string;
  answer: string;
  category: string;
  isPublished: boolean;
};

const emptyDraft: FaqDraft = {
  question: "",
  answer: "",
  category: "",
  isPublished: true
};

function formatFaqDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila"
  });
}

function mapFaqToDraft(faq: BackendFaq): FaqDraft {
  return {
    id: faq.id,
    question: faq.question,
    answer: faq.answer,
    category: faq.category ?? "",
    isPublished: faq.isPublished ?? true
  };
}

export function FaqManagementExperience() {
  const { user, ready, openAuth } = useStudentAuth();
  const [faqs, setFaqs] = useState<BackendFaq[]>([]);
  const [editing, setEditing] = useState<FaqDraft | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadFaqs = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!user?.accessToken) {
      setFaqs([]);
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const rows = await getManageFaqsFromApi(user.accessToken);
      setFaqs(rows);
    } catch (faqError) {
      if (!background) {
        setError(faqError instanceof Error ? faqError.message : "Unable to load FAQs.");
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, [user?.accessToken]);

  useEffect(() => {
    if (!ready) return;
    void loadFaqs();
  }, [loadFaqs, ready]);

  useEffect(() => {
    if (!ready || !user?.accessToken) return;

    const refreshInBackground = () => {
      if (document.visibilityState === "visible" && !editing) void loadFaqs({ background: true });
    };

    const interval = window.setInterval(refreshInBackground, 20000);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [editing, loadFaqs, ready, user?.accessToken]);

  const filteredFaqs = useMemo(
    () =>
      faqs.filter((faq) => {
        const matchesSearch = `${faq.question} ${faq.answer} ${faq.category ?? ""}`.toLowerCase().includes(search.toLowerCase());
        const label = faq.isPublished === false ? "Draft" : "Published";
        return matchesSearch && (status === "All" || status === label);
      }),
    [faqs, search, status]
  );

  const saveFaq = async () => {
    if (!user?.accessToken || !editing) return;
    if (!editing.question.trim() || !editing.answer.trim()) return;

    setSubmitting(true);
    setError("");

    try {
      const payload = {
        question: editing.question.trim(),
        answer: editing.answer.trim(),
        category: editing.category.trim() || null,
        isPublished: editing.isPublished
      };

      if (editing.id) {
        const updatedFaq = await updateFaqFromApi(user.accessToken, editing.id, payload);
        setFaqs((current) => current.map((faq) => faq.id === updatedFaq.id ? updatedFaq : faq));
        setNotice("FAQ updated.");
      } else {
        const createdFaq = await createFaqFromApi(user.accessToken, payload);
        setFaqs((current) => [createdFaq, ...current]);
        setNotice("FAQ added.");
      }

      setEditing(null);
    } catch (faqError) {
      setError(faqError instanceof Error ? faqError.message : "Unable to save FAQ.");
    } finally {
      setSubmitting(false);
    }
  };

  const togglePublished = async (faq: BackendFaq) => {
    if (!user?.accessToken) return;
    setSubmitting(true);
    setError("");

    try {
      const updatedFaq = await updateFaqFromApi(user.accessToken, faq.id, {
        isPublished: !(faq.isPublished ?? true)
      });
      setFaqs((current) => current.map((item) => item.id === updatedFaq.id ? updatedFaq : item));
      setNotice(updatedFaq.isPublished ? "FAQ published." : "FAQ hidden from students.");
    } catch (faqError) {
      setError(faqError instanceof Error ? faqError.message : "Unable to update FAQ.");
    } finally {
      setSubmitting(false);
    }
  };

  const removeFaq = async (faq: BackendFaq) => {
    if (!user?.accessToken) return;
    if (!window.confirm(`Delete this FAQ?\n\n${faq.question}`)) return;

    setSubmitting(true);
    setError("");

    try {
      await deleteFaqFromApi(user.accessToken, faq.id);
      setFaqs((current) => current.filter((item) => item.id !== faq.id));
      setNotice("FAQ deleted.");
    } catch (faqError) {
      setError(faqError instanceof Error ? faqError.message : "Unable to delete FAQ.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready || loading) {
    return (
      <div className="space-y-5">
        <PageHeader onAdd={() => setEditing({ ...emptyDraft })} onRefresh={() => void loadFaqs()} loading />
        <section className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">
          Loading FAQ records...
        </section>
      </div>
    );
  }

  if (!user?.accessToken) {
    return (
      <div className="space-y-5">
        <PageHeader onAdd={() => setEditing({ ...emptyDraft })} onRefresh={() => void loadFaqs()} showActions={false} />
        <section className="rounded-lg border border-[#dce5dd] bg-white p-6 shadow-sm">
          <p className="font-extrabold text-[#17211b]">Sign in required</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#68746d]">Use a staff or admin account to manage FAQ content.</p>
          <Button className="mt-5 h-11" onClick={openAuth}>Sign in</Button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader onAdd={() => setEditing({ ...emptyDraft })} onRefresh={() => void loadFaqs()} loading={loading || submitting} />

      <div className="flex flex-col gap-3 rounded-lg border border-[#dce5dd] bg-white p-3 sm:flex-row">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search questions, answers, or categories"
          className="h-11 min-w-0 flex-1 rounded-md border border-[#d7e1d8] px-3 text-sm outline-none focus:border-primary"
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="h-11 rounded-md border border-[#d7e1d8] bg-white px-3 text-sm font-semibold outline-none focus:border-primary"
        >
          <option value="All">All statuses</option>
          <option value="Published">Published</option>
          <option value="Draft">Draft</option>
        </select>
      </div>

      {notice ? <p className="rounded-md border border-[#cfe0d0] bg-[#f3f9f3] px-4 py-3 text-sm font-semibold text-primary">{notice}</p> : null}
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {filteredFaqs.length ? filteredFaqs.map((faq) => (
          <article key={faq.id} className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#eef6ee]">
                <AssetIcon src="/assets/faq.svg" className="size-8" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {faq.category ? <p className="text-xs font-bold uppercase text-primary">{faq.category}</p> : null}
                  <StatusBadge status={faq.isPublished === false ? "Draft" : "Published"} />
                </div>
                <h2 className="mt-2 text-lg font-extrabold text-[#17211b]">{faq.question}</h2>
                <p className="mt-2 text-sm leading-6 text-[#68746d]">{faq.answer}</p>
                <p className="mt-3 text-xs font-semibold text-[#7a857e]">
                  Updated {formatFaqDate(faq.updatedAt) || "recently"}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-[#edf1ed] pt-4">
              <Button variant="secondary" className="h-9" onClick={() => setEditing(mapFaqToDraft(faq))} disabled={submitting}>
                <Edit3 className="size-4" />
                Edit
              </Button>
              <Button variant="secondary" className="h-9" onClick={() => void togglePublished(faq)} disabled={submitting}>
                {faq.isPublished === false ? "Publish" : "Hide"}
              </Button>
              <Button variant="ghost" className="h-9 text-red-600" onClick={() => void removeFaq(faq)} disabled={submitting}>
                <Trash2 className="size-4" />
                Delete
              </Button>
            </div>
          </article>
        )) : (
          <section className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm lg:col-span-2">
            No FAQs found.
          </section>
        )}
      </div>

      {editing ? (
        <div className="fixed inset-0 z-[10000] grid place-items-center overflow-y-auto bg-[#101820]/50 p-4">
          <form
            className="my-auto w-full max-w-xl rounded-lg bg-white p-5 shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              void saveFaq();
            }}
          >
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-extrabold">{editing.id ? "Edit FAQ" : "Add FAQ"}</h2>
              <button type="button" onClick={() => setEditing(null)} className="ml-auto grid size-9 place-items-center rounded-md hover:bg-[#eef3ee]">
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="grid gap-1.5 text-sm font-semibold">
                Question
                <input
                  value={editing.question}
                  onChange={(event) => setEditing((current) => current ? { ...current, question: event.target.value } : current)}
                  required
                  className="h-11 rounded-md border border-[#d7e1d8] px-3 font-normal outline-none focus:border-primary"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold">
                Category
                <input
                  value={editing.category}
                  onChange={(event) => setEditing((current) => current ? { ...current, category: event.target.value } : current)}
                  placeholder="Reservations, Receipts, Inventory"
                  className="h-11 rounded-md border border-[#d7e1d8] px-3 font-normal outline-none focus:border-primary"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold">
                Answer
                <textarea
                  value={editing.answer}
                  onChange={(event) => setEditing((current) => current ? { ...current, answer: event.target.value } : current)}
                  required
                  className="min-h-36 rounded-md border border-[#d7e1d8] p-3 font-normal leading-6 outline-none focus:border-primary"
                />
              </label>
              <label className="flex items-center justify-between rounded-md border border-[#dce5dd] p-3 text-sm font-semibold">
                Published for students
                <input
                  type="checkbox"
                  checked={editing.isPublished}
                  onChange={() => setEditing((current) => current ? { ...current, isPublished: !current.isPublished } : current)}
                  className="size-5 accent-[#00652f]"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={submitting || !editing.question.trim() || !editing.answer.trim()}>
                {submitting ? "Saving..." : "Save FAQ"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function PageHeader({
  onAdd,
  onRefresh,
  loading = false,
  showActions = true
}: {
  onAdd: () => void;
  onRefresh: () => void;
  loading?: boolean;
  showActions?: boolean;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-bold uppercase text-primary">FAQ Management</p>
        <h1 className="mt-1 text-3xl font-extrabold text-[#101820]">Maintain student help content</h1>
        <p className="mt-2 text-sm text-[#68746d]">Publish clear answers for reservations, receipt verification, stock browsing, and support.</p>
      </div>
      {showActions === false ? null : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onRefresh} disabled={loading}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button onClick={onAdd} disabled={loading}>
            <Plus className="size-5" />
            Add FAQ
          </Button>
        </div>
      )}
    </header>
  );
}
