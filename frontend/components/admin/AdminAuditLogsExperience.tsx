"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { Button } from "@/components/ui/button";
import { FeedbackState } from "@/components/ui/FeedbackState";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { SkeletonList } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  getAdminAuditLogsFromApi,
  type BackendAuditLog
} from "@/lib/api";
import {
  AdminAccessState,
  AdminHeader,
  formatAuditAction,
  formatAuditDate,
  mergeUniqueById
} from "@/components/admin/AdminExperienceShared";

const AUDIT_FIELD_LABELS: Record<string, string> = {
  lowStock: "Restock alerts",
  nextText: "New text",
  previousText: "Previous text",
  receipts: "Receipt verification alerts",
  reservations: "Reservation alerts",
  actionUrl: "Destination",
  activeSlotCount: "Active pickup times",
  amount: "Amount",
  attemptNumber: "Attempt number",
  category: "Category",
  changedFields: "Information changed",
  closureDate: "Closure date",
  closureReason: "Closure reason",
  combinationCount: "Stock combinations",
  contentType: "File type",
  createdAt: "Created",
  difference: "Quantity change",
  duration: "Restriction duration",
  email: "Email",
  enabledWeekdays: "Enabled weekdays",
  endsAt: "Ends",
  expiresAt: "Expires",
  fields: "Information changed",
  fileName: "File name",
  imageCleanupQueued: "Image cleanup scheduled",
  inventoryReviewReason: "Inventory review reason",
  isActive: "Active",
  isPublished: "Published",
  itemCount: "Line items",
  level: "Restriction level",
  lowStockPercent: "Low-stock alert",
  lowStockThreshold: "Low-stock quantity",
  manualReviewRequired: "Needs manual review",
  mode: "Stock action",
  name: "Product name",
  newPickupEnd: "New pickup end",
  newPickupStart: "New pickup start",
  newScheduleRevision: "New schedule version",
  newSellingPrice: "New selling price",
  newStock: "Stock after action",
  next: "After change",
  nextRole: "New account role",
  optionGroupCount: "Option groups",
  optionName: "Option name",
  optionValue: "Option value",
  path: "Storage location",
  previous: "Before change",
  previousMode: "Previous selling mode",
  previousPickupEnd: "Previous pickup end",
  previousPickupStart: "Previous pickup start",
  previousRole: "Previous account role",
  previousScheduleRevision: "Previous schedule version",
  previousSellingPrice: "Previous selling price",
  previousStock: "Stock before action",
  price: "Selling price",
  quantity: "Quantity",
  reason: "Reason",
  receiptCode: "Receipt code",
  referenceCode: "Reservation reference",
  reservationCancelled: "Reservation cancelled",
  saleMode: "Selling mode",
  sellingPriceChanged: "Selling price changed",
  skuInventoryEnabled: "Tracks stock by option",
  startsAt: "Starts",
  status: "Status",
  stock: "Stock",
  stockReleased: "Stock returned",
  stockTarget: "Full-stock target",
  structureChanged: "Option structure changed",
  structuralChange: "Option structure changed",
  totalAmount: "Total amount",
  totalQuantity: "Total quantity",
  unitCost: "Unit acquisition cost",
  updatedAt: "Updated",
  url: "File link",
  variantCount: "Options",
  variants: "Options",
  version: "Policy version",
  wasPublished: "Previously published"
};

const AUDIT_ENTITY_LABELS: Record<string, string> = {
  account_restriction: "Student access restriction",
  app_setting: "Team setting",
  auth_session: "Sign-in",
  conversation: "Support conversation",
  faq: "FAQ",
  inventory_batch: "Stock cost batch",
  online_payment: "Historical online payment",
  payment: "Payment",
  pickup_policy: "Pickup policy",
  product: "Product",
  product_image: "Product image",
  profile: "Profile",
  receipt: "Receipt",
  reservation: "Reservation",
  student_offense: "Student warning",
  user: "User account"
};

type AuditDetailRow = {
  id: string;
  label: string;
  value: string;
};

