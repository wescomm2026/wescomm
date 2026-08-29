import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  "In Stock": "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "Low Stock": "bg-amber-50 text-amber-700 ring-amber-200",
  Available: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "Needs Restock": "bg-amber-50 text-amber-700 ring-amber-200",
  "Out of Stock": "bg-rose-50 text-rose-700 ring-rose-200",
  "On Sale": "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Pending: "bg-amber-50 text-amber-700 ring-amber-200",
  Initializing: "bg-sky-50 text-sky-700 ring-sky-200",
  "Awaiting payment": "bg-amber-50 text-amber-700 ring-amber-200",
  Processing: "bg-sky-50 text-sky-700 ring-sky-200",
  Paid: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Failed: "bg-rose-50 text-rose-700 ring-rose-200",
  "Refund pending": "bg-amber-50 text-amber-700 ring-amber-200",
  "Refund review required": "bg-amber-50 text-amber-700 ring-amber-200",
  "Partially refunded": "bg-indigo-50 text-indigo-700 ring-indigo-200",
  Refunded: "bg-slate-50 text-slate-700 ring-slate-200",
  Confirmed: "bg-sky-50 text-sky-700 ring-sky-200",
  Completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Verified: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Voided: "bg-rose-50 text-rose-700 ring-rose-200",
  Cancelled: "bg-rose-50 text-rose-700 ring-rose-200",
  "No-show": "bg-rose-50 text-rose-700 ring-rose-200",
  Restricted: "bg-rose-50 text-rose-700 ring-rose-200",
  Warning: "bg-amber-50 text-amber-700 ring-amber-200",
  Clear: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Lifted: "bg-slate-50 text-slate-700 ring-slate-200",
  Expired: "bg-slate-50 text-slate-700 ring-slate-200",
  Published: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Draft: "bg-slate-50 text-slate-700 ring-slate-200",
  Student: "bg-sky-50 text-sky-700 ring-sky-200",
  Staff: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Admin: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  High: "bg-rose-50 text-rose-700 ring-rose-200",
  Medium: "bg-amber-50 text-amber-700 ring-amber-200",
  Positive: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Open: "bg-sky-50 text-sky-700 ring-sky-200",
  "WesBot active": "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "Waiting for Staff": "bg-amber-50 text-amber-700 ring-amber-200",
  "Staff active": "bg-sky-50 text-sky-700 ring-sky-200",
  Unread: "bg-rose-50 text-rose-700 ring-rose-200",
  Resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "Ready for Pick-up": "bg-indigo-50 text-indigo-700 ring-indigo-200",
  "Ready for Pickup": "bg-indigo-50 text-indigo-700 ring-indigo-200"
};

export type DomainStatus =
  | "IN_STOCK" | "RESTOCK_SOON" | "OUT_OF_STOCK" | "ON_SALE"
  | "PENDING" | "CONFIRMED" | "READY_FOR_PICKUP" | "COMPLETED" | "CANCELLED" | "NO_SHOW"
  | "VERIFIED" | "VOIDED" | "ACTIVE" | "EXPIRED" | "LIFTED"
  | "INITIALIZING" | "AWAITING_PAYMENT" | "PAID" | "REFUND_REVIEW_REQUIRED" | "PARTIALLY_REFUNDED" | "REFUNDED";

const domainDisplay: Record<DomainStatus, string> = {
  IN_STOCK: "In Stock", RESTOCK_SOON: "Needs Restock", OUT_OF_STOCK: "Out of Stock", ON_SALE: "On Sale",
  PENDING: "Pending", CONFIRMED: "Confirmed", READY_FOR_PICKUP: "Ready for Pick-up", COMPLETED: "Completed", CANCELLED: "Cancelled", NO_SHOW: "No-show",
  VERIFIED: "Verified", VOIDED: "Voided", ACTIVE: "Restricted", EXPIRED: "Expired", LIFTED: "Lifted",
  INITIALIZING: "Initializing", AWAITING_PAYMENT: "Awaiting payment", PAID: "Paid", REFUND_REVIEW_REQUIRED: "Refund review required", PARTIALLY_REFUNDED: "Partially refunded", REFUNDED: "Refunded"
};

export function StatusBadge({ status, statusKey }: { status?: string; statusKey?: DomainStatus }) {
  const display = statusKey ? domainDisplay[statusKey] : status ?? "Unknown";
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1", tones[display] ?? "bg-muted text-muted-foreground ring-border")}>
      {display}
    </span>
  );
}
