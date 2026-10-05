"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useEffect, useState } from "react";
import { FaqManagementExperience } from "@/components/faq/FaqManagementExperience";
import { StudentFaqList } from "@/components/faq/StudentFaqList";
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
        setError(userFacingErrorMessage(faqError, "Unable to load FAQs."));
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
  return <StudentFaqList faqs={faqs} loading={loading} error={error} onRetry={() => void loadFaqs()} />;
}
