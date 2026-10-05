"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, ChevronDown, Download, Link2, RefreshCw } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { SiteFooterLinks } from "@/components/layout/SiteFooterLinks";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { ReportDecisionWorkspace } from "@/components/reports/ReportDecisionWorkspace";
import { SalesReportPreview } from "@/components/reports/SalesReportPreview";
import { downloadManagementReportFromApi, getStaffReportSummaryFromApi, isRequestAbortError, type BackendReportSummary, type ReportRangeOptions, type ReportRangePreset } from "@/lib/api";
import { getStoredStaffSession } from "@/lib/staff-api";
import { manilaDateKey } from "@/lib/manila-date";
import { EMPTY_REPORT_SUMMARY } from "@/lib/report-summary";
import { buildReportShareUrl, readReportLinkFilters } from "@/lib/report-link";
import { InlineAlert } from "@/components/ui/InlineAlert";

const emptySummary = EMPTY_REPORT_SUMMARY;

const StaffReportCharts = dynamic(
  () => import("@/components/staff/StaffReportCharts").then((module) => module.StaffReportCharts),
  { ssr: false, loading: () => <div className="h-[310px] animate-pulse rounded-lg bg-muted" /> }
);

type ReportExport = {
  name: string;
  date: string;
  range: string;
  by: string;
  format: "PDF" | "Excel";
};

