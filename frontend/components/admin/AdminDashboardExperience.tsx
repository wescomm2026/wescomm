"use client";

import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  AdminAccessState,
  AdminDashboardLoading,
  AdminHeader,
  AdminStatCard,
  formatCurrency,
  formatNumber,
  useAdminSummary
} from "@/components/admin/AdminExperienceShared";
import { useAdminWesbotUsage } from "@/components/admin/useAdminWesbotUsage";

const AdminSummaryCharts = dynamic(
  () => import("@/components/admin/AdminCharts").then((module) => module.AdminSummaryCharts),
  { ssr: false, loading: () => <div className="h-[310px] animate-pulse rounded-lg bg-[#edf3ed]" /> }
);

export function AdminDashboardExperience() {
  const { user, ready, openAuth, summary, loading, initialLoadComplete, error, reload } = useAdminSummary();
  const { usage: wesbotUsage, loading: wesbotLoading, reload: reloadWesbotUsage } = useAdminWesbotUsage();
  const accessState = <AdminAccessState ready={ready} user={user} openAuth={openAuth} />;
  if (!ready || !user || user.role !== "ADMIN") return accessState;

  if (!initialLoadComplete) {
    return (
      <div className="space-y-5">
        <AdminHeader
          eyebrow="Admin dashboard"
          title="Commissary monitoring and decisions"
          detail="Preparing live reports, inventory, users, and operations data."
        />
        <AdminDashboardLoading />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AdminHeader
        eyebrow="Admin dashboard"
        title="Commissary monitoring and decisions"
        detail="Track current sales, users, stock risk, reservations, receipts, and support activity in WESCOMM."
        action={<Button variant="secondary" onClick={() => void Promise.all([reload(), reloadWesbotUsage()])} disabled={loading || wesbotLoading}><RefreshCw className="size-4" /> Refresh</Button>}
      />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard title="Total Sales" value={formatCurrency(summary.totalSales)} detail={`${formatNumber(summary.totalReceipts)} receipts recorded`} iconSrc="/assets/cash.svg" href="/admin/reports" />
        <AdminStatCard title="Inventory Value" value={formatCurrency(summary.inventoryValue)} detail={`${formatNumber(summary.totalProducts)} active products`} iconSrc="/assets/all-items.svg" href="/admin/inventory" />
        <AdminStatCard title="Items to Restock" value={formatNumber(summary.lowStockItems)} detail={`${formatNumber(summary.outOfStockItems)} unavailable`} iconSrc="/assets/low-stock.svg" tone={summary.lowStockItems ? "yellow" : "green"} href="/admin/inventory" />
        <AdminStatCard title="Active Users" value={formatNumber(summary.activeUsers)} detail={`${summary.roleCounts.students} students, ${summary.roleCounts.staff} staff`} iconSrc="/assets/my-profile.svg" href="/admin/users" />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard title="Reservations" value={formatNumber(summary.totalReservations)} detail={`${formatNumber(summary.pendingReservations)} pending review`} iconSrc="/assets/reservations.svg" href="/admin/reservations" />
        <AdminStatCard title="Receipts to Verify" value={formatNumber(summary.receiptsToVerify)} detail="Pending staff/admin verification" iconSrc="/assets/scan-receipt.svg" href="/admin/receipt-verification" />
        <AdminStatCard title="Open Messages" value={formatNumber(summary.activeConversations)} detail="Student support conversations" iconSrc="/assets/messages.svg" href="/admin/messages" />
        <AdminStatCard
          title="WesBot AI Budget"
          value={wesbotUsage ? `$${wesbotUsage.estimatedSpendUsd.toFixed(2)} / $${wesbotUsage.budgetUsd.toFixed(2)}` : "Loading..."}
          detail={wesbotUsage ? `${formatNumber(wesbotUsage.successfulCalls)} AI calls · ${wesbotUsage.budgetHealth.toLowerCase()}` : "Preparing privacy-safe usage data"}
          iconSrc="/assets/chat-with-wesbot.svg"
          tone={wesbotUsage && wesbotUsage.budgetPercent >= 90 ? "red" : wesbotUsage && wesbotUsage.budgetPercent >= 80 ? "yellow" : "green"}
          href="/admin/wesbot-usage"
        />
      </section>

      <AdminSummaryCharts summary={summary} />

      <section className="grid gap-4 lg:grid-cols-3">
        {summary.inventoryInsights.map((insight) => (
          <article key={insight.insight} className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <AssetIcon src={insight.impact === "High" ? "/assets/low-stock.svg" : "/assets/in-stock.svg"} className="size-10" />
              <div>
                <p className="font-extrabold text-[#17211b]">{insight.insight}</p>
                <p className="mt-2 text-sm leading-6 text-[#68746d]">{insight.recommendation}</p>
                <span className="mt-3 inline-block"><StatusBadge status={insight.impact} /></span>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
