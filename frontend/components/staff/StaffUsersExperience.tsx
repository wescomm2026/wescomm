"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { Button } from "@/components/ui/button";
import { FeedbackState } from "@/components/ui/FeedbackState";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { MetricCard } from "@/components/ui/MetricCard";
import { SkeletonList } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getStaffUsersFromApi, isRequestAbortError, type BackendAdminUser } from "@/lib/api";
import { PageHeading } from "@/components/staff/StaffOperationsShared";

export function StaffUsersExperience() {
  const { user, ready, openAuth } = useStudentAuth();
  const [users, setUsers] = useState<BackendAdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSequenceRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  const loadUsers = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!ready) return;
    const requestId = ++requestSequenceRef.current;
    requestAbortRef.current?.abort();
    const requestController = new AbortController();
    requestAbortRef.current = requestController;
    if (!user?.accessToken || (user.role !== "STAFF" && user.role !== "ADMIN")) {
      requestController.abort();
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const rows = await getStaffUsersFromApi(user.accessToken, requestController.signal);
      if (requestId !== requestSequenceRef.current) return;
      setUsers(rows);
    } catch (usersError) {
      if (requestId === requestSequenceRef.current && !background && !isRequestAbortError(usersError)) {
        setError(userFacingErrorMessage(usersError, "Unable to load staff accounts."));
      }
    } finally {
      if (requestId === requestSequenceRef.current && !background) setLoading(false);
    }
  }, [ready, user?.accessToken, user?.role]);

  useEffect(() => {
    void loadUsers();
    return () => requestAbortRef.current?.abort();
  }, [loadUsers]);

  useEffect(() => {
    if (!user?.accessToken || (user.role !== "STAFF" && user.role !== "ADMIN")) return;

    const refresh = () => {
      if (document.visibilityState === "visible") void loadUsers({ background: true });
    };

    const interval = window.setInterval(refresh, 5 * 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadUsers, user?.accessToken, user?.role]);

  if (!ready) {
    return <SkeletonList rows={4} label="Loading account" className="rounded-xl border bg-card shadow-soft" />;
  }

  if (!user) {
    return (
      <FeedbackState
        kind="empty"
        title="Staff sign in required"
        description="Use a staff or admin account to view live account access."
        action={<Button onClick={openAuth}>Sign in</Button>}
      />
    );
  }

  if (user.role !== "STAFF" && user.role !== "ADMIN") {
    return <InlineAlert>This page is restricted to staff and admin accounts.</InlineAlert>;
  }

  const staffCount = users.filter((row) => row.role === "STAFF").length;
  const adminCount = users.filter((row) => row.role === "ADMIN").length;

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Team access"
        title="User access overview"
        detail="Review staff and admin accounts with access to WESCOMM. Role changes are made by an admin."
        action={(
          <Button variant="secondary" onClick={() => void loadUsers()} disabled={loading}>
            <RefreshCw className={loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} aria-hidden="true" /> Refresh
          </Button>
        )}
      />
      <section className="grid gap-4 sm:grid-cols-2">
        <MetricCard label="Staff accounts" value={staffCount} detail="Operations users" iconSrc="/assets/settings.svg" />
        <MetricCard label="Admin accounts" value={adminCount} detail="Decision makers" iconSrc="/assets/privacy.svg" />
      </section>
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      <section aria-label="Team accounts" className="overflow-hidden rounded-xl border bg-card shadow-soft">
        <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_100px] gap-4 border-b bg-surface-subtle px-5 py-3 text-xs font-bold uppercase tracking-wide text-muted-foreground sm:grid">
          <span>Account</span>
          <span>Contact</span>
          <span>Role</span>
        </div>
        {loading && !users.length ? (
          <SkeletonList rows={3} label="Loading live account data" />
        ) : users.length ? (
          <div className="divide-y">
            {users.map((row) => (
              <article key={row.id} className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_100px] sm:items-center sm:gap-4 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className={row.role === "ADMIN"
                    ? "grid size-10 shrink-0 place-items-center rounded-full bg-accent/20 text-xs font-extrabold text-accent-foreground"
                    : "grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-extrabold text-primary"}>
                    {(row.fullName || row.email).split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-extrabold text-foreground">{row.fullName || row.email}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.department || "No department set"}</p>
                  </div>
                </div>
                <p className="min-w-0 break-all pl-[52px] text-sm font-semibold text-foreground sm:pl-0">{row.email}</p>
                <div className="pl-[52px] sm:pl-0"><StatusBadge status={row.role === "ADMIN" ? "Admin" : "Staff"} /></div>
              </article>
            ))}
          </div>
        ) : (
          <FeedbackState plain kind="empty" title="No staff or admin accounts are available." />
        )}
      </section>
    </div>
  );
}
