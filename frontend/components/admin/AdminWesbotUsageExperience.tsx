"use client";

import { Activity, Bot, CircleDollarSign, Clock3, ExternalLink, Gauge, RefreshCw, ShieldCheck, TriangleAlert, Zap } from "lucide-react";
import { AdminAccessState, AdminHeader, AdminStatCard, formatNumber } from "@/components/admin/AdminExperienceShared";
import { useAdminWesbotUsage } from "@/components/admin/useAdminWesbotUsage";
import { Button } from "@/components/ui/button";
import type { BackendWesbotUsageSummary } from "@/lib/api";

function formatUsd(value: number, minimumFractionDigits = 2) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits, maximumFractionDigits: 4 })}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "No successful AI call recorded";
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

const healthPresentation = {
  HEALTHY: { label: "Healthy", detail: "AI routing is within the testing budget.", classes: "border-emerald-200 bg-emerald-50 text-emerald-800", bar: "bg-emerald-600" },
  WATCH: { label: "Watch budget", detail: "At least 80% of the monthly budget is used.", classes: "border-amber-200 bg-amber-50 text-amber-800", bar: "bg-amber-500" },
  CRITICAL: { label: "Near limit", detail: "At least 90% of the monthly budget is used.", classes: "border-orange-200 bg-orange-50 text-orange-800", bar: "bg-orange-500" },
  PAUSED: { label: "AI paused", detail: "The local monthly cap has been reached. Safe routing remains available.", classes: "border-red-200 bg-red-50 text-red-800", bar: "bg-red-600" },
  DISABLED: { label: "AI disabled", detail: "WesBot is currently using non-AI routing only.", classes: "border-slate-200 bg-slate-50 text-slate-700", bar: "bg-slate-500" }
} as const;

