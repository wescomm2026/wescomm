"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Download, Link2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReportDecisionWorkspace } from "@/components/reports/ReportDecisionWorkspace";
import {
  AdminAccessState,
  AdminHeader,
  formatCurrency,
  formatNumber,
  useAdminSummary
} from "@/components/admin/AdminExperienceShared";
import { manilaDateKey } from "@/lib/manila-date";
import type { ReportRangeOptions, ReportRangePreset } from "@/lib/api";
import { buildReportShareUrl, readReportLinkFilters } from "@/lib/report-link";

const AdminReportsCharts = dynamic(
  () => import("@/components/admin/AdminCharts").then((module) => module.AdminReportsCharts),
  { ssr: false, loading: () => <div className="h-[330px] animate-pulse rounded-lg bg-[#edf3ed]" /> }
);

export function AdminReportsExperience() {
  const [rangePreset, setRangePreset] = useState<ReportRangePreset>("LAST_30_DAYS");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [collectionChannel, setCollectionChannel] = useState<"ALL" | "COMMISSARY" | "TREASURER">("ALL");
  const [reportBasis, setReportBasis] = useState<"COLLECTION" | "COMPLETION">("COLLECTION");
  const [linkStatus, setLinkStatus] = useState<"IDLE" | "COPIED" | "READY">("IDLE");
  const reportOptions = useMemo<ReportRangeOptions>(() => rangePreset === "CUSTOM" && (!customFrom || !customTo)
    ? { preset: "LAST_30_DAYS", basis: reportBasis, ...(collectionChannel === "ALL" ? {} : { collectionChannel }) }
    : { preset: rangePreset, basis: reportBasis, ...(rangePreset === "CUSTOM" ? { from: customFrom, to: customTo } : {}), ...(collectionChannel === "ALL" ? {} : { collectionChannel }) }, [collectionChannel, customFrom, customTo, rangePreset, reportBasis]);
  const { user, ready, openAuth, summary, loading, error, reload } = useAdminSummary(reportOptions);

  useEffect(() => {
    const linked = readReportLinkFilters(window.location.search);
    setRangePreset(linked.preset);
    setCustomFrom(linked.from);
    setCustomTo(linked.to);
    setCollectionChannel(linked.collectionChannel);
    setReportBasis(linked.basis);
  }, []);
  const accessState = <AdminAccessState ready={ready} user={user} openAuth={openAuth} />;
  if (!ready || !user || user.role !== "ADMIN") return accessState;

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

  const exportCsv = () => {
    const rows = [
      ["WESCOMM ADMIN REPORT"],
      ["Generated at", summary.generatedAt ? new Date(summary.generatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "Not available"],
      ["Timezone", "Asia/Manila"],
      ["Report range", summary.range.label],
      ["Trend focus", summary.reportBasis === "COLLECTION" ? "Cash collections by payment date" : "Recognized sales by completion date"],
      ["Collection filter", summary.filters.collectionChannel],
      [],
      ["Metric", "Value"],
      ["Total Sales", formatCurrency(summary.totalSales)],
      ["COGS", formatCurrency(summary.cogs)],
      ["Gross Profit", formatCurrency(summary.grossProfit)],
      ["Commissary Collection", formatCurrency(summary.commissaryCollection)],
      ["Treasury Collection", formatCurrency(summary.treasurerCollection)],
      ["Cash Revenue", formatCurrency(summary.cashRevenue)],
      ["Commissary Cash", formatCurrency(summary.commissaryCashRevenue)],
      ["Treasury Cash", formatCurrency(summary.treasuryCashRevenue)],
      ["In-person Collections", formatCurrency(summary.inPersonRevenue)],
      ["Legacy Online Payments", formatCurrency(summary.legacyOnlineRevenue)],
      ["Legacy In-person Non-cash", formatCurrency(summary.legacyInPersonRevenue)],
      ["Inventory Value", formatCurrency(summary.inventoryValue)],
      ["Total Reservations", String(summary.totalReservations)],
      ["Items to Restock", String(summary.lowStockItems)],
      ["Active Users", String(summary.activeUsers)],
      [],
      ["RECONCILIATION EXCEPTIONS"],
      ["Priority", "Issue", "Reservation", "Date", "Amount", "Payment ID", "Receipt ID"],
      ...summary.reconciliation.items.map((item) => [item.severity, item.label, item.referenceCode, new Date(item.eventAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" }), formatCurrency(item.amount), item.paymentId ?? "", item.receiptId ?? ""]),
      [],
      ["PRODUCTS AND MARGIN"],
      ["Item", "Category", "Qty Sold", "Sales", "COGS", "Gross Profit", "Margin"],
      ...summary.itemSales.map((item) => [item.item, item.category, String(item.quantity), formatCurrency(item.sales), formatCurrency(item.cogs), formatCurrency(item.grossProfit), item.marginPercent === null ? "Not available" : `${item.marginPercent}%`]),
      [],
      ["INVENTORY ACTIONS"],
      ["Item", "Category", "Status", "Stock", "Units Sold", "Stock Cover", "Suggested Reorder", "Action"],
      ...summary.inventoryPlanning.map((item) => [item.item, item.category, item.status, String(item.stock), String(item.unitsSold), item.stockCoverDays === null ? "No demand yet" : `${item.stockCoverDays} days`, String(item.suggestedReorderQuantity), item.recommendation]),
      [],
      ["HISTORICAL PAYMENT AUDIT"],
      ["Legacy Online", formatCurrency(summary.legacyOnlineRevenue), String(summary.paymentMethodBreakdown.legacyOnline.receipts)],
      ["Legacy In-person Non-cash", formatCurrency(summary.legacyInPersonRevenue), String(summary.paymentMethodBreakdown.legacyInPerson.receipts)]
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `wescomm-admin-report-${summary.range.preset.toLowerCase()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <AdminHeader
        eyebrow="Reports"
        title="Sales, inventory value, and planning analytics"
        detail="Use current WESCOMM records for resource planning, budget decisions, and commissary monitoring."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void reload()} disabled={loading}><RefreshCw className="size-4" /> Refresh</Button>
            <Button variant="secondary" onClick={() => void copyReportLink()}><Link2 className="size-4" /> {linkStatus === "COPIED" ? "Link Copied" : linkStatus === "READY" ? "Link Ready in Address Bar" : "Copy Link"}</Button>
            <Button onClick={exportCsv}><Download className="size-4" /> Export CSV</Button>
          </div>
        }
      />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}

      <section className="grid gap-3 rounded-lg border border-border bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-5">
        <label className="grid gap-1.5 text-sm font-bold">Report period<select value={rangePreset} onChange={(event) => {
          const next = event.target.value as ReportRangePreset;
          setRangePreset(next);
          if (next === "CUSTOM") {
            const fallback = summary.range.to || manilaDateKey(new Date()) || "";
            setCustomFrom((current) => current || summary.range.from || fallback);
            setCustomTo((current) => current || fallback);
          }
        }} className="h-11 rounded-md border border-border bg-white px-3"><option value="TODAY">Today</option><option value="LAST_7_DAYS">Last 7 Days</option><option value="LAST_30_DAYS">Last 30 Days</option><option value="THIS_MONTH">This Month</option><option value="LAST_MONTH">Last Month</option><option value="CUSTOM">Custom Range</option><option value="ALL_TIME">All Time</option></select></label>
        {rangePreset === "CUSTOM" ? <><label className="grid gap-1.5 text-sm font-bold">From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="h-11 rounded-md border border-border px-3" /></label><label className="grid gap-1.5 text-sm font-bold">To<input type="date" min={customFrom} value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="h-11 rounded-md border border-border px-3" /></label></> : <div className="sm:col-span-2 sm:self-end"><p className="rounded-md bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground">Range: {summary.range.label}. Cash uses the payment date; recognized sales use the completion date.</p></div>}
        <label className="grid gap-1.5 text-sm font-bold">Collection channel<select value={collectionChannel} onChange={(event) => setCollectionChannel(event.target.value as typeof collectionChannel)} className="h-11 rounded-md border border-border bg-white px-3"><option value="ALL">All collections</option><option value="COMMISSARY">Commissary only</option><option value="TREASURER">Treasury only</option></select></label>
        <label className="grid gap-1.5 text-sm font-bold">Trend focus<select value={reportBasis} onChange={(event) => setReportBasis(event.target.value as typeof reportBasis)} className="h-11 rounded-md border border-border bg-white px-3"><option value="COLLECTION">Cash collections</option><option value="COMPLETION">Completed sales</option></select></label>
      </section>

      {summary.unverifiedInventoryQuantity || summary.uncostedQuantity ? <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Cost review needed: {formatNumber(summary.unverifiedInventoryQuantity)} remaining item(s) have an unverified opening cost and {formatNumber(summary.uncostedQuantity)} sold item(s) have incomplete allocation.</p> : null}

      <ReportDecisionWorkspace summary={summary} reservationBasePath="/admin/reservations" />

      <section id="cash-collections" className="scroll-mt-24 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border border-border bg-white p-5 shadow-sm">
          <h2 className="font-extrabold text-foreground">Commissary cash collection</h2>
          <p className="mt-1 text-xs text-muted-foreground">Current cash-only operations. Historical non-cash records are in the collapsed audit section above.</p>
          <dl className="mt-4 divide-y divide-border text-sm"><div className="flex items-center justify-between gap-4 py-3"><dt><span className="font-bold">Cash</span><span className="ml-2 text-xs text-muted-foreground">{formatNumber(summary.commissaryPaymentBreakdown.cash.payments)} payment(s)</span></dt><dd className="font-extrabold text-primary">{formatCurrency(summary.commissaryPaymentBreakdown.cash.amount)}</dd></div></dl>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
          <div className="border-b border-border px-5 py-4"><h2 className="font-extrabold text-foreground">Treasury collection report</h2><p className="mt-1 text-xs text-muted-foreground">Treasury payments only, with official receipt traceability.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{["Date", "OR number", "Order", "Items", "Amount"].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-border">{summary.treasurerCollections.length ? summary.treasurerCollections.map((payment) => <tr key={payment.paymentId}><td className="px-4 py-3">{new Date(payment.paidAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</td><td className={payment.officialReceiptNumber ? "px-4 py-3 font-bold" : "px-4 py-3 font-bold text-red-700"}>{payment.officialReceiptNumber ?? "Missing OR"}</td><td className="px-4 py-3">{payment.orderReference}</td><td className="max-w-xs px-4 py-3 text-muted-foreground">{payment.items}</td><td className="px-4 py-3 font-extrabold text-primary">{formatCurrency(payment.amount)}</td></tr>) : <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No Treasury collections in this range.</td></tr>}</tbody></table></div>
        </div>
      </section>

      <AdminReportsCharts summary={summary} />

    </div>
  );
}
