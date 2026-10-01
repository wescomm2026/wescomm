"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, TrendingDown, TrendingUp } from "lucide-react";
import { useDeferredValue, useState } from "react";
import type { BackendReportComparisonMetric, BackendReportSummary } from "@/lib/api";

function formatCurrency(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-PH");
}

function comparisonText(metric: BackendReportComparisonMetric, available: boolean) {
  if (!available) return "No previous-period comparison for All Time.";
  if (metric.percentChange === null) return metric.current === 0 ? "No activity in either period." : "No previous-period baseline.";
  const direction = metric.percentChange > 0 ? "up" : metric.percentChange < 0 ? "down" : "unchanged";
  return `${direction === "unchanged" ? "Unchanged" : `${direction} ${Math.abs(metric.percentChange)}%`} vs previous period`;
}

function ComparisonIcon({ metric }: { metric: BackendReportComparisonMetric }) {
  if (metric.difference > 0) return <TrendingUp className="size-4" aria-hidden="true" />;
  if (metric.difference < 0) return <TrendingDown className="size-4" aria-hidden="true" />;
  return <span className="text-sm" aria-hidden="true">—</span>;
}

function MetricCard({
  title,
  value,
  explanation,
  comparison,
  comparisonAvailable,
  href
}: {
  title: string;
  value: string;
  explanation: string;
  comparison: BackendReportComparisonMetric;
  comparisonAvailable: boolean;
  href: string;
}) {
  return (
    <article className="flex min-h-48 flex-col rounded-xl border border-border bg-white p-5 shadow-sm">
      <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-2 text-2xl font-black text-primary sm:text-3xl">{value}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{explanation}</p>
      <div className="mt-auto flex items-center gap-2 pt-4 text-xs font-bold text-foreground">
        <ComparisonIcon metric={comparison} />
        <span>{comparisonText(comparison, comparisonAvailable)}</span>
      </div>
      <Link href={href} className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-extrabold text-primary">
        View details <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </article>
  );
}

const reconciliationChecks = [
  ["COMPLETED_WITHOUT_PAID_PAYMENT", "Completed without payment"],
  ["COMPLETED_WITHOUT_VERIFIED_RECEIPT", "Completed without verified receipt"],
  ["PAYMENT_RECEIPT_MISMATCH", "Payment/receipt mismatch"],
  ["MISSING_TREASURY_OR", "Treasury payment missing OR"],
  ["PAID_NOT_COMPLETED", "Paid but not completed"],
  ["POST_CUTOVER_NON_CASH", "Non-cash after cutoff"]
] as const;

const inventoryStatusLabel: Record<BackendReportSummary["inventoryPlanning"][number]["status"], string> = {
  OUT_OF_STOCK: "Out of stock",
  REORDER: "Reorder",
  NO_SALES: "No sales",
  SLOW_MOVING: "Slow-moving",
  HEALTHY: "Healthy"
};

