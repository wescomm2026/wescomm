"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { ArrowRight, MessageCircle, Plus, Search, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedbackState } from "@/components/ui/FeedbackState";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { Skeleton } from "@/components/ui/Skeleton";
import type { BackendFaq } from "@/lib/api";
import { cn } from "@/lib/utils";

export function StudentFaqList({ faqs, loading, error, onRetry }: { faqs: BackendFaq[]; loading: boolean; error: string; onRetry: () => void }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const categories = useMemo(
    () => Array.from(new Set(faqs.map((faq) => faq.category?.trim()).filter((value): value is string => Boolean(value)))).sort(),
    [faqs]
  );
  const visibleFaqs = useMemo(() => faqs.filter((faq) => {
    if (category && faq.category?.trim() !== category) return false;
    if (!deferredSearch) return true;
    return `${faq.question} ${faq.answer} ${faq.category ?? ""}`.toLowerCase().includes(deferredSearch);
  }), [category, deferredSearch, faqs]);
  const filtersActive = Boolean(deferredSearch || category);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="min-w-0 space-y-4">
        <div className="space-y-3 rounded-xl border bg-card p-3 shadow-soft">
          <label className="flex h-11 items-center gap-2 rounded-control border border-border-strong bg-card px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search questions about pickup, payment, receipts..."
              aria-label="Search FAQs"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:outline-none placeholder:text-muted-foreground"
            />
            {search ? (
              <button type="button" onClick={() => setSearch("")} aria-label="Clear FAQ search" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="size-4" />
              </button>
            ) : null}
          </label>
          {categories.length > 1 ? (
            <div role="group" aria-label="Filter FAQs by topic" className="flex flex-wrap gap-2">
              {[null, ...categories].map((value) => (
                <button
                  key={value ?? "all"}
                  type="button"
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-bold transition-colors",
                    category === value ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-card text-muted-foreground hover:border-primary hover:text-primary"
                  )}
                >
                  {value ?? "All topics"}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {error ? <InlineAlert action={<Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}>{error}</InlineAlert> : null}
        {loading ? (
          <div className="space-y-3" role="status" aria-label="Loading FAQs...">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-16 rounded-xl" />)}
          </div>
        ) : error ? null : !faqs.length ? (
          <FeedbackState kind="empty" title="No published FAQs yet" description="Answers from the commissary team will appear here. You can still ask WesBot in Support." />
        ) : visibleFaqs.length ? (
          <div className="overflow-hidden rounded-xl border bg-card shadow-soft">
            <p className="border-b bg-surface-subtle px-4 py-2.5 text-xs font-semibold text-muted-foreground" aria-live="polite">
              {filtersActive ? `${visibleFaqs.length} of ${faqs.length} answers match` : `${faqs.length} answer${faqs.length === 1 ? "" : "s"}`}
            </p>
            <div className="divide-y">
              {visibleFaqs.map((faq) => (
                <details key={faq.id} className="group">
                  <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-4 transition-colors hover:bg-surface-subtle sm:px-5 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1">
                      {faq.category ? <span className="block text-[11px] font-extrabold uppercase tracking-wide text-primary">{faq.category}</span> : null}
                      <span className="mt-0.5 block font-bold leading-snug text-foreground">{faq.question}</span>
                    </span>
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary transition group-open:rotate-45" aria-hidden="true">
                      <Plus className="size-4" />
                    </span>
                  </summary>
                  <p className="whitespace-pre-line px-4 pb-5 text-sm leading-6 text-muted-foreground sm:px-5">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        ) : (
          <FeedbackState
            kind="empty"
            title="No answers match your search"
            description="Try a different word, or ask WesBot in Support."
            action={<Button variant="secondary" size="sm" onClick={() => { setSearch(""); setCategory(null); }}>Clear search</Button>}
          />
        )}
      </div>

      <aside className="space-y-3 lg:sticky lg:top-24" aria-label="More help">
        <div className="rounded-xl border bg-primary/5 p-5">
          <span className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground"><MessageCircle className="size-5" aria-hidden="true" /></span>
          <h2 className="mt-3 font-extrabold text-foreground">Still need help?</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Ask WesBot about stock, pickup, or receipts. A staff member can take over the chat when needed.</p>
          <Link href="/student/support" className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary-hover">
            Chat with WesBot <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <Link href="/verify-receipt" className="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-soft transition hover:border-primary/40">
          <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><ShieldCheck className="size-5" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-foreground">Verify a receipt</span>
            <span className="block text-xs text-muted-foreground">Check that a receipt code is genuine</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
        </Link>
      </aside>
    </div>
  );
}
