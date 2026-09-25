"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SalesByCategory } from "@/components/reports/SalesByCategory";
import {
  AdminAccessState,
  AdminHeader,
  AdminStatCard,
  formatCurrency,
  formatNumber,
  useAdminSummary
} from "@/components/admin/AdminExperienceShared";
import { manilaDateKey } from "@/lib/manila-date";
import type { ReportRangeOptions, ReportRangePreset } from "@/lib/api";

const AdminReportsCharts = dynamic(
  () => import("@/components/admin/AdminCharts").then((module) => module.AdminReportsCharts),
  { ssr: false, loading: () => <div className="h-[330px] animate-pulse rounded-lg bg-[#edf3ed]" /> }
);

export function AdminReportsExperience() {
  const [rangePreset, setRangePreset] = useState<ReportRangePreset>("LAST_30_DAYS");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [collectionChannel, setCollectionChannel] = useState<"ALL" | "COMMISSARY" | "TREASURER">("ALL");
  const reportOptions = useMemo<ReportRangeOptions>(() => rangePreset === "CUSTOM" && (!customFrom || !customTo)
    ? { preset: "LAST_30_DAYS", ...(collectionChannel === "ALL" ? {} : { collectionChannel }) }
    : { preset: rangePreset, ...(rangePreset === "CUSTOM" ? { from: customFrom, to: customTo } : {}), ...(collectionChannel === "ALL" ? {} : { collectionChannel }) }, [collectionChannel, customFrom, customTo, rangePreset]);
  const { user, ready, openAuth, summary, loading, error, reload } = useAdminSummary(reportOptions);
  const accessState = <AdminAccessState ready={ready} user={user} openAuth={openAuth} />;
  if (!ready || !user || user.role !== "ADMIN") return accessState;

  const exportCsv = () => {
    const rows = [
      ["Metric", "Value"],
      ["Total Sales", formatCurrency(summary.totalSales)],
      ["COGS", formatCurrency(summary.cogs)],
      ["Gross Profit", formatCurrency(summary.grossProfit)],
      ["Commissary Collection", formatCurrency(summary.commissaryCollection)],
      ["Treasury Collection", formatCurrency(summary.treasurerCollection)],
      ["GCash – Online Revenue", formatCurrency(summary.onlineGcashRevenue)],
      ["In-person Payment Revenue", formatCurrency(summary.payAtCommissaryRevenue)],
      ["Inventory Value", formatCurrency(summary.inventoryValue)],
      ["Total Reservations", String(summary.totalReservations)],
      ["Items to Restock", String(summary.lowStockItems)],
      ["Active Users", String(summary.activeUsers)],
      [],
      ["Item", "Category", "Qty Sold", "Sales", "COGS", "Gross Profit"],
      ...summary.itemSales.map((item) => [item.item, item.category, String(item.quantity), formatCurrency(item.sales), formatCurrency(item.cogs), formatCurrency(item.grossProfit)])
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
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void reload()} disabled={loading}><RefreshCw className="size-4" /> Refresh</Button>
            <Button onClick={exportCsv}><Download className="size-4" /> Export CSV</Button>
          </div>
        }
      />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}

      <section className="grid gap-3 rounded-lg border border-border bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1.5 text-sm font-bold">Revenue period<select value={rangePreset} onChange={(event) => {
          const next = event.target.value as ReportRangePreset;
          setRangePreset(next);
          if (next === "CUSTOM") {
            const fallback = summary.range.to || manilaDateKey(new Date()) || "";
            setCustomFrom((current) => current || summary.range.from || fallback);
            setCustomTo((current) => current || fallback);
          }
        }} className="h-11 rounded-md border border-border bg-white px-3"><option value="TODAY">Today</option><option value="LAST_7_DAYS">Last 7 Days</option><option value="LAST_30_DAYS">Last 30 Days</option><option value="THIS_MONTH">This Month</option><option value="LAST_MONTH">Last Month</option><option value="CUSTOM">Custom Range</option><option value="ALL_TIME">All Time</option></select></label>
        {rangePreset === "CUSTOM" ? <><label className="grid gap-1.5 text-sm font-bold">From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="h-11 rounded-md border border-border px-3" /></label><label className="grid gap-1.5 text-sm font-bold">To<input type="date" min={customFrom} value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="h-11 rounded-md border border-border px-3" /></label></> : <div className="sm:col-span-2 sm:self-end"><p className="rounded-md bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground">Range: {summary.range.label}. Exports use this exact verified-receipt range.</p></div>}
        <label className="grid gap-1.5 text-sm font-bold">Collection channel<select value={collectionChannel} onChange={(event) => setCollectionChannel(event.target.value as typeof collectionChannel)} className="h-11 rounded-md border border-border bg-white px-3"><option value="ALL">All collections</option><option value="COMMISSARY">Commissary only</option><option value="TREASURER">Treasury only</option></select></label>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard title="Total Sales" value={formatCurrency(summary.totalSales)} detail={`${summary.totalReceipts} verified receipts · ${summary.range.label}`} iconSrc="/assets/cash.svg" />
        <AdminStatCard title="COGS" value={formatCurrency(summary.cogs)} detail="Actual FIFO inventory cost" iconSrc="/assets/all-items.svg" />
        <AdminStatCard title="Gross Profit" value={formatCurrency(summary.grossProfit)} detail="Sales minus COGS" iconSrc="/assets/orders.svg" />
        <AdminStatCard title="Inventory Value" value={formatCurrency(summary.inventoryValue)} detail={`${summary.totalProducts} active products`} iconSrc="/assets/all-items.svg" />
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <AdminStatCard title="Commissary Collection" value={formatCurrency(summary.commissaryCollection)} detail={`${summary.collectionChannelBreakdown.commissary.payments} payments`} iconSrc="/assets/cash.svg" />
        <AdminStatCard title="Treasury Collection" value={formatCurrency(summary.treasurerCollection)} detail={`${summary.collectionChannelBreakdown.treasurer.payments} payments`} iconSrc="/assets/verified.svg" />
        <AdminStatCard title="GCash Payments" value={formatCurrency(summary.onlineGcashRevenue)} detail={`${summary.paymentMethodBreakdown.onlineGcash.receipts} payments`} iconSrc="/assets/e-wallet.svg" />
      </section>

      {summary.unverifiedInventoryQuantity || summary.uncostedQuantity ? <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Cost review needed: {formatNumber(summary.unverifiedInventoryQuantity)} remaining item(s) have an unverified opening cost and {formatNumber(summary.uncostedQuantity)} sold item(s) have incomplete allocation.</p> : null}

      <SalesByCategory categorySales={summary.categorySales} itemSales={summary.itemSales} description="Top 3 categories by sales are shown first. Select one to inspect its individual items." />

      <section className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
        <div className="border-b border-border px-5 py-4"><h2 className="font-extrabold text-foreground">Sales by item</h2><p className="mt-1 text-xs text-muted-foreground">Completed sales with preserved FIFO cost.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{["Item", "Category", "Qty sold", "Sales", "COGS", "Gross profit"].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-border">{summary.itemSales.length ? summary.itemSales.map((item) => <tr key={item.productId}><td className="px-4 py-3 font-bold">{item.item}</td><td className="px-4 py-3 text-muted-foreground">{item.category}</td><td className="px-4 py-3">{formatNumber(item.quantity)}</td><td className="px-4 py-3">{formatCurrency(item.sales)}</td><td className="px-4 py-3">{formatCurrency(item.cogs)}</td><td className="px-4 py-3 font-extrabold text-primary">{formatCurrency(item.grossProfit)}</td></tr>) : <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No completed sales in this range.</td></tr>}</tbody></table></div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border border-border bg-white p-5 shadow-sm">
          <h2 className="font-extrabold text-foreground">Commissary collection</h2>
          <p className="mt-1 text-xs text-muted-foreground">Cash, GCash, and other methods collected by the Commissary only.</p>
          <dl className="mt-4 divide-y divide-border text-sm">{([['Cash', summary.commissaryPaymentBreakdown.cash], ['GCash', summary.commissaryPaymentBreakdown.gcash], ['Other', summary.commissaryPaymentBreakdown.other]] as const).map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 py-3"><dt><span className="font-bold">{label}</span><span className="ml-2 text-xs text-muted-foreground">{formatNumber(value.payments)} payment(s)</span></dt><dd className="font-extrabold text-primary">{formatCurrency(value.amount)}</dd></div>)}</dl>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
          <div className="border-b border-border px-5 py-4"><h2 className="font-extrabold text-foreground">Treasury collection report</h2><p className="mt-1 text-xs text-muted-foreground">Treasury payments only, with official receipt traceability.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{["Date", "OR number", "Order", "Items", "Amount"].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-border">{summary.treasurerCollections.length ? summary.treasurerCollections.map((payment) => <tr key={payment.paymentId}><td className="px-4 py-3">{new Date(payment.paidAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</td><td className="px-4 py-3 font-bold">{payment.officialReceiptNumber}</td><td className="px-4 py-3">{payment.orderReference}</td><td className="max-w-xs px-4 py-3 text-muted-foreground">{payment.items}</td><td className="px-4 py-3 font-extrabold text-primary">{formatCurrency(payment.amount)}</td></tr>) : <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No Treasury collections in this range.</td></tr>}</tbody></table></div>
        </div>
      </section>

      <AdminReportsCharts summary={summary} />

      <section className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
        <div className="flex min-h-14 items-center border-b border-border px-4">
          <h2 className="font-extrabold text-foreground">Inventory Insights</h2>
        </div>
        <div className="divide-y divide-[#edf1ed]">
          {summary.inventoryInsights.map((insight) => (
            <article key={insight.insight} className="grid gap-3 p-4 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <p className="font-bold text-foreground">{insight.insight}</p>
              <StatusBadge status={insight.impact} />
              <p className="text-muted-foreground">{insight.recommendation}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