export function ReportDecisionWorkspace({
  summary,
  reservationBasePath
}: {
  summary: BackendReportSummary;
  reservationBasePath: "/staff/reservations" | "/admin/reservations";
}) {
  const [productQuery, setProductQuery] = useState("");
  const deferredProductQuery = useDeferredValue(productQuery.trim().toLocaleLowerCase());
  const matchesProductQuery = (item: { item: string; category: string }) => !deferredProductQuery
    || `${item.item} ${item.category}`.toLocaleLowerCase().includes(deferredProductQuery);
  const comparisonAvailable = summary.comparison.available;
  const actionInventory = summary.inventoryPlanning
    .filter((item) => item.status !== "HEALTHY")
    .filter(matchesProductQuery)
    .slice(0, 30);
  const topMarginItems = [...summary.itemSales]
    .filter(matchesProductQuery)
    .sort((left, right) => right.grossProfit - left.grossProfit || right.sales - left.sales)
    .slice(0, 25);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-gradient-to-br from-primary/5 to-white p-5 shadow-sm" aria-labelledby="report-start-title">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><CircleHelp className="size-5" aria-hidden="true" /></span>
          <div>
            <h2 id="report-start-title" className="text-lg font-black text-foreground">Start here: how to read this report</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Use the cards in order. Collections answer “How much cash did we receive?” Sales answer “How much completed business did we recognize?” Reconciliation tells you what needs checking.</p>
          </div>
        </div>
        <ol className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <li className="rounded-lg bg-white p-4"><strong className="block text-primary">1. Check cash</strong><span className="mt-1 block text-muted-foreground">Confirm Commissary and Treasury collections.</span></li>
          <li className="rounded-lg bg-white p-4"><strong className="block text-primary">2. Check completed sales</strong><span className="mt-1 block text-muted-foreground">Review profit and product performance.</span></li>
          <li className="rounded-lg bg-white p-4"><strong className="block text-primary">3. Resolve exceptions</strong><span className="mt-1 block text-muted-foreground">Open each flagged reservation and correct its records.</span></li>
        </ol>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Report sections">
          {[
            ["Overview", "#report-overview"],
            ["Reconciliation", "#report-reconciliation"],
            ["Products & margin", "#report-products"],
            ["Inventory actions", "#report-inventory"],
            ["Historical audit", "#report-legacy"]
          ].map(([label, href]) => <a key={href} href={href} className="rounded-full border border-border bg-white px-3 py-2 text-xs font-extrabold text-primary hover:bg-primary/5">{label}</a>)}
        </nav>
      </section>

      <section id="report-overview" className="scroll-mt-24" aria-labelledby="report-overview-title">
        <div className="mb-3">
          <h2 id="report-overview-title" className="text-xl font-black text-foreground">Financial overview</h2>
          <p className="mt-1 text-sm text-muted-foreground">Each amount uses its own correct accounting date. Cash uses payment date; recognized sales use completion date.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Cash collected" value={formatCurrency(summary.cashRevenue)} explanation="Verified CASH payments received in this report period." comparison={summary.comparison.cashRevenue} comparisonAvailable={comparisonAvailable} href="#cash-collections" />
          <MetricCard title="Recognized sales" value={formatCurrency(summary.totalSales)} explanation="Completed reservations with a verified receipt and paid payment." comparison={summary.comparison.recognizedSales} comparisonAvailable={comparisonAvailable} href="#report-products" />
          <MetricCard title="Gross profit" value={formatCurrency(summary.grossProfit)} explanation="Recognized sales minus actual FIFO inventory cost." comparison={summary.comparison.grossProfit} comparisonAvailable={comparisonAvailable} href="#report-products" />
          <MetricCard title="Reservations created" value={formatNumber(summary.totalReservations)} explanation="New reservations created inside this report period." comparison={summary.comparison.reservations} comparisonAvailable={comparisonAvailable} href="#reservation-status" />
        </div>
        {summary.comparison.label ? <p className="mt-3 text-xs font-semibold text-muted-foreground">Comparison period: {summary.comparison.label}</p> : null}
      </section>

      <section id="report-reconciliation" className="scroll-mt-24 overflow-hidden rounded-xl border border-border bg-white shadow-sm" aria-labelledby="reconciliation-title">
        <div className={summary.reconciliation.status === "CLEAN" ? "border-b border-emerald-200 bg-emerald-50 p-5" : "border-b border-amber-200 bg-amber-50 p-5"}>
          <div className="flex flex-wrap items-start gap-3">
            {summary.reconciliation.status === "CLEAN" ? <CheckCircle2 className="mt-0.5 size-6 text-emerald-700" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-6 text-amber-700" aria-hidden="true" />}
            <div>
              <h2 id="reconciliation-title" className="text-lg font-black text-foreground">Cash and record reconciliation</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {summary.reconciliation.status === "CLEAN"
                  ? "All automated checks passed for this period."
                  : `${summary.reconciliation.exceptionCount}${summary.reconciliation.truncated ? "+" : ""} issue(s) need review. Estimated amount requiring reconciliation: ${formatCurrency(summary.reconciliation.amountAtRisk)}.`}
              </p>
            </div>
          </div>
        </div>
        <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
          {reconciliationChecks.map(([type, label]) => {
            const count = summary.reconciliation.counts[type] ?? 0;
            return (
              <div key={type} className="flex items-center gap-3 bg-white p-4 text-sm">
                {count ? <AlertTriangle className="size-5 shrink-0 text-amber-700" aria-hidden="true" /> : <CheckCircle2 className="size-5 shrink-0 text-emerald-700" aria-hidden="true" />}
                <div><p className="font-bold text-foreground">{label}</p><p className="mt-0.5 text-xs text-muted-foreground">{count ? `${count} to review` : "No issue found"}</p></div>
              </div>
            );
          })}
        </div>
        {summary.reconciliation.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <caption className="sr-only">Reservations with reconciliation issues</caption>
              <thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{["Priority", "Issue", "Reservation", "Date", "Amount", "Action"].map((heading) => <th key={heading} className="px-4 py-3 font-extrabold">{heading}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {summary.reconciliation.items.map((item, index) => (
                  <tr key={`${item.type}-${item.reservationId}-${index}`}>
                    <td className="px-4 py-3"><span className={item.severity === "HIGH" ? "rounded-full bg-red-50 px-2.5 py-1 text-xs font-extrabold text-red-700" : "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-amber-700"}>{item.severity === "HIGH" ? "Urgent" : "Review"}</span></td>
                    <td className="px-4 py-3 font-bold text-foreground">{item.label}</td>
                    <td className="px-4 py-3">{item.referenceCode}</td>
                    <td className="px-4 py-3">{new Date(item.eventAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</td>
                    <td className="px-4 py-3 font-bold">{formatCurrency(item.amount)}</td>
                    <td className="px-4 py-3"><Link href={`${reservationBasePath}?search=${encodeURIComponent(item.referenceCode)}`} className="inline-flex min-h-10 items-center gap-2 font-extrabold text-primary">Open record <ArrowRight className="size-4" aria-hidden="true" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section id="report-products" className="scroll-mt-24 overflow-hidden rounded-xl border border-border bg-white shadow-sm" aria-labelledby="products-title">
        <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="products-title" className="text-lg font-black text-foreground">Products and margin</h2><p className="mt-1 text-sm text-muted-foreground">Use gross profit and margin—not sales alone—to see which products contribute most.</p></div><label className="grid gap-1.5 text-xs font-extrabold text-foreground">Find a product or category<input type="search" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Example: uniform" className="h-10 min-w-64 rounded-md border border-border bg-white px-3 text-sm font-medium outline-none focus:border-primary" /></label></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <caption className="sr-only">Product sales, costs, profit, and margin</caption>
            <thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{["Product", "Category", "Units", "Sales", "COGS", "Gross profit", "Margin"].map((heading) => <th key={heading} className="px-4 py-3 font-extrabold">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {topMarginItems.length ? topMarginItems.map((item) => (
                <tr key={item.productId}><td className="px-4 py-3 font-bold">{item.item}</td><td className="px-4 py-3 text-muted-foreground">{item.category}</td><td className="px-4 py-3">{formatNumber(item.quantity)}</td><td className="px-4 py-3">{formatCurrency(item.sales)}</td><td className="px-4 py-3">{formatCurrency(item.cogs)}</td><td className="px-4 py-3 font-extrabold text-primary">{formatCurrency(item.grossProfit)}</td><td className="px-4 py-3 font-bold">{item.marginPercent === null ? "Not available" : `${item.marginPercent}%`}</td></tr>
              )) : <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No completed product sales in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section id="report-inventory" className="scroll-mt-24 overflow-hidden rounded-xl border border-border bg-white shadow-sm" aria-labelledby="inventory-title">
        <div className="border-b border-border p-5"><h2 id="inventory-title" className="text-lg font-black text-foreground">Inventory action list</h2><p className="mt-1 text-sm text-muted-foreground">Items are prioritized by what staff should do next. Stock-cover estimates use demand from the selected period.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <caption className="sr-only">Inventory items requiring staff action</caption>
            <thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{["Product", "Status", "Stock", "Units sold", "Stock cover", "Suggested reorder", "What to do"].map((heading) => <th key={heading} className="px-4 py-3 font-extrabold">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {actionInventory.length ? actionInventory.map((item) => (
                <tr key={item.productId}><td className="px-4 py-3"><p className="font-bold">{item.item}</p><p className="text-xs text-muted-foreground">{item.category}</p></td><td className="px-4 py-3"><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-amber-800">{inventoryStatusLabel[item.status]}</span></td><td className="px-4 py-3 font-bold">{formatNumber(item.stock)}</td><td className="px-4 py-3">{formatNumber(item.unitsSold)}</td><td className="px-4 py-3">{item.stockCoverDays === null ? "No demand yet" : `${item.stockCoverDays} days`}</td><td className="px-4 py-3">{formatNumber(item.suggestedReorderQuantity)}</td><td className="px-4 py-3 font-semibold text-foreground">{item.recommendation}</td></tr>
              )) : <tr><td colSpan={7} className="px-4 py-8 text-center text-emerald-700">No inventory action is required for this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <details id="report-legacy" className="group scroll-mt-24 overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-5 marker:content-none"><span className="font-black text-foreground">Historical payment audit</span><span className="text-sm text-muted-foreground">Hidden from normal cash operations</span><span className="ml-auto text-sm font-extrabold text-primary group-open:hidden">Show</span><span className="ml-auto hidden text-sm font-extrabold text-primary group-open:inline">Hide</span></summary>
        <div className="grid gap-3 border-t border-border p-5 sm:grid-cols-2">
          <div className="rounded-lg bg-muted/40 p-4"><p className="text-xs font-extrabold uppercase text-muted-foreground">Legacy online</p><p className="mt-2 text-xl font-black text-foreground">{formatCurrency(summary.legacyOnlineRevenue)}</p><p className="mt-1 text-xs text-muted-foreground">PayMongo records retained for audit, refunds, and late confirmations.</p></div>
          <div className="rounded-lg bg-muted/40 p-4"><p className="text-xs font-extrabold uppercase text-muted-foreground">Legacy in-person non-cash</p><p className="mt-2 text-xl font-black text-foreground">{formatCurrency(summary.legacyInPersonRevenue)}</p><p className="mt-1 text-xs text-muted-foreground">Old counter methods; not accepted for new payments.</p></div>
        </div>
      </details>
    </div>
  );
}