function formatCurrency(value: number) {
  return `PHP ${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-PH");
}

function formatExportDate() {
  return new Date().toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  });
}

function useStaffReportsSummary(options: ReportRangeOptions) {
  const { user, ready, openAuth } = useStudentAuth();
  const [summary, setSummary] = useState<BackendReportSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasCredential, setHasCredential] = useState(false);
  const requestSequenceRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  const loadSummary = useCallback(async ({ background = false, fresh = false }: { background?: boolean; fresh?: boolean } = {}) => {
    if (!ready) return;

    const requestId = ++requestSequenceRef.current;
    requestAbortRef.current?.abort();
    const requestController = new AbortController();
    requestAbortRef.current = requestController;

    const storedSession = getStoredStaffSession();
    const userCanUseStaffApi = user?.role === "STAFF" || user?.role === "ADMIN";
    const token = userCanUseStaffApi ? user.accessToken ?? "" : !user ? storedSession.token : "";
    setHasCredential(Boolean(token));

    if (!token) {
      requestController.abort();
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const data = await getStaffReportSummaryFromApi(token, options, requestController.signal, fresh);
      if (requestId !== requestSequenceRef.current) return;
      setSummary(data);
    } catch (summaryError) {
      if (requestId === requestSequenceRef.current && !background && !isRequestAbortError(summaryError)) {
        setError(userFacingErrorMessage(summaryError, "Unable to load staff reports."));
      }
    } finally {
      if (requestId === requestSequenceRef.current && !background) setLoading(false);
    }
  }, [options, ready, user]);

  useRealtimeRefresh(["reports"], () => {
    void loadSummary({ background: true });
  });

  useEffect(() => {
    void loadSummary();
    return () => requestAbortRef.current?.abort();
  }, [loadSummary]);

  useEffect(() => {
    if (!hasCredential) return;

    const refresh = () => {
      if (document.visibilityState === "visible") void loadSummary({ background: true });
    };

    const interval = window.setInterval(refresh, 5 * 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [hasCredential, loadSummary]);

  return { user, ready, openAuth, summary, loading, error, hasCredential, reload: () => loadSummary({ fresh: true }) };
}

function StaffReportAccessState({
  ready,
  loading,
  hasCredential,
  user,
  openAuth
}: {
  ready: boolean;
  loading: boolean;
  hasCredential: boolean;
  user: ReturnType<typeof useStudentAuth>["user"];
  openAuth: () => void;
}) {
  if (!ready || (loading && !hasCredential)) {
    return <div className="rounded-lg border bg-white p-6 text-sm font-semibold text-muted-foreground shadow-sm">Loading staff reports...</div>;
  }

  if (user?.role === "STUDENT") {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700">This page is restricted to staff and admin accounts.</div>;
  }

  if (!hasCredential) {
    return (
      <section className="rounded-lg border bg-white p-6 shadow-sm">
        <p className="font-extrabold text-foreground">Staff sign in required</p>
        <p className="mt-2 text-sm text-muted-foreground">Use a staff or admin Wesleyan account to load live reports.</p>
        <Button className="mt-5" onClick={openAuth}>Sign in</Button>
      </section>
    );
  }

  return null;
}

export function StaffReports() {
  const [exports, setExports] = useState<ReportExport[]>([]);
  const [showAllExports, setShowAllExports] = useState(false);
  const [rangePreset, setRangePreset] = useState<ReportRangePreset>("LAST_30_DAYS");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [collectionChannel, setCollectionChannel] = useState<"ALL" | "COMMISSARY" | "TREASURER">("ALL");
  const [reportBasis, setReportBasis] = useState<"COLLECTION" | "COMPLETION">("COLLECTION");
  const [linkStatus, setLinkStatus] = useState<"IDLE" | "COPIED" | "READY">("IDLE");
  const [showSalesReport, setShowSalesReport] = useState(false);
  const reportOptions = useMemo<ReportRangeOptions>(() => rangePreset === "CUSTOM" && (!customFrom || !customTo)
    ? { preset: "LAST_30_DAYS", basis: reportBasis, ...(collectionChannel === "ALL" ? {} : { collectionChannel }) }
    : { preset: rangePreset, basis: reportBasis, ...(rangePreset === "CUSTOM" ? { from: customFrom, to: customTo } : {}), ...(collectionChannel === "ALL" ? {} : { collectionChannel }) }, [collectionChannel, customFrom, customTo, rangePreset, reportBasis]);
  const { user, ready, openAuth, summary, loading, error, hasCredential, reload } = useStaffReportsSummary(reportOptions);

  useEffect(() => {
    const linked = readReportLinkFilters(window.location.search);
    setRangePreset(linked.preset);
    setCustomFrom(linked.from);
    setCustomTo(linked.to);
    setCollectionChannel(linked.collectionChannel);
    setReportBasis(linked.basis);
  }, []);

  const accessState = (
    <StaffReportAccessState
      ready={ready}
      loading={loading}
      hasCredential={hasCredential}
      user={user}
      openAuth={openAuth}
    />
  );

  const reportOwner = user?.fullName || getStoredStaffSession().email || "Staff";
  const reportRange = summary.range.label;

  const copyReportLink = async () => {
    const url = buildReportShareUrl({ currentUrl: window.location.href, preset: rangePreset, from: customFrom, to: customTo, collectionChannel, basis: reportBasis });
    window.history.replaceState({}, "", url);
    try {
      await navigator.clipboard.writeText(url.toString());
      setLinkStatus("COPIED");
    } catch {
      setLinkStatus("READY");
    }
  };

  const recordExport = (format: "PDF" | "Excel", name = "WESCOMM Live Performance Report") => {
    setExports((current) => [
      {
        name,
        date: formatExportDate(),
        range: reportRange,
        by: reportOwner,
        format
      },
      ...current
    ].slice(0, 8));
  };

  const [exportingAnalytics, setExportingAnalytics] = useState(false);

  const exportAnalyticsExcel = async () => {
    const sessionToken = user?.role === "STAFF" || user?.role === "ADMIN" ? user.accessToken ?? "" : getStoredStaffSession().token;
    if (!sessionToken) return;
    setExportingAnalytics(true);
    try {
      const { blob, fileName } = await downloadManagementReportFromApi(sessionToken, reportOptions, "STAFF");
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement("a");
      downloadAnchor.href = url;
      downloadAnchor.download = fileName;
      downloadAnchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      recordExport("Excel", "WESCOMM Management Analytics");
    } catch {
      // Export failures are non-blocking; the on-screen analytics remain available.
    } finally {
      setExportingAnalytics(false);
    }
  };

  const downloadRecordedExport = (report: ReportExport) => {
    const content = [
      "WESCOMM REPORT",
      `Report: ${report.name}`,
      `Date exported: ${report.date}`,
      `Date range: ${report.range}`,
      `Exported by: ${report.by}`,
      `Format: ${report.format}`,
      "",
      `Total sales: ${formatCurrency(summary.totalSales)}`,
      `Commissary collection: ${formatCurrency(summary.commissaryCollection)}`,
      `Treasury collection: ${formatCurrency(summary.treasurerCollection)}`,
      `Total reservations: ${formatNumber(summary.totalReservations)}`,
      `Inventory value: ${formatCurrency(summary.inventoryValue)}`,
      `Items to restock: ${formatNumber(summary.lowStockItems)}`
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${report.name.toLowerCase().replaceAll(" ", "-")}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!ready || !hasCredential || user?.role === "STUDENT") return accessState;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground sm:text-4xl">Reports</h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">Track performance, review trends, and export current WESCOMM reports.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button variant="secondary" className="h-11" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-3 rounded-lg border bg-white p-2 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex gap-1" aria-label="Report sections">
          <button type="button" onClick={() => setShowSalesReport(false)} aria-current={!showSalesReport ? "page" : undefined} className={`rounded-md px-4 py-2.5 text-sm font-bold ${!showSalesReport ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted hover:text-primary"}`}>Overview</button>
          <button type="button" onClick={() => setShowSalesReport(true)} aria-current={showSalesReport ? "page" : undefined} className={`rounded-md px-4 py-2.5 text-sm font-bold ${showSalesReport ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted hover:text-primary"}`}>Sales register</button>
        </nav>
        {!showSalesReport ? (
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-bold text-foreground marker:content-none hover:bg-muted/40">More actions <ChevronDown className="size-4 transition-transform group-open:rotate-180" /></summary>
            <div className="z-20 mt-2 grid gap-1 rounded-md border bg-white p-2 shadow-lg sm:absolute sm:right-0 sm:min-w-64">
              <button type="button" onClick={() => void copyReportLink()} className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold hover:bg-muted"><Link2 className="size-4" />{linkStatus === "COPIED" ? "Link copied" : linkStatus === "READY" ? "Link ready in address bar" : "Copy overview link"}</button>
              <button type="button" onClick={() => void exportAnalyticsExcel()} disabled={exportingAnalytics} className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold hover:bg-muted disabled:opacity-50"><Download className="size-4" />{exportingAnalytics ? "Preparing analytics..." : "Export analytics Excel"}</button>
            </div>
          </details>
        ) : null}
      </div>

      {showSalesReport ? <SalesReportPreview role="STAFF" onClose={() => setShowSalesReport(false)} /> : null}

      <div className={showSalesReport ? "hidden" : "space-y-5"}>

      <section className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-5">
        <label className="grid gap-1.5 text-sm font-bold">Report period
          <select value={rangePreset} onChange={(event) => {
            const next = event.target.value as ReportRangePreset;
            setRangePreset(next);
            if (next === "CUSTOM") {
              const fallback = summary.range.to || manilaDateKey(new Date()) || "";
              setCustomFrom((current) => current || summary.range.from || fallback);
              setCustomTo((current) => current || fallback);
            }
          }} className="h-11 rounded-md border bg-white px-3 outline-none focus:border-primary">
            <option value="TODAY">Today</option><option value="LAST_7_DAYS">Last 7 Days</option><option value="LAST_30_DAYS">Last 30 Days</option><option value="THIS_MONTH">This Month</option><option value="LAST_MONTH">Last Month</option><option value="CUSTOM">Custom Range</option><option value="ALL_TIME">All Time</option>
          </select>
        </label>
        {rangePreset === "CUSTOM" ? <><label className="grid gap-1.5 text-sm font-bold">From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="h-11 rounded-md border px-3 outline-none focus:border-primary" /></label><label className="grid gap-1.5 text-sm font-bold">To<input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} className="h-11 rounded-md border px-3 outline-none focus:border-primary" /></label></> : null}
        <label className="grid gap-1.5 text-sm font-bold">Collection channel<select value={collectionChannel} onChange={(event) => setCollectionChannel(event.target.value as typeof collectionChannel)} className="h-11 rounded-md border bg-white px-3 outline-none focus:border-primary"><option value="ALL">All collections</option><option value="COMMISSARY">Commissary only</option><option value="TREASURER">Treasury only</option></select></label>
        <label className="grid gap-1.5 text-sm font-bold">Trend focus<select value={reportBasis} onChange={(event) => setReportBasis(event.target.value as typeof reportBasis)} className="h-11 rounded-md border bg-white px-3 outline-none focus:border-primary"><option value="COLLECTION">Cash collections</option><option value="COMPLETION">Completed sales</option></select></label>
        {rangePreset !== "CUSTOM" ? <div className="self-end xl:col-span-2"><p className="rounded-md bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground">Cash uses payment date. Recognized sales use completion date. The trend selector changes the main chart only.</p></div> : null}
      </section>

      <div className="w-fit rounded-md border border-border-strong bg-white px-3 py-2 text-sm font-semibold text-foreground">
        Report range: <span className="text-primary">{reportRange}</span>
      </div>

      {error ? <InlineAlert>{error}</InlineAlert> : null}
      {loading ? <div className="rounded-lg border bg-white p-6 text-sm font-semibold text-muted-foreground shadow-sm">Loading live report data...</div> : null}
      {summary.unverifiedInventoryQuantity || summary.uncostedQuantity ? <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Cost review needed: {formatNumber(summary.unverifiedInventoryQuantity)} remaining item(s) have an unverified opening cost and {formatNumber(summary.uncostedQuantity)} sold item(s) have incomplete cost allocation.</p> : null}

      <ReportDecisionWorkspace summary={summary} reservationBasePath="/staff/reservations" />

      <section id="cash-collections" className="scroll-mt-24 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="font-extrabold text-foreground">Commissary cash collection</h2>
          <p className="mt-1 text-xs text-muted-foreground">Current cash-only operations. Historical non-cash records are in the collapsed audit section above.</p>
          <dl className="mt-4 divide-y divide-border text-sm"><div className="flex items-center justify-between gap-4 py-3"><dt><span className="font-bold">Cash</span><span className="ml-2 text-xs text-muted-foreground">{formatNumber(summary.commissaryPaymentBreakdown.cash.payments)} payment(s)</span></dt><dd className="font-extrabold text-primary">{formatCurrency(summary.commissaryPaymentBreakdown.cash.amount)}</dd></div></dl>
        </div>
        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <div className="border-b border-border px-5 py-4"><h2 className="font-extrabold text-foreground">Treasury collection report</h2><p className="mt-1 text-xs text-muted-foreground">Treasury payments only, with the required official receipt number.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{["Date", "OR number", "Order", "Items", "Amount"].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-border">{summary.treasurerCollections.length ? summary.treasurerCollections.map((payment) => <tr key={payment.paymentId}><td className="px-4 py-3">{new Date(payment.paidAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</td><td className={payment.officialReceiptNumber ? "px-4 py-3 font-bold" : "px-4 py-3 font-bold text-red-700"}>{payment.officialReceiptNumber ?? "Missing OR"}</td><td className="px-4 py-3">{payment.orderReference}</td><td className="max-w-xs px-4 py-3 text-muted-foreground">{payment.items}</td><td className="px-4 py-3 font-extrabold text-primary">{formatCurrency(payment.amount)}</td></tr>) : <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No Treasury collections in this range.</td></tr>}</tbody></table></div>
        </div>
      </section>

      <section id="walk-in-sales" className="scroll-mt-24 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="font-extrabold text-foreground">Walk-in sales</h2>
          <p className="mt-1 text-xs text-muted-foreground">Over-the-counter cash purchases recorded by staff, already included in cash collections.</p>
          <dl className="mt-4 divide-y divide-border text-sm">
            <div className="flex items-center justify-between gap-4 py-3"><dt className="font-bold">Sales<span className="ml-2 text-xs text-muted-foreground">{formatNumber(summary.walkInSales.receipts)} receipt(s)</span></dt><dd className="font-extrabold text-primary">{formatCurrency(summary.walkInSales.amount)}</dd></div>
            <div className="flex items-center justify-between gap-4 py-3"><dt className="font-bold">COGS</dt><dd className="font-extrabold">{formatCurrency(summary.walkInSales.cogs)}</dd></div>
            <div className="flex items-center justify-between gap-4 py-3"><dt className="font-bold">Voids<span className="ml-2 text-xs text-muted-foreground">{formatNumber(summary.walkInVoids.count)} voided</span></dt><dd className="font-extrabold text-red-700">{formatCurrency(summary.walkInVoids.amount)}</dd></div>
          </dl>
        </div>
        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <div className="border-b border-border px-5 py-4"><h2 className="font-extrabold text-foreground">Cashier reconciliation</h2><p className="mt-1 text-xs text-muted-foreground">Walk-in sales and voids per cashier for the selected period.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{["Cashier", "Sales", "Sale amount", "Voids", "Void amount"].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-border">{summary.cashierReconciliation.length ? summary.cashierReconciliation.map((row) => <tr key={`${row.cashierId ?? row.cashierName}`}><td className="px-4 py-3 font-semibold">{row.cashierName}</td><td className="px-4 py-3">{formatNumber(row.saleCount)}</td><td className="px-4 py-3 font-extrabold text-primary">{formatCurrency(row.sales)}</td><td className="px-4 py-3">{formatNumber(row.voidCount)}</td><td className="px-4 py-3 font-bold text-red-700">{formatCurrency(row.voids)}</td></tr>) : <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No walk-in sales in this range.</td></tr>}</tbody></table></div>
        </div>
      </section>

      <StaffReportCharts summary={summary} />

      <section>
        <details className="group overflow-hidden rounded-lg border bg-white shadow-sm">
          <summary className="flex min-h-[72px] cursor-pointer list-none items-center gap-3 px-4 py-3 marker:content-none sm:px-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-muted">
              <AssetIcon src="/assets/download.svg" className="size-8" />
            </span>
            <span className="min-w-0">
              <span className="block font-extrabold text-foreground">Recent Report Exports</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{exports.length} generated report file{exports.length === 1 ? "" : "s"} this session</span>
            </span>
            <ChevronDown className="ml-auto size-5 shrink-0 text-primary transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border">
            {exports.length ? (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[680px] text-left text-xs">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        {["Report Name", "Date Exported", "Date Range", "Exported By", "Format", "Action"].map((heading) => (
                          <th key={heading} className="px-4 py-3 font-bold">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(showAllExports ? exports : exports.slice(0, 5)).map((report, index) => (
                        <tr key={`${report.name}-${index}`}>
                          <td className="px-4 py-3 font-semibold">{report.name}</td>
                          <td className="px-4 py-3">{report.date}</td>
                          <td className="px-4 py-3">{report.range}</td>
                          <td className="px-4 py-3">{report.by}</td>
                          <td className="px-4 py-3">{report.format}</td>
                          <td className="px-4 py-3">
                            <button type="button" onClick={() => downloadRecordedExport(report)} aria-label={`Download ${report.name}`} className="grid size-8 place-items-center rounded-md text-primary hover:bg-muted">
                              <Download className="size-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="divide-y divide-border md:hidden">
                  {(showAllExports ? exports : exports.slice(0, 5)).map((report, index) => (
                    <article key={`${report.name}-${index}`} className="p-4">
                      <div className="flex gap-3">
                        <AssetIcon src="/assets/digital-receipts.svg" className="size-8" />
                        <div className="min-w-0">
                          <h3 className="font-bold">{report.name}</h3>
                          <p className="mt-1 text-xs text-muted-foreground">{report.date}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{report.range} - {report.format}</p>
                        </div>
                        <button type="button" onClick={() => downloadRecordedExport(report)} aria-label={`Download ${report.name}`} className="ml-auto grid size-9 place-items-center rounded-md text-primary hover:bg-muted"><Download className="size-4" /></button>
                      </div>
                    </article>
                  ))}
                </div>
                <button type="button" onClick={() => setShowAllExports((current) => !current)} className="flex min-h-12 items-center gap-2 border-t border-border px-4 text-sm font-bold text-primary">
                  {showAllExports ? "Show recent exports" : "View all exports"} <ArrowRight className="size-4" />
                </button>
              </>
            ) : (
              <div className="p-5 text-sm font-semibold text-muted-foreground">No analytics exports yet. Open More actions and choose Export analytics Excel.</div>
            )}
          </div>
        </details>

      </section>

      </div>

      <footer className="flex flex-col items-center gap-4 border-t border-border py-6 text-center text-xs text-muted-foreground md:flex-row md:justify-between md:text-left">
        <div className="flex items-center justify-center gap-3 md:justify-start">
          <AssetIcon src="/assets/wescomm-logo-ui.webp" className="h-10 w-24" />
          <div>
            <p className="font-extrabold text-foreground">Wesleyan University-Philippines</p>
            <p>Integrated Commissary Management System</p>
          </div>
        </div>
        <SiteFooterLinks />
        <p className="md:text-right">© 2026 Wesleyan University-Philippines</p>
      </footer>
    </div>
  );
}
