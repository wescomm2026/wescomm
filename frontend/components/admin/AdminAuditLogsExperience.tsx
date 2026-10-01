"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  getAdminAuditLogsFromApi,
  type BackendAuditLog
} from "@/lib/api";
import {
  AdminAccessState,
  AdminHeader,
  AdminStatCard,
  formatAuditAction,
  formatAuditDate,
  mergeUniqueById
} from "@/components/admin/AdminExperienceShared";

const AUDIT_FIELD_LABELS: Record<string, string> = {
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
    <details className="group mt-3 overflow-hidden rounded-lg border border-[#dfe7e0] bg-[#fbfdfb]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-bold text-primary marker:content-none">
        <span>What changed</span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs">{details.length}</span>
        <span className="ml-auto text-xs text-[#68746d] group-open:hidden">Show details</span>
        <span className="ml-auto hidden text-xs text-[#68746d] group-open:inline">Hide details</span>
      </summary>
      <dl className="grid gap-px border-t border-[#dfe7e0] bg-[#dfe7e0] sm:grid-cols-2">
        {details.map((detail, index) => (
          <div key={`${detail.id}-${index}`} className="min-w-0 bg-white px-3 py-3">
            <dt className="text-xs font-bold text-[#68746d]">{detail.label}</dt>
            <dd className="mt-1 break-words text-sm font-semibold text-[#26322b] [overflow-wrap:anywhere]">{detail.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
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

  const actionOptions = useMemo(() => Array.from(new Set(logs.map((log) => log.action))).sort(), [logs]);
  const entityOptions = useMemo(() => Array.from(new Set(logs.map((log) => log.entityType))).sort(), [logs]);
  const filteredLogs = logs;

  if (!ready || !user || user.role !== "ADMIN") return accessState;

  return (
    <div className="space-y-5">
      <AdminHeader
        eyebrow="Activity history"
        title="Staff and admin actions"
        detail="Review admin and staff actions across products, reservations, receipts, FAQs, users, and support messages."
        action={<Button variant="secondary" onClick={() => void loadLogs()} disabled={loading}><RefreshCw className="size-4" /> Refresh</Button>}
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <AdminStatCard title="Activities Loaded" value={String(logs.length)} detail="Most recent staff and admin actions" iconSrc="/assets/verified.svg" />
        <AdminStatCard title="Activity Categories" value={String(actionOptions.length)} detail="Different types of recorded actions" iconSrc="/assets/orders.svg" />
        <AdminStatCard title="Areas Covered" value={String(entityOptions.length)} detail="Products, users, receipts, and more" iconSrc="/assets/settings.svg" />
      </section>

      <div className="grid gap-3 rounded-lg border border-[#dce5dd] bg-white p-3 lg:grid-cols-[1fr_auto_auto]">
        <label className="flex h-11 min-w-0 items-center rounded-md border border-[#d7e1d8] px-3 focus-within:border-primary">
          <Search className="mr-2 size-5 text-[#68746d]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search action, person, summary, or area"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <select value={action} onChange={(event) => setAction(event.target.value)} className="h-11 rounded-md border border-[#d7e1d8] bg-white px-3 text-sm font-semibold outline-none focus:border-primary">
          <option value="All">All actions</option>
          {actionOptions.map((option) => <option key={option} value={option}>{formatAuditAction(option)}</option>)}
        </select>
        <select value={entityType} onChange={(event) => setEntityType(event.target.value)} className="h-11 rounded-md border border-[#d7e1d8] bg-white px-3 text-sm font-semibold outline-none focus:border-primary">
          <option value="All">All areas</option>
          {entityOptions.map((option) => <option key={option} value={option}>{auditEntityLabel(option)}</option>)}
        </select>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      {loading ? <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">Loading audit logs...</div> : null}

      <section className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
        {filteredLogs.length ? filteredLogs.map((log) => (
          <article key={log.id} className="content-visibility-auto grid gap-3 border-b border-[#edf1ed] p-4 last:border-0 xl:grid-cols-[220px_1fr_180px] xl:items-start">
            <div>
              <p className="text-xs font-bold uppercase text-primary">{formatAuditAction(log.action)}</p>
              <p className="mt-1 text-xs text-[#68746d]">{formatAuditDate(log.createdAt)}</p>
            </div>
            <div>
              <p className="font-extrabold text-[#17211b]">{log.summary}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-[#68746d]">
                <span className="rounded-full bg-[#eef6ee] px-2.5 py-1 font-semibold text-primary">{auditEntityLabel(log.entityType)}</span>
                {log.entityId ? <span title={log.entityId} className="rounded-full bg-[#f4f7f4] px-2.5 py-1">Reference: {shortRecordReference(log.entityId)}</span> : null}
              </div>
              <AuditActivityDetails metadata={log.metadata ?? {}} />
            </div>
            <div className="xl:text-right">
              <p className="text-sm font-bold text-[#17211b]">{log.actor?.fullName || log.actor?.email || "System"}</p>
              <p className="mt-1 text-xs text-[#68746d]">{log.actor?.email ?? "No actor profile"}</p>
              {log.actor?.role ? <span className="mt-2 inline-block"><StatusBadge status={log.actor.role === "ADMIN" ? "Admin" : log.actor.role === "STAFF" ? "Staff" : "Student"} /></span> : null}
            </div>
          </article>
        )) : (
          <div className="p-6 text-sm font-semibold text-[#68746d]">No activity records found.</div>
        )}
      </section>
      {nextCursor ? (
        <div className="flex justify-center">
          <Button variant="secondary" disabled={loadingMore} onClick={() => void loadLogs({ cursor: nextCursor })}>
            {loadingMore ? "Loading more..." : "Load more activity"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
