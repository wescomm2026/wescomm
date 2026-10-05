"use client";

import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Clock3, PackageCheck, ReceiptText, ShoppingBag, TriangleAlert } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";
import type { StudentOverview } from "@/lib/api";
import { calendarDayDifference, manilaDateKey } from "@/lib/manila-date";
import { cn } from "@/lib/utils";
import { useStudentOverview } from "@/components/student/useStudentOverview";

const STATUS_LABELS = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  READY_FOR_PICKUP: "Ready for Pickup",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show"
} as const;

function greeting(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-PH", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Manila" }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatPeso(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pickupWhen(start: string | null, end: string | null) {
  if (!start) return { day: "Pickup time to be confirmed", time: null, relative: null };
  const day = new Date(start).toLocaleDateString("en-PH", { weekday: "long", month: "short", day: "numeric", timeZone: "Asia/Manila" });
  const timeOptions: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" };
  const time = end
    ? `${new Date(start).toLocaleTimeString("en-PH", timeOptions)} – ${new Date(end).toLocaleTimeString("en-PH", timeOptions)}`
    : new Date(start).toLocaleTimeString("en-PH", timeOptions);
  const today = manilaDateKey(new Date());
  const pickupDay = manilaDateKey(start);
  const difference = today && pickupDay ? calendarDayDifference(today, pickupDay) : null;
  const relative = difference === null ? null : difference === 0 ? "Today" : difference === 1 ? "Tomorrow" : difference > 1 ? `In ${difference} days` : null;
  return { day, time, relative };
}

function NextPickupCard({ pickup, guidance }: { pickup: NonNullable<StudentOverview["nextPickup"]>; guidance: string | null }) {
  const ready = pickup.status === "READY_FOR_PICKUP";
  const when = pickupWhen(pickup.pickupStart, pickup.pickupEnd);
  const [firstItem] = pickup.items;
  const moreItems = Math.max(0, pickup.itemCount - 1);

  return (
    <article className={cn("relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card p-5 shadow-soft sm:p-6", ready && "border-primary/40")}>
      {ready ? <span className="absolute inset-x-0 top-0 h-1 bg-primary" aria-hidden="true" /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-wide text-primary">{ready ? "Ready to collect" : "Next pickup"}</p>
          <p className="mt-1 break-all font-mono text-sm font-extrabold text-foreground">{pickup.referenceCode}</p>
        </div>
        <StatusBadge status={STATUS_LABELS[pickup.status]} />
      </div>

      <div className="mt-4 flex items-start gap-3">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", ready ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>
          {ready ? <PackageCheck className="size-5" aria-hidden="true" /> : <CalendarClock className="size-5" aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <p className="text-lg font-extrabold leading-tight text-foreground">
            {when.relative ? <span className="text-primary">{when.relative} · </span> : null}{when.day}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {when.time ?? "Staff will post the time after confirmation"}{pickup.slotLabel ? ` · ${pickup.slotLabel}` : ""}
          </p>
        </div>
      </div>

      <p className="mt-4 text-sm text-foreground">
        {firstItem ? <><span className="font-bold">{firstItem.quantity}× {firstItem.name}</span>{moreItems ? <span className="text-muted-foreground"> + {moreItems} more item{moreItems === 1 ? "" : "s"}</span> : null}</> : "Reservation items"}
        <span className="text-muted-foreground"> · </span>
        <span className="font-extrabold tabular-nums text-primary">{formatPeso(pickup.totalAmount)}</span>
      </p>

      {pickup.needsScheduleReview ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Staff is reviewing this pickup time. You will be notified if it changes.
        </p>
      ) : ready && guidance ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-primary/5 px-3 py-2 text-xs leading-5 text-foreground">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span><span className="font-bold text-primary">Before you go: </span>{guidance}</span>
        </p>
      ) : !ready ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {pickup.status === "PENDING" ? "Waiting for staff to confirm. Don't visit the commissary yet." : "Staff is preparing your items. We'll notify you when they're ready."}
        </p>
      ) : null}

      <div className="mt-auto pt-5">
        <Link href={`/student/reservations#reservation-${pickup.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary-hover">
          {ready ? "View pickup details" : "View reservation"}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

function StatTile({ href, icon, label, value, detail, highlight, compactValue }: { href: string; icon: React.ReactNode; label: string; value: string; detail: string; highlight?: boolean; compactValue?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-soft transition hover:-translate-y-0.5 hover:border-primary/40",
        highlight && "border-primary/40 bg-primary/5"
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className={cn("grid size-9 place-items-center rounded-lg", highlight ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>{icon}</span>
        <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
      </span>
      <span className={cn("mt-3 break-words font-extrabold tabular-nums text-foreground", compactValue ? "text-base sm:text-xl" : "text-2xl")}>{value}</span>
      <span className="text-sm font-bold text-foreground">{label}</span>
      <span className="mt-0.5 text-xs text-muted-foreground">{detail}</span>
    </Link>
  );
}

export function StudentActivityPanel() {
  const { user } = useStudentAuth();
  const { overview, loading, error, reload } = useStudentOverview();
  if (user?.role !== "STUDENT") return null;
  const firstName = user.fullName?.trim().split(/\s+/)[0] ?? "";

  return (
    <section aria-labelledby="student-activity-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="student-activity-heading" className="text-xl font-extrabold text-foreground sm:text-2xl">
            {greeting(new Date())}{firstName ? `, ${firstName}` : ""}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Here&apos;s where your orders stand right now.</p>
        </div>
        <Link href="/student/reservations" className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline">
          All reservations <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {error && !overview ? (
        <InlineAlert action={<Button size="sm" variant="secondary" onClick={() => void reload()}>Try again</Button>}>{error}</InlineAlert>
      ) : loading && !overview ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" role="status" aria-label="Loading your activity">
          <Skeleton className="h-64 rounded-2xl" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[7.5rem] rounded-2xl" />)}
          </div>
        </div>
      ) : overview ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {overview.nextPickup ? (
            <NextPickupCard pickup={overview.nextPickup} guidance={overview.pickupGuidance} />
          ) : (
            <article className="flex h-full flex-col items-start justify-center rounded-2xl border border-dashed border-border-strong bg-card p-6">
              <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><ShoppingBag className="size-5" aria-hidden="true" /></span>
              <h3 className="mt-3 text-lg font-extrabold text-foreground">No upcoming pickups</h3>
              <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Reserve an item and your next pickup will appear here with its date, time, and status.</p>
              <Link href="/student/shop" className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary-hover">
                Browse items <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </article>
          )}
          <div className="grid grid-cols-2 gap-3">
            <StatTile href="/student/reservations" icon={<Clock3 className="size-4" />} label="Awaiting confirmation" value={String(overview.reservations.PENDING)} detail="Staff is reviewing" />
            <StatTile href="/student/reservations" icon={<CalendarClock className="size-4" />} label="Being prepared" value={String(overview.reservations.CONFIRMED)} detail="Confirmed by staff" />
            <StatTile href="/student/reservations" icon={<PackageCheck className="size-4" />} label="Ready for pickup" value={String(overview.reservations.READY_FOR_PICKUP)} detail="Collect at the commissary" highlight={overview.reservations.READY_FOR_PICKUP > 0} />
            <StatTile href="/student/receipts" icon={<ReceiptText className="size-4" />} label="Spent this month" value={formatPeso(overview.spentThisMonth)} compactValue detail={`${overview.receipts.total} receipt${overview.receipts.total === 1 ? "" : "s"} on file`} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
