"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { Button } from "@/components/ui/button";
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
    return <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">Loading account...</div>;
  }

  if (!user) {
    return (
      <section className="rounded-lg border border-[#dce5dd] bg-white p-6 shadow-sm">
        <p className="font-extrabold text-[#17211b]">Staff sign in required</p>
        <p className="mt-2 text-sm text-[#68746d]">Use a staff or admin account to view live account access.</p>
        <Button className="mt-5" onClick={openAuth}>Sign in</Button>
      </section>
    );
  }

  if (user.role !== "STAFF" && user.role !== "ADMIN") {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700">This page is restricted to staff and admin accounts.</div>;
  }

  const staffCount = users.filter((row) => row.role === "STAFF").length;
  const adminCount = users.filter((row) => row.role === "ADMIN").length;

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Staff accounts"
        title="User access overview"
        detail="Review staff and admin accounts with access to WESCOMM."
        action={<Button variant="secondary" onClick={() => void loadUsers()} disabled={loading}><RefreshCw className="size-4" /> Refresh</Button>}
      />
      <section className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-[#26322b]">Staff accounts</p>
          <p className="mt-1 text-3xl font-extrabold text-primary">{staffCount}</p>
          <p className="mt-1 text-xs text-[#68746d]">Operations users</p>
        </article>
        <article className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-[#26322b]">Admin accounts</p>
          <p className="mt-1 text-3xl font-extrabold text-primary">{adminCount}</p>
          <p className="mt-1 text-xs text-[#68746d]">Decision makers</p>
        </article>
      </section>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      {loading ? <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">Loading live account data...</div> : null}
      <section className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
        {users.length ? users.map((row) => (
          <article key={row.id} className="grid gap-3 border-b border-[#edf1ed] p-4 last:border-0 sm:grid-cols-[1fr_1.2fr_auto] sm:items-center">
            <div>
              <p className="font-extrabold text-[#17211b]">{row.fullName || row.email}</p>
              <p className="mt-1 break-all text-xs text-[#68746d]">{row.id}</p>
            </div>
            <div>
              <p className="break-all text-sm font-semibold text-[#26322b]">{row.email}</p>
              <p className="mt-1 text-xs text-[#68746d]">{row.department || "No department set"}</p>
            </div>
            <StatusBadge status={row.role === "ADMIN" ? "Admin" : "Staff"} />
          </article>
        )) : (
          <div className="p-6 text-sm font-semibold text-[#68746d]">No staff or admin accounts are available.</div>
        )}
      </section>
    </div>
  );
}
