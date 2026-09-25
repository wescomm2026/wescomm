"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, ChevronDown, Download, RefreshCw } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { SiteFooterLinks } from "@/components/layout/SiteFooterLinks";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SalesByCategory } from "@/components/reports/SalesByCategory";
import { getStaffReportSummaryFromApi, isRequestAbortError, type BackendReportSummary, type ReportRangeOptions, type ReportRangePreset } from "@/lib/api";
import { exportStyledExcelWorkbook } from "@/lib/excel-export";
import { getStoredStaffSession } from "@/lib/staff-api";
import { manilaDateKey } from "@/lib/manila-date";

const emptySummary: BackendReportSummary = {
  range: { preset: "LAST_30_DAYS", from: null, to: "", granularity: "DAILY", label: "Last 30 Days" },
  totalSales: 0,
  cogs: 0,
  grossProfit: 0,
  commissaryCollection: 0,
  treasurerCollection: 0,
  collectionChannelBreakdown: { commissary: { amount: 0, payments: 0 }, treasurer: { amount: 0, payments: 0 } },
  commissaryPaymentBreakdown: { cash: { amount: 0, payments: 0 }, gcash: { amount: 0, payments: 0 }, other: { amount: 0, payments: 0 } },
  treasurerCollections: [],
  uncostedQuantity: 0,
  unverifiedInventoryQuantity: 0,
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
  itemSales: [],
  reservationStatusDistribution: [],
  inventoryInsights: []
};

const statusColors = ["#16803c", "#8cc665", "#f5b000", "#9aa3a8", "#00652f"];
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

