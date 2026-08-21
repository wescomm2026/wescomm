"use client";

import { useCallback, useEffect, useState } from "react";
import { FaqManagementExperience } from "@/components/faq/FaqManagementExperience";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { getFaqsFromApi, type BackendFaq } from "@/lib/api";

export function FaqExperience({ manage = false }: { manage?: boolean }) {
  const [faqs, setFaqs] = useState<BackendFaq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadFaqs = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const apiFaqs = await getFaqsFromApi({ fresh: background });
      setFaqs(apiFaqs);
    } catch (faqError) {
      if (!background) {
        setFaqs([]);
        setError(faqError instanceof Error ? faqError.message : "Unable to load FAQs.");
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFaqs();

    const refresh = () => {
      if (document.visibilityState === "visible") void loadFaqs({ background: true });
    };

    const interval = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadFaqs]);

  if (manage) return <FaqManagementExperience />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {loading ? (
        <section className="rounded-lg border border-[#dce5dd] bg-card p-5 text-sm font-semibold text-muted-foreground shadow-sm lg:col-span-2">
          Loading FAQs...
        </section>
      ) : null}
      {error ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700 shadow-sm lg:col-span-2">
          {error}
        </section>
      ) : null}
      {!loading && !error && !faqs.length ? (
        <section className="rounded-lg border border-[#dce5dd] bg-card p-5 text-sm font-semibold text-muted-foreground shadow-sm lg:col-span-2">
          No published FAQs yet.
        </section>
      ) : null}
      {faqs.map((faq) => (
        <details key={faq.id} className="group rounded-lg border border-[#dce5dd] bg-card p-5 shadow-sm">
          <summary className="flex cursor-pointer list-none items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#fff4d8]">
              <AssetIcon src="/assets/faq.svg" className="size-8" />
            </span>
            <span className="min-w-0 flex-1">
              {faq.category ? <span className="text-xs font-bold uppercase tracking-wide text-primary">{faq.category}</span> : null}
              <span className="mt-1 block font-extrabold text-[#17211b]">{faq.question}</span>
            </span>
            <span className="text-2xl leading-none text-primary transition group-open:rotate-45">+</span>
          </summary>
          <p className="mt-4 border-t border-[#edf1ed] pt-4 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
        </details>
      ))}
    </div>
  );
}
