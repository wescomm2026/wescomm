"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import {
  getAdminReportSummaryFromApi,
  isRequestAbortError,
  type BackendReportSummary,
  type ReportRangeOptions
} from "@/lib/api";
import { markWelcomeContentReady } from "@/lib/welcome-readiness";

export const emptySummary: BackendReportSummary = {
  range: { preset: "LAST_30_DAYS", from: null, to: "", granularity: "DAILY", label: "Last 30 Days" },
  totalSales: 0,
  onlineGcashRevenue: 0,
  payAtCommissaryRevenue: 0,
  paymentMethodBreakdown: { onlineGcash: { amount: 0, receipts: 0 }, payAtCommissary: { amount: 0, receipts: 0 } },
  totalReservations: 0,
  pendingReservations: 0,
  lowStockItems: 0,
  outOfStockItems: 0,
  totalProducts: 0,
  inventoryValue: 0,
  activeUsers: 0,
  roleCounts: { students: 0, staff: 0, admins: 0 },
  receiptsToVerify: 0,
  totalReceipts: 0,
  activeConversations: 0,
  salesTrend: [],
  categorySales: [],
  reservationStatusDistribution: [],
  inventoryInsights: []
};

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
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
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

  const loadSummary = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
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
      const data = await getAdminReportSummaryFromApi(user.accessToken, options, requestController.signal);
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

  return { user, ready, openAuth, summary, loading, initialLoadComplete, error, reload: loadSummary };
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
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-bold uppercase text-primary">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-extrabold text-[#101820]">{title}</h1>
        <p className="mt-2 text-sm text-[#68746d]">{detail}</p>
      </div>
      {action}
    </header>
  );
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
  const iconTone = tone === "red" ? "bg-red-50" : tone === "yellow" ? "bg-[#fff4d8]" : "bg-[#eaf4ea]";
  const content = (
    <article className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm transition hover:border-primary">
      <div className="flex items-start gap-4">
        <span className={`grid size-14 shrink-0 place-items-center rounded-full ${iconTone}`}>
          <AssetIcon src={iconSrc} className="size-10" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#27332c]">{title}</p>
          <p className="mt-1 text-2xl font-extrabold text-primary">{value}</p>
          <p className="mt-1 text-xs text-[#68746d]">{detail}</p>
        </div>
      </div>
    </article>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

export function AdminDashboardLoading() {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-live="polite">
      <span className="sr-only">Loading live admin dashboard data.</span>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm" aria-hidden="true">
          <div className="animate-pulse space-y-3 motion-reduce:animate-none">
            <div className="size-12 rounded-full bg-[#e7f0e7]" />
            <div className="h-3 w-28 rounded-full bg-[#e4ece4]" />
            <div className="h-8 w-24 rounded-md bg-[#d8e6d9]" />
            <div className="h-2.5 w-36 max-w-full rounded-full bg-[#edf3ed]" />
          </div>
        </div>
      ))}
    </section>
  );
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
      <section className="rounded-lg border border-[#dce5dd] bg-white p-6 shadow-sm">
        <p className="font-extrabold text-[#17211b]">Admin sign in required</p>
        <p className="mt-2 text-sm text-[#68746d]">Use an admin Wesleyan account to continue.</p>
        <Button className="mt-5" onClick={openAuth}>Sign in</Button>
      </section>
    );
  }

  if (user.role !== "ADMIN") {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700">This page is restricted to admin accounts.</div>;
  }

  return null;
}