function ReportStat({
  title,
  value,
  detail,
  iconSrc,
  warning = false
}: {
  title: string;
  value: string;
  detail: string;
  iconSrc: string;
  warning?: boolean;
}) {
  return (
    <article className="rounded-lg border border-border bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <span className={warning ? "grid size-16 shrink-0 place-items-center rounded-full bg-[#fff2d4]" : "grid size-16 shrink-0 place-items-center rounded-full bg-[#eaf4ea]"}>
          <AssetIcon src={iconSrc} className="size-11" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#27332c]">{title}</p>
          <p className={warning ? "mt-1 text-2xl font-extrabold text-[#f0a400]" : "mt-1 text-2xl font-extrabold text-primary"}>{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
    </article>
  );
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

function insightIcon(insight: BackendReportSummary["inventoryInsights"][number]) {
  if (insight.impact === "High") return "/assets/low-stock.svg";
  if (insight.impact === "Positive") return "/assets/in-stock.svg";
  return "/assets/restock-soon.svg";
}

export function StaffReports() {
  const [exports, setExports] = useState<ReportExport[]>([]);
  const [showAllExports, setShowAllExports] = useState(false);
  const [rangePreset, setRangePreset] = useState<ReportRangePreset>("LAST_30_DAYS");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [collectionChannel, setCollectionChannel] = useState<"ALL" | "COMMISSARY" | "TREASURER">("ALL");
  const reportOptions = useMemo<ReportRangeOptions>(() => rangePreset === "CUSTOM" && (!customFrom || !customTo)
    ? { preset: "LAST_30_DAYS", ...(collectionChannel === "ALL" ? {} : { collectionChannel }) }
    : { preset: rangePreset, ...(rangePreset === "CUSTOM" ? { from: customFrom, to: customTo } : {}), ...(collectionChannel === "ALL" ? {} : { collectionChannel }) }, [collectionChannel, customFrom, customTo, rangePreset]);
  const { user, ready, openAuth, summary, loading, error, hasCredential, reload } = useStaffReportsSummary(reportOptions);

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

  const reservationStatus = useMemo(
    () =>
      summary.reservationStatusDistribution.map((status, index) => ({
        name: status.label,
        value: status.value,
        color: statusColors[index % statusColors.length]
      })),
    [summary.reservationStatusDistribution]
  );

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
      worksheetName: "Staff Report",
      title: "WESCOMM Staff Performance Report",
      subtitle: "Wesleyan Integrated Commissary Management System",
      metadata: [
        ["Date exported", formatExportDate()],
        ["Report range", reportRange],
        ["Exported by", reportOwner],
        ["Information source", "Current WESCOMM records"]
      ],
      sections: [
        {
          title: "Summary Metrics",
          headers: ["Metric", "Value", "Operational Note"],
          rows: [
            ["Total Sales", formatCurrency(summary.totalSales), `${formatNumber(summary.totalReceipts)} verified receipt records`],
            ["Commissary Collection", formatCurrency(summary.commissaryCollection), `${formatNumber(summary.collectionChannelBreakdown.commissary.payments)} payments`],
            ["Treasury Collection", formatCurrency(summary.treasurerCollection), `${formatNumber(summary.collectionChannelBreakdown.treasurer.payments)} payments with OR tracking`],
            ["GCash – Online Revenue", formatCurrency(summary.onlineGcashRevenue), `${formatNumber(summary.paymentMethodBreakdown.onlineGcash.receipts)} verified receipts`],
            ["In-person Payment Revenue", formatCurrency(summary.payAtCommissaryRevenue), `${formatNumber(summary.paymentMethodBreakdown.payAtCommissary.receipts)} verified receipts`],
            ["Total Reservations", formatNumber(summary.totalReservations), `${formatNumber(summary.pendingReservations)} pending staff review`],
            ["Inventory Value", formatCurrency(summary.inventoryValue), `${formatNumber(summary.totalProducts)} active products`],
            ["Items Needing Restock", formatNumber(summary.lowStockItems), "Products at or below the staff restock alert count"],
            ["Receipts to Verify", formatNumber(summary.receiptsToVerify), "Digital receipts waiting for staff action"],
            ["Active Conversations", formatNumber(summary.activeConversations), "Student support threads currently open"]
          ]
        },
        {
          title: "Sales Trend",
          headers: ["Day", "Sales"],
          rows: summary.salesTrend.length
            ? summary.salesTrend.map((item) => [item.day, formatCurrency(item.sales)])
            : [["No sales trend data yet", ""]]
        },
        {
          title: "Top Categories by Sales",
          headers: ["Category", "Sales"],
          rows: summary.categorySales.length
            ? summary.categorySales.map((item) => [item.category, formatCurrency(item.amount)])
            : [["No category sales data yet", ""]]
        },
        {
          title: "Reservation Status Distribution",
          headers: ["Status", "Reservations"],
          rows: reservationStatus.length
            ? reservationStatus.map((status) => [status.name, formatNumber(status.value)])
            : [["No reservation status data yet", ""]]
        },
        {
          title: "Inventory Insights",
          headers: ["Insight", "Impact", "Recommendation"],
          rows: summary.inventoryInsights.length
            ? summary.inventoryInsights.map((insight) => [insight.insight, insight.impact, insight.recommendation])
            : [["No inventory insights available yet", "", ""]]
        }
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
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant="secondary" className="h-11" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className="size-4" />
            Refresh
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

      <section className="grid gap-3 rounded-lg border border-border bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1.5 text-sm font-bold">Revenue period
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
        {rangePreset !== "CUSTOM" ? <div className="self-end xl:col-span-2"><p className="rounded-md bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground">Sales use completed releases; collections use the actual payment date.</p></div> : null}
      </section>

      <div className="w-fit rounded-md border border-[#d7e0d8] bg-white px-3 py-2 text-sm font-semibold text-[#344139]">
        Report range: <span className="text-primary">{reportRange}</span>
      </div>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      {loading ? <div className="rounded-lg border border-border bg-white p-6 text-sm font-semibold text-muted-foreground shadow-sm">Loading live report data...</div> : null}
      {summary.unverifiedInventoryQuantity || summary.uncostedQuantity ? <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Cost review needed: {formatNumber(summary.unverifiedInventoryQuantity)} remaining item(s) have an unverified opening cost and {formatNumber(summary.uncostedQuantity)} sold item(s) have incomplete cost allocation.</p> : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStat title="Total Sales" value={formatCurrency(summary.totalSales)} detail={`${formatNumber(summary.totalReceipts)} receipts recorded`} iconSrc="/assets/cash.svg" />
        <ReportStat title="COGS" value={formatCurrency(summary.cogs)} detail="Actual FIFO inventory cost" iconSrc="/assets/all-items.svg" />
        <ReportStat title="Inventory Value" value={formatCurrency(summary.inventoryValue)} detail={`${formatNumber(summary.totalProducts)} active products`} iconSrc="/assets/all-items.svg" />
        <ReportStat title="Gross Profit" value={formatCurrency(summary.grossProfit)} detail="Sales minus COGS" iconSrc="/assets/orders.svg" />
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <ReportStat title="Commissary Collection" value={formatCurrency(summary.commissaryCollection)} detail={`${formatNumber(summary.collectionChannelBreakdown.commissary.payments)} payments`} iconSrc="/assets/cash.svg" />
        <ReportStat title="Treasury Collection" value={formatCurrency(summary.treasurerCollection)} detail={`${formatNumber(summary.collectionChannelBreakdown.treasurer.payments)} payments with OR tracking`} iconSrc="/assets/verified.svg" />
        <ReportStat title="GCash Payments" value={formatCurrency(summary.onlineGcashRevenue)} detail={`${formatNumber(summary.paymentMethodBreakdown.onlineGcash.receipts)} payments`} iconSrc="/assets/e-wallet.svg" />
      </section>

      <SalesByCategory categorySales={summary.categorySales} itemSales={summary.itemSales} description="Top 3 categories by sales are shown first. Select one to see its individual items." />

      <section className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
        <div className="border-b border-border px-4 py-4 sm:px-5"><h2 className="font-extrabold text-foreground">Sales by item</h2><p className="mt-1 text-xs text-muted-foreground">Selling price and actual FIFO cost are preserved per completed order.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{["Item", "Category", "Qty sold", "Sales", "COGS", "Gross profit"].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-border">{summary.itemSales.length ? summary.itemSales.map((item) => <tr key={item.productId}><td className="px-4 py-3 font-bold">{item.item}</td><td className="px-4 py-3 text-muted-foreground">{item.category}</td><td className="px-4 py-3">{formatNumber(item.quantity)}</td><td className="px-4 py-3">{formatCurrency(item.sales)}</td><td className="px-4 py-3">{formatCurrency(item.cogs)}</td><td className="px-4 py-3 font-extrabold text-primary">{formatCurrency(item.grossProfit)}</td></tr>) : <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No completed sales in this range.</td></tr>}</tbody></table></div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border border-border bg-white p-5 shadow-sm">
          <h2 className="font-extrabold text-foreground">Commissary collection</h2>
          <p className="mt-1 text-xs text-muted-foreground">Only payments collected by the Commissary.</p>
          <dl className="mt-4 divide-y divide-border text-sm">
            {([['Cash', summary.commissaryPaymentBreakdown.cash], ['GCash', summary.commissaryPaymentBreakdown.gcash], ['Other', summary.commissaryPaymentBreakdown.other]] as const).map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 py-3"><dt><span className="font-bold">{label}</span><span className="ml-2 text-xs text-muted-foreground">{formatNumber(value.payments)} payment(s)</span></dt><dd className="font-extrabold text-primary">{formatCurrency(value.amount)}</dd></div>)}
          </dl>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
          <div className="border-b border-border px-5 py-4"><h2 className="font-extrabold text-foreground">Treasury collection report</h2><p className="mt-1 text-xs text-muted-foreground">Treasury payments only, with the required official receipt number.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{["Date", "OR number", "Order", "Items", "Amount"].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-border">{summary.treasurerCollections.length ? summary.treasurerCollections.map((payment) => <tr key={payment.paymentId}><td className="px-4 py-3">{new Date(payment.paidAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</td><td className="px-4 py-3 font-bold">{payment.officialReceiptNumber}</td><td className="px-4 py-3">{payment.orderReference}</td><td className="max-w-xs px-4 py-3 text-muted-foreground">{payment.items}</td><td className="px-4 py-3 font-extrabold text-primary">{formatCurrency(payment.amount)}</td></tr>) : <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No Treasury collections in this range.</td></tr>}</tbody></table></div>
        </div>
      </section>

      <StaffReportCharts summary={summary} />

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
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

        <details className="group overflow-hidden rounded-lg border border-border bg-white shadow-sm">
          <summary className="flex min-h-[72px] cursor-pointer list-none items-center gap-3 px-4 py-3 marker:content-none sm:px-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#eef6ee]">
              <AssetIcon src="/assets/in-stock.svg" className="size-8" />
            </span>
            <span className="min-w-0">
              <span className="block font-extrabold text-foreground">Inventory Insights</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{summary.inventoryInsights.length} operational finding{summary.inventoryInsights.length === 1 ? "" : "s"}</span>
            </span>
            <ChevronDown className="ml-auto size-5 shrink-0 text-primary transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border">
            {summary.inventoryInsights.length ? (
              <div className="divide-y divide-border">
                {summary.inventoryInsights.map((insight) => (
                  <article key={insight.insight} className="grid gap-3 p-4 text-sm sm:grid-cols-[1.2fr_auto_1fr] sm:items-center">
                    <div className="flex items-center gap-3">
                      <AssetIcon src={insightIcon(insight)} className="size-8" />
                      <p className="font-bold text-foreground">{insight.insight}</p>
                    </div>
                    <StatusBadge status={insight.impact} />
                    <p className="text-[#4f5b54]">{insight.recommendation}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="p-5 text-sm font-semibold text-muted-foreground">No inventory insights available yet.</div>
            )}
            <Link href="/staff/inventory?status=needs-restock" className="flex min-h-12 items-center gap-2 border-t border-border px-4 text-sm font-bold text-primary">Review affected inventory <ArrowRight className="size-4" /></Link>
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
