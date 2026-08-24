"use client";

import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  getAdminUsersPageFromApi,
  updateAdminUserRoleFromApi,
  type BackendAdminUser,
  type BackendAppRole
} from "@/lib/api";
import {
  AdminAccessState,
  AdminHeader,
  AdminStatCard,
  mergeUniqueById
} from "@/components/admin/AdminExperienceShared";

export function AdminUsersExperience() {
  const { user, ready, openAuth } = useStudentAuth();
  const [users, setUsers] = useState<BackendAdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("All");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [roleCounts, setRoleCounts] = useState({ students: 0, staff: 0, admins: 0 });
  const [submittingId, setSubmittingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const deferredSearch = useDeferredValue(search);
  const requestSequenceRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const accessState = <AdminAccessState ready={ready} user={user} openAuth={openAuth} />;

  const loadUsers = useCallback(async ({
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
      const page = await getAdminUsersPageFromApi(user.accessToken, {
        limit: 25,
        cursor,
        query: deferredSearch,
        role: role === "All" ? undefined : role as BackendAppRole,
        signal: requestController.signal
      });
      if (requestId !== requestSequenceRef.current) return;
      setUsers((current) => {
        if (!cursor && !background) return page.items;
        const source = cursor ? [...current, ...page.items] : [...page.items, ...current];
        return mergeUniqueById(source);
      });
      setNextCursor(page.nextCursor);
      setRoleCounts(page.roleCounts);
    } catch (usersError) {
      if (requestId === requestSequenceRef.current && !background) {
        setError(usersError instanceof Error ? usersError.message : "Unable to load users.");
      }
    } finally {
      if (requestId === requestSequenceRef.current) {
        if (cursor) setLoadingMore(false);
        if (!background) setLoading(false);
      }
    }
  }, [deferredSearch, ready, role, user?.accessToken, user?.role]);

  useRealtimeRefresh(["users"], () => {
    void loadUsers({ background: true });
  });

  useEffect(() => {
    void loadUsers();
    return () => requestAbortRef.current?.abort();
  }, [loadUsers]);

  const filteredUsers = users;

  const updateRole = async (row: BackendAdminUser, nextRole: BackendAppRole) => {
    if (!user?.accessToken || row.role === nextRole) return;
    setSubmittingId(row.id);
    setError("");

    try {
      const updatedUser = await updateAdminUserRoleFromApi(user.accessToken, row.id, nextRole);
      setUsers((current) => current
        .map((item) => item.id === updatedUser.id ? updatedUser : item)
        .filter((item) => role === "All" || item.role === role));
      setRoleCounts((current) => {
        const keyForRole = (value: BackendAppRole) => value === "STUDENT" ? "students" : value === "STAFF" ? "staff" : "admins";
        return {
          ...current,
          [keyForRole(row.role)]: Math.max(0, current[keyForRole(row.role)] - 1),
          [keyForRole(updatedUser.role)]: current[keyForRole(updatedUser.role)] + 1
        };
      });
      setNotice(`${updatedUser.email} role updated to ${updatedUser.role}.`);
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : "Unable to update user role.");
    } finally {
      setSubmittingId("");
    }
  };

  if (!ready || !user || user.role !== "ADMIN") return accessState;

  return (
    <div className="space-y-5">
      <AdminHeader
        eyebrow="Users"
        title="Role-based account management"
        detail="Review students, staff, and admins connected to the WESCOMM backend."
        action={<Button variant="secondary" onClick={() => void loadUsers()} disabled={loading}><RefreshCw className="size-4" /> Refresh</Button>}
      />
      <section className="grid gap-4 sm:grid-cols-3">
        <AdminStatCard title="Students" value={String(roleCounts.students)} detail="Student portal accounts" iconSrc="/assets/my-profile.svg" />
        <AdminStatCard title="Staff" value={String(roleCounts.staff)} detail="Operations accounts" iconSrc="/assets/settings.svg" />
        <AdminStatCard title="Admins" value={String(roleCounts.admins)} detail="Decision makers" iconSrc="/assets/verified.svg" />
      </section>

      <div className="flex flex-col gap-3 rounded-lg border border-[#dce5dd] bg-white p-3 sm:flex-row">
        <label className="flex h-11 min-w-0 flex-1 items-center rounded-md border border-[#d7e1d8] px-3 focus-within:border-primary">
          <Search className="mr-2 size-5 text-[#68746d]" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, student number, or department" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
        <select value={role} onChange={(event) => setRole(event.target.value)} className="h-11 rounded-md border border-[#d7e1d8] bg-white px-3 text-sm font-semibold outline-none focus:border-primary">
          <option value="All">All roles</option>
          <option value="STUDENT">Student</option>
          <option value="STAFF">Staff</option>
          <option value="ADMIN">Admin</option>
        </select>
      </div>

      {notice ? <p className="rounded-md border border-[#cfe0d0] bg-[#f3f9f3] px-4 py-3 text-sm font-semibold text-primary">{notice}</p> : null}
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      {loading ? <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">Loading users...</div> : null}

      <section className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
        {filteredUsers.length ? filteredUsers.map((row) => (
          <article key={row.id} className="content-visibility-auto grid gap-3 border-b border-[#edf1ed] p-4 last:border-0 lg:grid-cols-[1.1fr_1.1fr_auto_auto] lg:items-center">
            <div>
              <p className="font-extrabold text-[#17211b]">{row.fullName || row.email}</p>
              <p className="mt-1 text-xs text-[#68746d]">{row.studentNumber || row.id}</p>
            </div>
            <div>
              <p className="text-sm font-semibold">{row.email}</p>
              <p className="mt-1 text-xs text-[#68746d]">{row.department || "No department set"}</p>
            </div>
            <StatusBadge status={row.role === "STUDENT" ? "Student" : row.role === "STAFF" ? "Staff" : "Admin"} />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={row.role}
                disabled={submittingId === row.id}
                onChange={(event) => void updateRole(row, event.target.value as BackendAppRole)}
                className="h-10 rounded-md border border-[#d7e1d8] bg-white px-3 text-sm font-bold text-primary outline-none focus:border-primary"
              >
                <option value="STUDENT">Student</option>
                <option value="STAFF">Staff</option>
                <option value="ADMIN">Admin</option>
              </select>
              <span className="text-xs text-[#68746d]">{submittingId === row.id ? "Saving..." : " "}</span>
            </div>
          </article>
        )) : (
          <div className="p-6 text-sm font-semibold text-[#68746d]">No matching users found.</div>
        )}
      </section>
      {nextCursor ? (
        <div className="flex justify-center">
          <Button variant="secondary" disabled={loadingMore} onClick={() => void loadUsers({ cursor: nextCursor })}>
            {loadingMore ? "Loading more..." : "Load more users"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
