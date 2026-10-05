"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { Button } from "@/components/ui/button";
import { FeedbackState } from "@/components/ui/FeedbackState";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricSkeletonGrid } from "@/components/ui/Skeleton";
import {
  getAdminReportSummaryFromApi,
  isRequestAbortError,
  type BackendReportSummary,
  type ReportRangeOptions
} from "@/lib/api";
import { markWelcomeContentReady } from "@/lib/welcome-readiness";
import { EMPTY_REPORT_SUMMARY } from "@/lib/report-summary";

export const emptySummary = EMPTY_REPORT_SUMMARY;

export function mergeUniqueById<T extends { id: string }>(items: T[]) {
  const byId = new Map<string, T>();
  items.forEach((item) => {
    if (!byId.has(item.id)) byId.set(item.id, item);
  });
  return Array.from(byId.values());
}

export function formatCurrency(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(value: number) {
  return value.toLocaleString("en-PH");
}

export function formatAuditDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  });
}

export function formatAuditAction(value: string) {
  const acronyms = new Set(["AI", "FAQ", "ID", "OR", "QR", "SKU"]);
  return value
    .split("_")
    .filter(Boolean)
    .map((part, index) => {
      const upper = part.toUpperCase();
      if (acronyms.has(upper)) return upper;
      const lower = part.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

const DEFAULT_REPORT_RANGE: ReportRangeOptions = {};

export function useAdminSummary(options: ReportRangeOptions = DEFAULT_REPORT_RANGE) {
  const { user, ready, openAuth } = useStudentAuth();
  const [summary, setSummary] = useState<BackendReportSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [error, setError] = useState("");
  const requestSequenceRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  const loadSummary = useCallback(async ({ background = false, fresh = false }: { background?: boolean; fresh?: boolean } = {}) => {
    if (!ready) return;

    const requestId = ++requestSequenceRef.current;
    requestAbortRef.current?.abort();
    const requestController = new AbortController();
    requestAbortRef.current = requestController;

    if (!user?.accessToken) {
      requestController.abort();
      setLoading(false);
      if (!background) {
        setInitialLoadComplete(true);
        markWelcomeContentReady(window.location.pathname);
      }
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const data = await getAdminReportSummaryFromApi(user.accessToken, options, requestController.signal, fresh);
      if (requestId !== requestSequenceRef.current) return;
      setSummary(data);
    } catch (summaryError) {
      if (requestId === requestSequenceRef.current && !background && !isRequestAbortError(summaryError)) {
        setError(userFacingErrorMessage(summaryError, "Unable to load the admin overview."));
      }
    } finally {
      if (requestId === requestSequenceRef.current && !background) {
        setLoading(false);
        setInitialLoadComplete(true);
        markWelcomeContentReady(window.location.pathname);
      }
    }
  }, [options, ready, user?.accessToken]);

  useRealtimeRefresh(["dashboard", "reports", "inventory", "reservations", "receipts", "conversations", "users"], () => {
    void loadSummary({ background: true });
  });

  useEffect(() => {
    void loadSummary();
    return () => requestAbortRef.current?.abort();
  }, [loadSummary]);

  useEffect(() => {
    if (!user?.accessToken) return;

    const refresh = () => {
      if (document.visibilityState === "visible") void loadSummary({ background: true });
    };

    const interval = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadSummary, user?.accessToken]);

  return { user, ready, openAuth, summary, loading, initialLoadComplete, error, reload: () => loadSummary({ fresh: true }) };
}

export function AdminHeader({
  eyebrow,
  title,
  detail,
  action
}: {
  eyebrow: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return <PageHeader eyebrow={eyebrow} title={title} description={detail} action={action} />;
}

export function AdminStatCard({
  title,
  value,
  detail,
  iconSrc,
  tone = "green",
  href
}: {
  title: string;
  value: string;
  detail: string;
  iconSrc: string;
  tone?: "green" | "yellow" | "red";
  href?: string;
}) {
  return (
    <MetricCard
      label={title}
      value={value}
      detail={detail}
      iconSrc={iconSrc}
      href={href}
      tone={tone === "red" ? "critical" : tone === "yellow" ? "attention" : "default"}
    />
  );
}

export function AdminDashboardLoading() {
  return <MetricSkeletonGrid label="Loading live admin dashboard data." />;
}

export function AdminAccessState({
  ready,
  user,
  openAuth
}: {
  ready: boolean;
  user: ReturnType<typeof useStudentAuth>["user"];
  openAuth: () => void;
}) {
  if (!ready) {
    return <AdminDashboardLoading />;
  }

  if (!user) {
    return (
      <FeedbackState
        kind="empty"
        title="Admin sign in required"
        description="Use an admin Wesleyan account to continue."
        action={<Button onClick={openAuth}>Sign in</Button>}
      />
    );
  }

  if (user.role !== "ADMIN") {
    return <InlineAlert>This page is restricted to admin accounts.</InlineAlert>;
  }

  return null;
}
