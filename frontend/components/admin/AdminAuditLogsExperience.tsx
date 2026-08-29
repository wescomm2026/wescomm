"use client";

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
        setError(auditError instanceof Error ? auditError.message : "Unable to load audit logs.");
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
        eyebrow="Audit logs"
        title="System activity history"
        detail="Review admin and staff actions across products, reservations, receipts, FAQs, users, and support messages."
        action={<Button variant="secondary" onClick={() => void loadLogs()} disabled={loading}><RefreshCw className="size-4" /> Refresh</Button>}
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <AdminStatCard title="Loaded Events" value={String(logs.length)} detail="Most recent activity records" iconSrc="/assets/verified.svg" />
        <AdminStatCard title="Action Types" value={String(actionOptions.length)} detail="Tracked backend actions" iconSrc="/assets/orders.svg" />
        <AdminStatCard title="Entity Types" value={String(entityOptions.length)} detail="Products, users, receipts, and more" iconSrc="/assets/settings.svg" />
      </section>

      <div className="grid gap-3 rounded-lg border border-[#dce5dd] bg-white p-3 lg:grid-cols-[1fr_auto_auto]">
        <label className="flex h-11 min-w-0 items-center rounded-md border border-[#d7e1d8] px-3 focus-within:border-primary">
          <Search className="mr-2 size-5 text-[#68746d]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search action, actor, summary, or entity"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <select value={action} onChange={(event) => setAction(event.target.value)} className="h-11 rounded-md border border-[#d7e1d8] bg-white px-3 text-sm font-semibold outline-none focus:border-primary">
          <option value="All">All actions</option>
          {actionOptions.map((option) => <option key={option} value={option}>{formatAuditAction(option)}</option>)}
        </select>
        <select value={entityType} onChange={(event) => setEntityType(event.target.value)} className="h-11 rounded-md border border-[#d7e1d8] bg-white px-3 text-sm font-semibold outline-none focus:border-primary">
          <option value="All">All entities</option>
          {entityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error.includes("audit_logs") ? "Audit logs table is not created yet. Run backend/DATABASE_AUDIT_LOGS_SQL.txt in Supabase SQL Editor." : error}
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
                <span className="rounded-full bg-[#eef6ee] px-2.5 py-1 font-semibold text-primary">{log.entityType}</span>
                {log.entityId ? <span className="rounded-full bg-[#f4f7f4] px-2.5 py-1">{log.entityId}</span> : null}
              </div>
              {Object.keys(log.metadata ?? {}).length ? (
                <details className="mt-3 rounded-md border border-[#edf1ed] bg-[#fbfdfb]">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-primary">View details</summary>
                  <pre className="overflow-x-auto border-t border-[#edf1ed] p-3 text-xs leading-5 text-[#3f4a44]">{JSON.stringify(log.metadata, null, 2)}</pre>
                </details>
              ) : null}
            </div>
            <div className="xl:text-right">
              <p className="text-sm font-bold text-[#17211b]">{log.actor?.fullName || log.actor?.email || "System"}</p>
              <p className="mt-1 text-xs text-[#68746d]">{log.actor?.email ?? "No actor profile"}</p>
              {log.actor?.role ? <span className="mt-2 inline-block"><StatusBadge status={log.actor.role === "ADMIN" ? "Admin" : log.actor.role === "STAFF" ? "Staff" : "Student"} /></span> : null}
            </div>
          </article>
        )) : (
          <div className="p-6 text-sm font-semibold text-[#68746d]">No audit logs found.</div>
        )}
      </section>
      {nextCursor ? (
        <div className="flex justify-center">
          <Button variant="secondary" disabled={loadingMore} onClick={() => void loadLogs({ cursor: nextCursor })}>
            {loadingMore ? "Loading more..." : "Load more audit events"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