function auditFieldLabel(value: string) {
  if (AUDIT_FIELD_LABELS[value]) return AUDIT_FIELD_LABELS[value];
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b(id|url|sku|faq|qr|or)\b/gi, (part) => part.toUpperCase())
    .replace(/^./, (letter) => letter.toUpperCase());
}

function auditEntityLabel(value: string) {
  return AUDIT_ENTITY_LABELS[value] ?? auditFieldLabel(value);
}

function looksLikeDate(value: string, key: string) {
  return /(?:at|date|start|end|expires)$/i.test(key)
    && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function formatAuditDetailValue(value: unknown, key: string): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (typeof value === "number") {
    if (/percent/i.test(key)) return `${value}%`;
    if (/(?:amount|cost|price|profit|revenue)$/i.test(key)) {
      return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return value.toLocaleString("en-PH");
  }

  const text = String(value);
  if (looksLikeDate(text, key)) return formatAuditDate(text);
  if (/(?:amount|cost|price|profit|revenue)$/i.test(key) && /^-?\d+(?:\.\d+)?$/.test(text)) {
    return `PHP ${Number(text).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (key === "changedFields" || key === "fields") return auditFieldLabel(text);
  if (/^[A-Z][A-Z0-9_]*$/.test(text)) return formatAuditAction(text);
  return text;
}

function collectAuditDetails(value: unknown, path: string[] = [], rows: AuditDetailRow[] = []): AuditDetailRow[] {
  const key = path.at(-1) ?? "detail";

  if (Array.isArray(value)) {
    if (!value.length) {
      rows.push({ id: path.join(".") || "detail", label: path.map(auditFieldLabel).join(" · ") || "Details", value: "None" });
      return rows;
    }
    if (value.every((item) => item === null || typeof item !== "object")) {
      rows.push({
        id: path.join(".") || "detail",
        label: path.map(auditFieldLabel).join(" · ") || "Details",
        value: value.map((item) => formatAuditDetailValue(item, key)).join(", ")
      });
      return rows;
    }
    value.forEach((item, index) => collectAuditDetails(item, [...path, `item ${index + 1}`], rows));
    return rows;
  }

  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([nestedKey, nestedValue]) => {
      collectAuditDetails(nestedValue, [...path, nestedKey], rows);
    });
    return rows;
  }

  rows.push({
    id: path.join(".") || "detail",
    label: path.map(auditFieldLabel).join(" · ") || "Details",
    value: formatAuditDetailValue(value, key)
  });
  return rows;
}

function shortRecordReference(value: string) {
  return value.length > 24 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function AuditActivityDetails({ metadata }: { metadata: Record<string, unknown> }) {
  const details = collectAuditDetails(metadata);
  if (!details.length) return null;

  return (
    <details className="group mt-3 overflow-hidden rounded-lg border bg-surface-subtle">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-bold text-primary marker:content-none hover:bg-muted/60">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden="true" />
        <span>What changed</span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs">{details.length}</span>
        <span className="ml-auto text-xs font-semibold text-muted-foreground group-open:hidden">Show details</span>
        <span className="ml-auto hidden text-xs font-semibold text-muted-foreground group-open:inline">Hide details</span>
      </summary>
      <dl className="grid gap-px border-t bg-border sm:grid-cols-2">
        {details.map((detail, index) => (
          <div key={`${detail.id}-${index}`} className="min-w-0 bg-card px-3 py-2.5">
            <dt className="text-xs font-bold text-muted-foreground">{detail.label}</dt>
            <dd className="mt-0.5 text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{detail.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function auditDayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
}

function auditTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
}

function mergeOptions(current: string[], next: string[]) {
  const merged = Array.from(new Set([...current, ...next.filter(Boolean)])).sort();
  return merged.length === current.length && merged.every((value, index) => value === current[index]) ? current : merged;
}

export function AdminAuditLogsExperience({ initialEntityType }: { initialEntityType?: string }) {
  const { user, ready, openAuth } = useStudentAuth();
  const [logs, setLogs] = useState<BackendAuditLog[]>([]);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("All");
  const [entityType, setEntityType] = useState(initialEntityType?.trim() || "All");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const deferredSearch = useDeferredValue(search);
  const requestSequenceRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const accessState = <AdminAccessState ready={ready} user={user} openAuth={openAuth} />;

  const loadLogs = useCallback(async ({
    background = false,
    cursor
  }: { background?: boolean; cursor?: string } = {}) => {
    const requestId = ++requestSequenceRef.current;
    requestAbortRef.current?.abort();
    const requestController = new AbortController();
    requestAbortRef.current = requestController;
    if (!ready) return;
    if (!user?.accessToken || user.role !== "ADMIN") {
      setLoading(false);
      return;
    }

    if (cursor) setLoadingMore(true);
    else if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const page = await getAdminAuditLogsFromApi(user.accessToken, {
        action: action === "All" ? undefined : action,
        entityType: entityType === "All" ? undefined : entityType,
        query: deferredSearch,
        cursor,
        limit: 25,
        signal: requestController.signal
      });
      if (requestId !== requestSequenceRef.current) return;
      setLogs((current) => {
        if (!cursor && !background) return page.items;
        const source = cursor ? [...current, ...page.items] : [...page.items, ...current];
        return mergeUniqueById(source);
      });
      setNextCursor(page.nextCursor);
    } catch (auditError) {
      if (requestId === requestSequenceRef.current && !background) {
        setError(userFacingErrorMessage(auditError, "Unable to load activity history."));
      }
    } finally {
      if (requestId === requestSequenceRef.current) {
        if (cursor) setLoadingMore(false);
        if (!background) setLoading(false);
      }
    }
  }, [action, deferredSearch, entityType, ready, user?.accessToken, user?.role]);

  useRealtimeRefresh(["users"], () => {
    void loadLogs({ background: true });
  });

  useEffect(() => {
    void loadLogs();
    return () => requestAbortRef.current?.abort();
  }, [loadLogs]);

  useEffect(() => {
    if (!user?.accessToken || user.role !== "ADMIN") return;

    const refresh = () => {
      if (document.visibilityState === "visible") void loadLogs({ background: true });
    };

    const interval = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadLogs, user?.accessToken, user?.role]);

  const [actionOptions, setActionOptions] = useState<string[]>([]);
  const [entityOptions, setEntityOptions] = useState<string[]>([]);
  useEffect(() => {
    // Remember every option seen so choosing one filter does not hide the others.
    setActionOptions((current) => mergeOptions(current, [...logs.map((log) => log.action), action === "All" ? "" : action]));
    setEntityOptions((current) => mergeOptions(current, [...logs.map((log) => log.entityType), entityType === "All" ? "" : entityType]));
  }, [action, entityType, logs]);
  const filteredLogs = logs;
  const groupedLogs = useMemo(() => filteredLogs.reduce<Array<{ day: string; items: BackendAuditLog[] }>>((groups, log) => {
    const day = auditDayKey(log.createdAt);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(log);
    else groups.push({ day, items: [log] });
    return groups;
  }, []), [filteredLogs]);
  const filtersActive = Boolean(search.trim()) || action !== "All" || entityType !== "All";
  const clearFilters = () => {
    setSearch("");
    setAction("All");
    setEntityType("All");
  };

  if (!ready || !user || user.role !== "ADMIN") return accessState;

  return (
    <div className="space-y-5">
      <AdminHeader
        eyebrow="Audit logs"
        title="Staff and admin actions"
        detail="Review admin and staff actions across products, reservations, receipts, FAQs, users, and support messages."
        action={(
          <Button variant="secondary" onClick={() => void loadLogs()} disabled={loading}>
            <RefreshCw className={loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} aria-hidden="true" /> Refresh
          </Button>
        )}
      />

      <div className="space-y-2 rounded-xl border bg-card p-2 shadow-soft">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px_220px_auto]">
          <label className="relative flex h-11 min-w-0 items-center rounded-control border border-border-strong bg-white transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
            <span className="sr-only">Search activity</span>
            <Search className="pointer-events-none ml-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search action, person, summary, or area"
              className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none focus-visible:outline-none placeholder:text-muted-foreground"
            />
            {search ? (
              <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="mr-1.5 grid size-8 place-items-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <select aria-label="Filter by action" value={action} onChange={(event) => setAction(event.target.value)} className="h-11 cursor-pointer rounded-control border border-border-strong bg-white px-3 text-sm font-semibold outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15">
            <option value="All">All actions</option>
            {actionOptions.map((option) => <option key={option} value={option}>{formatAuditAction(option)}</option>)}
          </select>
          <select aria-label="Filter by area" value={entityType} onChange={(event) => setEntityType(event.target.value)} className="h-11 cursor-pointer rounded-control border border-border-strong bg-white px-3 text-sm font-semibold outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15">
            <option value="All">All areas</option>
            {entityOptions.map((option) => <option key={option} value={option}>{auditEntityLabel(option)}</option>)}
          </select>
          {filtersActive ? (
            <Button variant="ghost" className="h-11" onClick={clearFilters}><X className="size-4" /> Clear</Button>
          ) : null}
        </div>
        <p className="px-2 pb-1 text-xs font-semibold text-muted-foreground" aria-live="polite">
          {loading && !logs.length
            ? "Loading activity..."
            : `Showing ${logs.length} ${logs.length === 1 ? "activity" : "activities"}${nextCursor ? " (more available)" : ""} · ${actionOptions.length} action type${actionOptions.length === 1 ? "" : "s"} · ${entityOptions.length} area${entityOptions.length === 1 ? "" : "s"}`}
        </p>
      </div>

      {error ? (
        <InlineAlert action={<Button size="sm" variant="secondary" onClick={() => void loadLogs()}>Retry</Button>}>
          {error}
        </InlineAlert>
      ) : null}

      {loading && !filteredLogs.length ? (
        <SkeletonList rows={5} label="Loading audit logs" className="overflow-hidden rounded-xl border bg-card shadow-soft" />
      ) : filteredLogs.length ? (
        <div className={loading ? "space-y-5 opacity-60 transition-opacity" : "space-y-5 transition-opacity"}>
          {groupedLogs.map((group) => (
            <section key={group.day} aria-label={group.day} className="overflow-hidden rounded-xl border bg-card shadow-soft">
              <h2 className="border-b bg-surface-subtle px-4 py-2.5 text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground sm:px-5">
                {group.day}
              </h2>
              <ol className="divide-y">
                {group.items.map((log) => (
                  <li key={log.id}>
                    <article className="content-visibility-auto grid gap-3 px-4 py-4 sm:px-5 xl:grid-cols-[110px_minmax(0,1fr)_220px] xl:items-start">
                      <div className="flex flex-wrap items-center gap-x-2 xl:block">
                        <p className="text-sm font-bold tabular-nums text-foreground">{auditTime(log.createdAt)}</p>
                        <p className="text-[11px] font-extrabold uppercase tracking-wide text-primary xl:mt-1">{formatAuditAction(log.action)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold leading-6 text-foreground">{log.summary}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">{auditEntityLabel(log.entityType)}</span>
                          {log.entityId ? <span title={log.entityId} className="rounded-full bg-muted px-2.5 py-1 font-mono text-muted-foreground">Ref {shortRecordReference(log.entityId)}</span> : null}
                        </div>
                        <AuditActivityDetails metadata={log.metadata ?? {}} />
                      </div>
                      <div className="flex min-w-0 items-center gap-2 xl:flex-col xl:items-end xl:text-right">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-foreground">{log.actor?.fullName || log.actor?.email || "System"}</p>
                          <p className="truncate text-xs text-muted-foreground" title={formatAuditDate(log.createdAt)}>{log.actor?.email ?? "No actor profile"}</p>
                        </div>
                        {log.actor?.role ? <StatusBadge status={log.actor.role === "ADMIN" ? "Admin" : log.actor.role === "STAFF" ? "Staff" : "Student"} /> : null}
                      </div>
                    </article>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        <FeedbackState
          kind="empty"
          title="No activity records found"
          description={filtersActive ? "No recorded actions match these filters." : "Staff and admin actions will appear here as they happen."}
          action={filtersActive ? <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button> : undefined}
        />
      )}
      {nextCursor ? (
        <div className="flex justify-center">
          <Button variant="secondary" loading={loadingMore} onClick={() => void loadLogs({ cursor: nextCursor })}>
            {loadingMore ? "Loading more..." : "Load more activity"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
