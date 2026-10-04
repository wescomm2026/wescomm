"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, Bot, FileBarChart2, History, RefreshCw, UsersRound } from "lucide-react";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
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

const AdminSummaryCharts = dynamic(
  () => import("@/components/admin/AdminCharts").then((module) => module.AdminSummaryCharts),
  { ssr: false, loading: () => <Skeleton className="h-[364px] rounded-xl" /> }
);

const adminTools = [
  { href: "/admin/users", label: "Team Access", detail: "Assign student, staff, and admin roles", icon: UsersRound },
  { href: "/admin/audit-logs", label: "Audit Logs", detail: "Review every staff and admin action", icon: History },
  { href: "/admin/wesbot-usage", label: "WesBot Usage", detail: "AI calls and monthly testing budget", icon: Bot },
  { href: "/admin/reports", label: "Reports", detail: "Sales, reconciliation, and exports", icon: FileBarChart2 }
];

function SectionLabel({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="text-sm font-extrabold uppercase tracking-[0.12em] text-muted-foreground">{children}</h2>;
}

export function AdminDashboardExperience() {
  const { user, ready, openAuth, summary, loading, initialLoadComplete, error, reload } = useAdminSummary();
  const accessState = <AdminAccessState ready={ready} user={user} openAuth={openAuth} />;
  if (!ready || !user || user.role !== "ADMIN") return accessState;

  if (!initialLoadComplete) {
    return (
      <div className="space-y-6">
        <AdminHeader
          eyebrow="Admin dashboard"
          title="Commissary monitoring and decisions"
          detail="Preparing live reports, inventory, users, and operations data."
        />
        <AdminDashboardLoading />
      </div>
    );
  }

  const needsAttention = summary.lowStockItems + summary.receiptsToVerify + summary.activeConversations + summary.reconciliation.exceptionCount;

  return (
    <div className="space-y-6">
      <AdminHeader
        eyebrow="Admin dashboard"
        title="Commissary monitoring and decisions"
        detail="Track current sales, users, stock risk, reservations, receipts, and support activity in WESCOMM."
        action={(
          <Button variant="secondary" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className={loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} aria-hidden="true" />
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
        )}
      />
      {error ? (
        <InlineAlert action={<Button size="sm" variant="secondary" onClick={() => void reload()} disabled={loading}>Retry</Button>}>
          {error}
        </InlineAlert>
      ) : null}

      <section aria-labelledby="admin-attention-heading" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SectionLabel id="admin-attention-heading">Needs attention</SectionLabel>
          {needsAttention ? null : <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-bold text-success">All clear</span>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <AdminStatCard title="Items to Restock" value={formatNumber(summary.lowStockItems)} detail={`${formatNumber(summary.outOfStockItems)} unavailable`} iconSrc="/assets/low-stock.svg" tone={summary.lowStockItems ? "yellow" : "green"} href="/admin/inventory" />
          <AdminStatCard title="Receipts to Verify" value={formatNumber(summary.receiptsToVerify)} detail="Pending staff/admin verification" iconSrc="/assets/scan-receipt.svg" tone={summary.receiptsToVerify ? "yellow" : "green"} href="/admin/receipt-verification" />
          <AdminStatCard title="Open Messages" value={formatNumber(summary.activeConversations)} detail="Student support conversations" iconSrc="/assets/messages.svg" href="/admin/messages" />
          <AdminStatCard
            title="Records to Review"
            value={formatNumber(summary.reconciliation.exceptionCount)}
            detail={summary.reconciliation.exceptionCount
              ? `${formatCurrency(summary.reconciliation.amountAtRisk)} needs reconciliation`
              : "Cash and operational records are aligned"}
            iconSrc="/assets/verified.svg"
            tone={summary.reconciliation.exceptionCount ? "red" : "green"}
            href="/admin/reports#report-reconciliation"
          />
        </div>
      </section>

      <section aria-labelledby="admin-performance-heading" className="space-y-3">
        <SectionLabel id="admin-performance-heading">Business overview</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <AdminStatCard title="Total Sales" value={formatCurrency(summary.totalSales)} detail={`${formatNumber(summary.totalReceipts)} receipts recorded`} iconSrc="/assets/cash.svg" href="/admin/reports" />
          <AdminStatCard title="Inventory Value" value={formatCurrency(summary.inventoryValue)} detail={`${formatNumber(summary.totalProducts)} active products`} iconSrc="/assets/all-items.svg" href="/admin/inventory" />
          <AdminStatCard title="Reservations" value={formatNumber(summary.totalReservations)} detail={`${formatNumber(summary.pendingReservations)} pending review`} iconSrc="/assets/reservations.svg" href="/admin/reservations" />
          <AdminStatCard title="Active Users" value={formatNumber(summary.activeUsers)} detail={`${summary.roleCounts.students} students, ${summary.roleCounts.staff} staff`} iconSrc="/assets/my-profile.svg" href="/admin/users" />
        </div>
      </section>

      <AdminSummaryCharts summary={summary} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title="Inventory insights"
          description="Recommendations generated from current stock and sales movement."
          icon={<AssetIcon src="/assets/in-stock.svg" className="size-6" />}
        >
          {summary.inventoryInsights.length ? (
            <ul className="divide-y">
              {summary.inventoryInsights.map((insight) => (
                <li key={insight.insight} className="flex items-start gap-3 px-4 py-4 sm:px-5">
                  <AssetIcon src={insight.impact === "High" ? "/assets/low-stock.svg" : "/assets/in-stock.svg"} className="mt-0.5 size-8" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-extrabold text-foreground">{insight.insight}</p>
                      <StatusBadge status={insight.impact} />
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{insight.recommendation}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm font-semibold text-muted-foreground">No inventory insights for this period.</p>
          )}
        </Panel>

        <Panel title="Admin tools" description="Admin-only controls" icon={<AssetIcon src="/assets/privacy.svg" className="size-6" />}>
          <ul className="divide-y">
            {adminTools.map((tool) => (
              <li key={tool.href}>
                <Link href={tool.href} className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-subtle sm:px-5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <tool.icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-foreground">{tool.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{tool.detail}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