function UsageTrend({ usage }: { usage: BackendWesbotUsageSummary }) {
  const visibleDays = usage.daily.slice(-14);
  const maxCalls = Math.max(1, ...visibleDays.map((day) => day.calls));

  return (
    <section className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-primary">Last 14 days</p>
          <h2 className="mt-1 text-xl font-extrabold text-[#17211b]">Semantic AI calls</h2>
        </div>
        <p className="text-xs font-semibold text-[#68746d]">Only ambiguous messages use Gemini</p>
      </div>
      <div className="mt-6 flex h-48 items-end gap-2 border-b border-[#dfe7e0] pb-2" aria-label="WesBot AI calls during the last 14 days">
        {visibleDays.map((day) => {
          const height = day.calls ? Math.max(8, day.calls / maxCalls * 100) : 2;
          return (
            <div key={day.day} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
              <div className="relative flex h-36 w-full items-end justify-center">
                <div
                  className="w-full max-w-8 rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
                  style={{ height: `${height}%` }}
                  title={`${day.day}: ${day.calls} calls, ${day.fallbackCalls} fallbacks`}
                />
              </div>
              <span className="hidden text-[10px] font-semibold text-[#748078] sm:block">{day.day.slice(5)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function AdminWesbotUsageExperience() {
  const { user, ready, openAuth, usage, loading, error, reload } = useAdminWesbotUsage();
  const accessState = <AdminAccessState ready={ready} user={user} openAuth={openAuth} />;
  const health = usage ? healthPresentation[usage.budgetHealth] : null;

  if (!ready || !user || user.role !== "ADMIN") return accessState;

  return (
    <div className="space-y-5">
      <AdminHeader
        eyebrow="WesBot monitoring"
        title="AI usage and testing budget"
        detail="Monitor semantic Gemini calls without storing prompts, student messages, or personal information."
        action={<Button variant="secondary" onClick={() => void reload()} disabled={loading}><RefreshCw className="size-4" /> Refresh</Button>}
      />

      {error ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900" role="alert">
          <p className="font-extrabold">Usage data is not available yet</p>
          <p className="mt-1 leading-6">{error} Apply the new WesBot usage database migration before relying on this dashboard.</p>
        </section>
      ) : null}

      {loading && !usage ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading WesBot usage">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-lg border border-[#dce5dd] bg-white" />)}
        </section>
      ) : usage && health ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <AdminStatCard title="Estimated Spend" value={formatUsd(usage.estimatedSpendUsd)} detail={`${formatUsd(usage.remainingUsd)} remaining of ${formatUsd(usage.budgetUsd)}`} iconSrc="/assets/cash.svg" tone={usage.budgetPercent >= 90 ? "red" : usage.budgetPercent >= 80 ? "yellow" : "green"} />
            <AdminStatCard title="AI Calls" value={formatNumber(usage.successfulCalls)} detail={`${formatNumber(usage.today.successfulCalls)} successful today`} iconSrc="/assets/chat-with-wesbot.svg" />
            <AdminStatCard title="Tokens Used" value={formatNumber(usage.totalTokens)} detail={`${formatNumber(usage.inputTokens)} input · ${formatNumber(usage.outputTokens)} output`} iconSrc="/assets/messages.svg" />
            <AdminStatCard title="Safe Fallbacks" value={formatNumber(usage.fallbackCalls)} detail={`${formatNumber(usage.rateLimitedCalls)} quota · ${formatNumber(usage.timeoutCalls)} timeout`} iconSrc="/assets/verified.svg" tone={usage.fallbackCalls ? "yellow" : "green"} />
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <article className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-primary">Monthly local guard</p>
                  <h2 className="mt-1 text-2xl font-extrabold text-[#17211b]">{formatUsd(usage.estimatedSpendUsd)} of {formatUsd(usage.budgetUsd)}</h2>
                  <p className="mt-2 text-sm leading-6 text-[#68746d]">This is an application estimate based on recorded model tokens. Google AI Studio remains the billing source of truth.</p>
                </div>
                <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold ${health.classes}`}>
                  {usage.budgetHealth === "HEALTHY" ? <ShieldCheck className="size-4" /> : <TriangleAlert className="size-4" />}
                  {health.label}
                </span>
              </div>
              <div className="mt-6 h-3 overflow-hidden rounded-full bg-[#e8eee9]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(usage.budgetPercent))}>
                <div className={`h-full rounded-full transition-[width] ${health.bar}`} style={{ width: `${Math.min(100, usage.budgetPercent)}%` }} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs font-semibold text-[#68746d]">
                <span>{Math.min(100, usage.budgetPercent).toFixed(1)}% used</span>
                <span>{usage.budgetEnforced ? "Local cutoff enabled" : "Monitoring only"}</span>
              </div>
              <p className="mt-5 rounded-md bg-[#f2f7f2] px-4 py-3 text-sm font-semibold leading-6 text-[#425047]">{health.detail}</p>
            </article>

            <article className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-lg bg-[#eaf4ea] text-primary"><Bot className="size-6" /></span>
                <div>
                  <p className="font-extrabold text-[#17211b]">Runtime status</p>
                  <p className="text-xs font-semibold text-[#68746d]">{usage.model}</p>
                </div>
              </div>
              <dl className="mt-5 space-y-4 text-sm">
                <div className="flex items-center justify-between gap-4"><dt className="flex items-center gap-2 text-[#68746d]"><Activity className="size-4" /> Semantic mode</dt><dd className="font-extrabold uppercase text-[#26322b]">{usage.semanticMode}</dd></div>
                <div className="flex items-center justify-between gap-4"><dt className="flex items-center gap-2 text-[#68746d]"><Clock3 className="size-4" /> Average latency</dt><dd className="font-extrabold text-[#26322b]">{formatNumber(usage.averageLatencyMs)} ms</dd></div>
                <div className="flex items-center justify-between gap-4"><dt className="flex items-center gap-2 text-[#68746d]"><Zap className="size-4" /> Last success</dt><dd className="max-w-[55%] text-right font-bold text-[#26322b]">{formatDateTime(usage.lastSuccessAt)}</dd></div>
                <div className="flex items-center justify-between gap-4"><dt className="flex items-center gap-2 text-[#68746d]"><Gauge className="size-4" /> Blocked by budget</dt><dd className="font-extrabold text-[#26322b]">{formatNumber(usage.budgetBlockedCalls)}</dd></div>
              </dl>
            </article>
          </section>

          <UsageTrend usage={usage} />

          <section className="grid gap-5 lg:grid-cols-2">
            <article className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <CircleDollarSign className="mt-0.5 size-6 shrink-0 text-primary" />
                <div>
                  <h2 className="font-extrabold text-[#17211b]">About the $5 testing cap</h2>
                  <p className="mt-2 text-sm leading-6 text-[#68746d]">The app stops new semantic AI calls after the estimated monthly spend reaches $5. WesBot continues using deterministic answers and safe Staff handoff.</p>
                </div>
              </div>
            </article>
            <article className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <ExternalLink className="mt-0.5 size-6 shrink-0 text-primary" />
                <div>
                  <h2 className="font-extrabold text-[#17211b]">Confirm provider billing</h2>
                  <p className="mt-2 text-sm leading-6 text-[#68746d]">Compare this estimate with the selected project in Google AI Studio before changing the cap.</p>
                  <a href="https://aistudio.google.com/app/usage" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-extrabold text-primary hover:underline">Open AI Studio Usage <ExternalLink className="size-4" /></a>
                </div>
              </div>
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}
