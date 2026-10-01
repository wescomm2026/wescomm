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
import { getStaffReportSummaryFromApi, isRequestAbortError, type BackendReportSummary, type ReportRangeOptions, type ReportRangePreset } from "@/lib/api";
import { exportStyledExcelWorkbook } from "@/lib/excel-export";
import { getStoredStaffSession } from "@/lib/staff-api";
import { manilaDateKey } from "@/lib/manila-date";
import { EMPTY_REPORT_SUMMARY } from "@/lib/report-summary";
import { buildReportShareUrl, readReportLinkFilters } from "@/lib/report-link";

const emptySummary = EMPTY_REPORT_SUMMARY;

const StaffReportCharts = dynamic(
  () => import("@/components/staff/StaffReportCharts").then((module) => module.StaffReportCharts),
  { ssr: false, loading: () => <div className="h-[310px] animate-pulse rounded-lg bg-[#edf3ed]" /> }
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
    return <div className="rounded-lg border border-border bg-white p-6 text-sm font-semibold text-muted-foreground shadow-sm">Loading staff reports...</div>;
  }

  if (user?.role === "STUDENT") {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700">This page is restricted to staff and admin accounts.</div>;
  }

  if (!hasCredential) {
    return (
      <section className="rounded-lg border border-border bg-white p-6 shadow-sm">
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

  const recordExport = (format: "PDF" | "Excel") => {
    setExports((current) => [
      {
        name: "WESCOMM Live Performance Report",
        date: formatExportDate(),
        range: reportRange,
        by: reportOwner,
        format
      },
      ...current
    ].slice(0, 8));
  };

  const exportExcel = () => {
    exportStyledExcelWorkbook({
      fileName: "wescomm-staff-report.xls",
      title: "WESCOMM Staff Performance Report",
      subtitle: "Wesleyan Integrated Commissary Management System",
      metadata: [
        ["Date exported", formatExportDate()],
        ["Server generated at", summary.generatedAt ? new Date(summary.generatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "Not available"],
        ["Report range", reportRange],
        ["Timezone", "Asia/Manila"],
        ["Trend focus", summary.reportBasis === "COLLECTION" ? "Cash collections by payment date" : "Recognized sales by completion date"],
        ["Collection filter", summary.filters.collectionChannel],
        ["Cash-only effective date", new Date(summary.cashOnlyPolicy.effectiveAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })],
        ["Exported by", reportOwner],
        ["Information source", "Current WESCOMM records"]
      ],
      worksheets: [
        { name: "Summary", sections: [{
          title: "Summary Metrics",
          headers: ["Metric", "Value", "Previous Period", "Change", "Definition"],
          rows: [
            ["Cash collected", formatCurrency(summary.cashRevenue), formatCurrency(summary.comparison.cashRevenue.previous), summary.comparison.cashRevenue.percentChange === null ? "No baseline" : `${summary.comparison.cashRevenue.percentChange}%`, "Verified CASH payments by paid date"],
            ["Recognized sales", formatCurrency(summary.totalSales), formatCurrency(summary.comparison.recognizedSales.previous), summary.comparison.recognizedSales.percentChange === null ? "No baseline" : `${summary.comparison.recognizedSales.percentChange}%`, "Completed reservations with verified receipt and paid payment"],
            ["Gross profit", formatCurrency(summary.grossProfit), formatCurrency(summary.comparison.grossProfit.previous), summary.comparison.grossProfit.percentChange === null ? "No baseline" : `${summary.comparison.grossProfit.percentChange}%`, "Recognized sales minus FIFO cost"],
            ["Reservations created", formatNumber(summary.totalReservations), formatNumber(summary.comparison.reservations.previous), summary.comparison.reservations.percentChange === null ? "No baseline" : `${summary.comparison.reservations.percentChange}%`, "Reservations created in the selected period"],
            ["Inventory value", formatCurrency(summary.inventoryValue), "", "", "Remaining quantity times verified acquisition cost"],
            ["Reconciliation issues", formatNumber(summary.reconciliation.exceptionCount), "", "", `Estimated amount requiring reconciliation: ${formatCurrency(summary.reconciliation.amountAtRisk)}`]
          ]
        }] },
        { name: "Cash Collections", sections: [
          { title: "Cash by Location", headers: ["Location", "Amount", "Payments"], rows: [
            ["Commissary", formatCurrency(summary.commissaryCashRevenue), summary.cashCollectionChannelBreakdown.commissary.payments],
            ["Treasury", formatCurrency(summary.treasuryCashRevenue), summary.cashCollectionChannelBreakdown.treasurer.payments]
          ] },
          { title: "Cash Trend", headers: ["Period", "Amount", "Payments"], rows: summary.collectionTrend.map((item) => [item.day, formatCurrency(item.sales), item.receipts]) },
          { title: "Treasury OR Traceability", headers: ["Paid Date", "OR Number", "Reservation", "Items", "Amount"], rows: summary.treasurerCollections.map((item) => [new Date(item.paidAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" }), item.officialReceiptNumber ?? "Missing OR", item.orderReference, item.items, formatCurrency(item.amount)]) }
        ] },
        { name: "Walk-in Sales", sections: [
          { title: "Walk-in Summary", headers: ["Metric", "Value"], rows: [
            ["Walk-in sales", formatCurrency(summary.walkInSales.amount)],
            ["Walk-in receipts", formatNumber(summary.walkInSales.receipts)],
            ["Walk-in COGS", formatCurrency(summary.walkInSales.cogs)],
            ["Voided walk-in sales", formatNumber(summary.walkInVoids.count)],
            ["Voided walk-in amount", formatCurrency(summary.walkInVoids.amount)]
          ] },
          { title: "Cashier Reconciliation", headers: ["Cashier", "Sales", "Sale Amount", "Voids", "Void Amount"], rows: summary.cashierReconciliation.length ? summary.cashierReconciliation.map((row) => [row.cashierName, formatNumber(row.saleCount), formatCurrency(row.sales), formatNumber(row.voidCount), formatCurrency(row.voids)]) : [["No walk-in sales", "0", "PHP 0.00", "0", "PHP 0.00"]] }
        ] },
        { name: "Reconciliation", sections: [{
          title: "Exceptions",
          headers: ["Priority", "Issue", "Reservation", "Date", "Amount", "Payment ID", "Receipt ID"],
          rows: summary.reconciliation.items.length ? summary.reconciliation.items.map((item) => [item.severity, item.label, item.referenceCode, new Date(item.eventAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" }), formatCurrency(item.amount), item.paymentId, item.receiptId]) : [["CLEAN", "No reconciliation issue found", "", "", "", "", ""]]
        }] },
        { name: "Products and Margin", sections: [{
          title: "Product Performance",
          headers: ["Product", "Category", "Units", "Sales", "COGS", "Gross Profit", "Margin"],
          rows: summary.itemSales.map((item) => [item.item, item.category, item.quantity, formatCurrency(item.sales), formatCurrency(item.cogs), formatCurrency(item.grossProfit), item.marginPercent === null ? "Not available" : `${item.marginPercent}%`])
        }] },
        { name: "Inventory Actions", sections: [{
          title: "Inventory Planning",
          headers: ["Product", "Category", "Status", "Stock", "Units Sold", "Stock Cover", "Suggested Reorder", "Action"],
          rows: summary.inventoryPlanning.map((item) => [item.item, item.category, item.status, item.stock, item.unitsSold, item.stockCoverDays === null ? "No demand yet" : `${item.stockCoverDays} days`, item.suggestedReorderQuantity, item.recommendation])
        }] },
        { name: "Legacy Payments", sections: [{
          title: "Historical Audit Only",
          headers: ["Type", "Amount", "Records", "Operational Status"],
          rows: [
            ["Legacy online", formatCurrency(summary.legacyOnlineRevenue), summary.paymentMethodBreakdown.legacyOnline.receipts, "Not available for new payments"],
            ["Legacy in-person non-cash", formatCurrency(summary.legacyInPersonRevenue), summary.paymentMethodBreakdown.legacyInPerson.receipts, "Not available for new payments"]
          ]
        }] }
      ]
    });
    recordExport("Excel");
  };

  const exportPdf = () => {
    recordExport("PDF");
    window.print();
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
          <h1 className="text-3xl font-extrabold text-[#111a15] sm:text-4xl">Reports</h1>
          <p className="mt-2 text-sm text-[#606c64] sm:text-base">Track performance, review trends, and export current WESCOMM reports.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button variant="secondary" className="h-11" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button variant="secondary" className="h-11" onClick={() => void copyReportLink()}>
            <Link2 className="size-4" />
            {linkStatus === "COPIED" ? "Link Copied" : linkStatus === "READY" ? "Link Ready in Address Bar" : "Copy Link"}
          </Button>
          <Button variant="secondary" className="h-11" onClick={exportPdf}>
            <AssetIcon src="/assets/digital-receipts.svg" className="size-6" />
            Export PDF
          </Button>
          <Button variant="secondary" className="h-11" onClick={exportExcel}>
            <AssetIcon src="/assets/download.svg" className="size-6" />
            Export Excel
          </Button>
        </div>
      </header>

      <section className="grid gap-3 rounded-lg border border-border bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-5">
        <label className="grid gap-1.5 text-sm font-bold">Report period
          <select value={rangePreset} onChange={(event) => {
            const next = event.target.value as ReportRangePreset;
            setRangePreset(next);
            if (next === "CUSTOM") {
              const fallback = summary.range.to || manilaDateKey(new Date()) || "";
              setCustomFrom((current) => current || summary.range.from || fallback);
              setCustomTo((current) => current || fallback);
            }
          }} className="h-11 rounded-md border border-border bg-white px-3 outline-none focus:border-primary">
            <option value="TODAY">Today</option><option value="LAST_7_DAYS">Last 7 Days</option><option value="LAST_30_DAYS">Last 30 Days</option><option value="THIS_MONTH">This Month</option><option value="LAST_MONTH">Last Month</option><option value="CUSTOM">Custom Range</option><option value="ALL_TIME">All Time</option>
          </select>
        </label>
        {rangePreset === "CUSTOM" ? <><label className="grid gap-1.5 text-sm font-bold">From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="h-11 rounded-md border border-border px-3 outline-none focus:border-primary" /></label><label className="grid gap-1.5 text-sm font-bold">To<input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} className="h-11 rounded-md border border-border px-3 outline-none focus:border-primary" /></label></> : null}
        <label className="grid gap-1.5 text-sm font-bold">Collection channel<select value={collectionChannel} onChange={(event) => setCollectionChannel(event.target.value as typeof collectionChannel)} className="h-11 rounded-md border border-border bg-white px-3 outline-none focus:border-primary"><option value="ALL">All collections</option><option value="COMMISSARY">Commissary only</option><option value="TREASURER">Treasury only</option></select></label>
        <label className="grid gap-1.5 text-sm font-bold">Trend focus<select value={reportBasis} onChange={(event) => setReportBasis(event.target.value as typeof reportBasis)} className="h-11 rounded-md border border-border bg-white px-3 outline-none focus:border-primary"><option value="COLLECTION">Cash collections</option><option value="COMPLETION">Completed sales</option></select></label>
        {rangePreset !== "CUSTOM" ? <div className="self-end xl:col-span-2"><p className="rounded-md bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground">Cash uses payment date. Recognized sales use completion date. The trend selector changes the main chart only.</p></div> : null}
      </section>

      <div className="w-fit rounded-md border border-[#d7e0d8] bg-white px-3 py-2 text-sm font-semibold text-[#344139]">
        Report range: <span className="text-primary">{reportRange}</span>
      </div>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      {loading ? <div className="rounded-lg border border-border bg-white p-6 text-sm font-semibold text-muted-foreground shadow-sm">Loading live report data...</div> : null}
      {summary.unverifiedInventoryQuantity || summary.uncostedQuantity ? <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Cost review needed: {formatNumber(summary.unverifiedInventoryQuantity)} remaining item(s) have an unverified opening cost and {formatNumber(summary.uncostedQuantity)} sold item(s) have incomplete cost allocation.</p> : null}

      <ReportDecisionWorkspace summary={summary} reservationBasePath="/staff/reservations" />

      <section id="cash-collections" className="scroll-mt-24 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border border-border bg-white p-5 shadow-sm">
          <h2 className="font-extrabold text-foreground">Commissary cash collection</h2>
          <p className="mt-1 text-xs text-muted-foreground">Current cash-only operations. Historical non-cash records are in the collapsed audit section above.</p>
          <dl className="mt-4 divide-y divide-border text-sm"><div className="flex items-center justify-between gap-4 py-3"><dt><span className="font-bold">Cash</span><span className="ml-2 text-xs text-muted-foreground">{formatNumber(summary.commissaryPaymentBreakdown.cash.payments)} payment(s)</span></dt><dd className="font-extrabold text-primary">{formatCurrency(summary.commissaryPaymentBreakdown.cash.amount)}</dd></div></dl>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
          <div className="border-b border-border px-5 py-4"><h2 className="font-extrabold text-foreground">Treasury collection report</h2><p className="mt-1 text-xs text-muted-foreground">Treasury payments only, with the required official receipt number.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{["Date", "OR number", "Order", "Items", "Amount"].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-border">{summary.treasurerCollections.length ? summary.treasurerCollections.map((payment) => <tr key={payment.paymentId}><td className="px-4 py-3">{new Date(payment.paidAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</td><td className={payment.officialReceiptNumber ? "px-4 py-3 font-bold" : "px-4 py-3 font-bold text-red-700"}>{payment.officialReceiptNumber ?? "Missing OR"}</td><td className="px-4 py-3">{payment.orderReference}</td><td className="max-w-xs px-4 py-3 text-muted-foreground">{payment.items}</td><td className="px-4 py-3 font-extrabold text-primary">{formatCurrency(payment.amount)}</td></tr>) : <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No Treasury collections in this range.</td></tr>}</tbody></table></div>
        </div>
      </section>

      <section id="walk-in-sales" className="scroll-mt-24 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border border-border bg-white p-5 shadow-sm">
          <h2 className="font-extrabold text-foreground">Walk-in sales</h2>
          <p className="mt-1 text-xs text-muted-foreground">Over-the-counter cash purchases recorded by staff, already included in cash collections.</p>
          <dl className="mt-4 divide-y divide-border text-sm">
            <div className="flex items-center justify-between gap-4 py-3"><dt className="font-bold">Sales<span className="ml-2 text-xs text-muted-foreground">{formatNumber(summary.walkInSales.receipts)} receipt(s)</span></dt><dd className="font-extrabold text-primary">{formatCurrency(summary.walkInSales.amount)}</dd></div>
            <div className="flex items-center justify-between gap-4 py-3"><dt className="font-bold">COGS</dt><dd className="font-extrabold">{formatCurrency(summary.walkInSales.cogs)}</dd></div>
            <div className="flex items-center justify-between gap-4 py-3"><dt className="font-bold">Voids<span className="ml-2 text-xs text-muted-foreground">{formatNumber(summary.walkInVoids.count)} voided</span></dt><dd className="font-extrabold text-red-700">{formatCurrency(summary.walkInVoids.amount)}</dd></div>
          </dl>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
          <div className="border-b border-border px-5 py-4"><h2 className="font-extrabold text-foreground">Cashier reconciliation</h2><p className="mt-1 text-xs text-muted-foreground">Walk-in sales and voids per cashier for the selected period.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{["Cashier", "Sales", "Sale amount", "Voids", "Void amount"].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-border">{summary.cashierReconciliation.length ? summary.cashierReconciliation.map((row) => <tr key={`${row.cashierId ?? row.cashierName}`}><td className="px-4 py-3 font-semibold">{row.cashierName}</td><td className="px-4 py-3">{formatNumber(row.saleCount)}</td><td className="px-4 py-3 font-extrabold text-primary">{formatCurrency(row.sales)}</td><td className="px-4 py-3">{formatNumber(row.voidCount)}</td><td className="px-4 py-3 font-bold text-red-700">{formatCurrency(row.voids)}</td></tr>) : <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No walk-in sales in this range.</td></tr>}</tbody></table></div>
        </div>
      </section>

      <StaffReportCharts summary={summary} />

      <section>
        <details className="group overflow-hidden rounded-lg border border-border bg-white shadow-sm">
          <summary className="flex min-h-[72px] cursor-pointer list-none items-center gap-3 px-4 py-3 marker:content-none sm:px-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#eef6ee]">
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
                            <button type="button" onClick={() => downloadRecordedExport(report)} aria-label={`Download ${report.name}`} className="grid size-8 place-items-center rounded-md text-primary hover:bg-[#eef6ee]">
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
                        <button type="button" onClick={() => downloadRecordedExport(report)} aria-label={`Download ${report.name}`} className="ml-auto grid size-9 place-items-center rounded-md text-primary hover:bg-[#eef6ee]"><Download className="size-4" /></button>
                      </div>
                    </article>
                  ))}
                </div>
                <button type="button" onClick={() => setShowAllExports((current) => !current)} className="flex min-h-12 items-center gap-2 border-t border-border px-4 text-sm font-bold text-primary">
                  {showAllExports ? "Show recent exports" : "View all exports"} <ArrowRight className="size-4" />
                </button>
              </>
            ) : (
              <div className="p-5 text-sm font-semibold text-muted-foreground">No exported reports yet. Use Export PDF or Export Excel to create one from the live data.</div>
            )}
          </div>
        </details>

      </section>

      <footer className="flex flex-col items-center gap-4 border-t border-[#e2e8e3] py-6 text-center text-xs text-[#68736c] md:flex-row md:justify-between md:text-left">
        <div className="flex items-center justify-center gap-3 md:justify-start">
          <AssetIcon src="/assets/wescomm-logo-ui.webp" className="h-10 w-24" />
          <div>
            <p className="font-extrabold text-[#26322b]">Wesleyan University-Philippines</p>
            <p>Integrated Commissary Management System</p>
          </div>
        </div>
        <SiteFooterLinks />
        <p className="md:text-right">© 2026 Wesleyan University-Philippines</p>
      </footer>
    </div>
  );
}
