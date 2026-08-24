"use client";

import dynamic from "next/dynamic";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  AdminAccessState,
  AdminHeader,
  AdminStatCard,
  formatCurrency,
  formatNumber,
  useAdminSummary
} from "@/components/admin/AdminExperienceShared";

const AdminReportsCharts = dynamic(
  () => import("@/components/admin/AdminCharts").then((module) => module.AdminReportsCharts),
  { ssr: false, loading: () => <div className="h-[330px] animate-pulse rounded-lg bg-[#edf3ed]" /> }
);

export function AdminReportsExperience() {
  const { user, ready, openAuth, summary, loading, error, reload } = useAdminSummary();
  const accessState = <AdminAccessState ready={ready} user={user} openAuth={openAuth} />;
  if (!ready || !user || user.role !== "ADMIN") return accessState;

  const exportCsv = () => {
    const rows = [
      ["Metric", "Value"],
      ["Total Sales", formatCurrency(summary.totalSales)],
      ["Inventory Value", formatCurrency(summary.inventoryValue)],
      ["Total Reservations", String(summary.totalReservations)],
      ["Items to Restock", String(summary.lowStockItems)],
      ["Active Users", String(summary.activeUsers)],
      [],
      ["Category", "Sales"],
      ...summary.categorySales.map((item) => [item.category, formatCurrency(item.amount)])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "wescomm-admin-report.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <AdminHeader
        eyebrow="Reports"
        title="Sales, inventory value, and planning analytics"
        detail="Use live backend data for resource planning, budget decisions, and commissary monitoring."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void reload()} disabled={loading}><RefreshCw className="size-4" /> Refresh</Button>
            <Button onClick={exportCsv}><Download className="size-4" /> Export CSV</Button>
          </div>
        }
      />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard title="Total Sales" value={formatCurrency(summary.totalSales)} detail="From non-voided receipts" iconSrc="/assets/cash.svg" />
        <AdminStatCard title="Total Reservations" value={formatNumber(summary.totalReservations)} detail={`${summary.pendingReservations} pending`} iconSrc="/assets/reservations.svg" />
        <AdminStatCard title="Inventory Value" value={formatCurrency(summary.inventoryValue)} detail={`${summary.totalProducts} active products`} iconSrc="/assets/all-items.svg" />
        <AdminStatCard title="Items to Restock" value={formatNumber(summary.lowStockItems)} detail={`${summary.outOfStockItems} unavailable`} iconSrc="/assets/low-stock.svg" tone="yellow" />
      </section>

      <AdminReportsCharts summary={summary} />

      <section className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
        <div className="flex min-h-14 items-center border-b border-[#e5ebe6] px-4">
          <h2 className="font-extrabold text-[#17211b]">Inventory Insights</h2>
        </div>
        <div className="divide-y divide-[#edf1ed]">
          {summary.inventoryInsights.map((insight) => (
            <article key={insight.insight} className="grid gap-3 p-4 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <p className="font-bold text-[#17211b]">{insight.insight}</p>
              <StatusBadge status={insight.impact} />
              <p className="text-[#68746d]">{insight.recommendation}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
