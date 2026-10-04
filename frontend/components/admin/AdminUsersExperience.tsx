"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { Button } from "@/components/ui/button";
import { useConfirmationDialog } from "@/components/ui/ConfirmationDialogProvider";
import { FeedbackState } from "@/components/ui/FeedbackState";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { SkeletonList } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  getAdminUsersPageFromApi,
  updateAdminUserRoleFromApi,
  type BackendAdminUser,
  type BackendAppRole
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  AdminAccessState,
  AdminHeader,
  mergeUniqueById
} from "@/components/admin/AdminExperienceShared";

const ROLE_LABELS: Record<BackendAppRole, string> = { STUDENT: "Student", STAFF: "Staff", ADMIN: "Admin" };

function initialsFor(value: string) {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
}

function roleChangeDescription(row: BackendAdminUser, nextRole: BackendAppRole, isSelf: boolean) {
  const name = row.fullName || row.email;
  const access = nextRole === "ADMIN"
    ? "full admin access, including Team Access, Audit Logs, and every staff tool"
    : nextRole === "STAFF"
      ? "staff operations tools such as inventory, reservations, receipts, and messages"
      : "the student portal only";
  const selfWarning = isSelf && nextRole !== "ADMIN" ? " This is your own account: you will lose admin access as soon as the change is saved." : "";
  return `${name} will move from ${ROLE_LABELS[row.role]} to ${ROLE_LABELS[nextRole]} and will have ${access}. The change is recorded in the audit log.${selfWarning}`;
}

export function AdminUsersExperience() {
  const { user, ready, openAuth } = useStudentAuth();
  const confirm = useConfirmationDialog();
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
        setError(userFacingErrorMessage(usersError, "Unable to load users."));
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
    const isSelf = row.id === user.id;
    const accepted = await confirm({
      title: `Change ${row.fullName || row.email}'s role to ${ROLE_LABELS[nextRole]}?`,
      description: roleChangeDescription(row, nextRole, isSelf),
      confirmLabel: "Change role",
      tone: nextRole === "ADMIN" || isSelf ? "warning" : row.role === "ADMIN" ? "danger" : "default"
    });
    if (!accepted) return;

    setSubmittingId(row.id);
    setError("");
    setNotice("");

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
      setError(userFacingErrorMessage(roleError, "Unable to update user role."));
    } finally {
      setSubmittingId("");
    }
  };

  if (!ready || !user || user.role !== "ADMIN") return accessState;

  const roleTabs: Array<{ value: string; label: string; count: number }> = [
    { value: "All", label: "All accounts", count: roleCounts.students + roleCounts.staff + roleCounts.admins },
    { value: "STUDENT", label: "Students", count: roleCounts.students },
    { value: "STAFF", label: "Staff", count: roleCounts.staff },
    { value: "ADMIN", label: "Admins", count: roleCounts.admins }
  ];

  return (
    <div className="space-y-5">
      <AdminHeader
        eyebrow="Team access"
        title="Account access management"
        detail="Review student, staff, and admin accounts with access to WESCOMM. Every role change asks for confirmation and is written to the audit log."
        action={(
          <Button variant="secondary" onClick={() => void loadUsers()} disabled={loading}>
            <RefreshCw className={loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} aria-hidden="true" /> Refresh
          </Button>
        )}
      />

      <div className="space-y-3 rounded-xl border bg-card p-2 shadow-soft">
        <div role="group" aria-label="Filter by role" className="flex gap-1 overflow-x-auto">
          {roleTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={role === tab.value}
              onClick={() => setRole(tab.value)}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-control px-3 text-sm font-bold transition-colors",
                role === tab.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {tab.label}
              <span className={cn(
                "rounded-full px-1.5 text-xs tabular-nums",
                role === tab.value ? "bg-white/20" : "bg-muted text-foreground"
              )}>{tab.count}</span>
            </button>
          ))}
        </div>
        <label className="relative flex h-11 items-center rounded-control border border-border-strong bg-white transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
          <span className="sr-only">Search accounts</span>
          <Search className="pointer-events-none ml-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, student number, or department"
            className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          {search ? (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="mr-1.5 grid size-8 place-items-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </label>
      </div>

      {notice ? <InlineAlert tone="success" onDismiss={() => setNotice("")}>{notice}</InlineAlert> : null}
      {error ? <InlineAlert onDismiss={() => setError("")}>{error}</InlineAlert> : null}

      <section aria-label="Accounts" aria-busy={loading || undefined} className="overflow-hidden rounded-xl border bg-card shadow-soft">
        <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_120px_190px] gap-4 border-b bg-surface-subtle px-5 py-3 text-xs font-bold uppercase tracking-wide text-muted-foreground lg:grid">
          <span>Account</span>
          <span>Contact</span>
          <span>Current role</span>
          <span>Change role</span>
        </div>
        {loading && !filteredUsers.length ? (
          <SkeletonList rows={5} label="Loading users" />
        ) : filteredUsers.length ? (
          <div className={cn("divide-y transition-opacity", loading && "opacity-60")}>
            {filteredUsers.map((row) => {
              const isSelf = row.id === user.id;
              const name = row.fullName || row.email;
              return (
                <article key={row.id} className="content-visibility-auto grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_120px_190px] lg:items-center lg:gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true" className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-full text-xs font-extrabold",
                      row.role === "ADMIN" ? "bg-accent/20 text-accent-foreground" : row.role === "STAFF" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    )}>
                      {initialsFor(name)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-extrabold text-foreground">
                        {name}
                        {isSelf ? <em className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold not-italic text-primary">You</em> : null}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.studentNumber || row.id}</p>
                    </div>
                  </div>
                  <div className="min-w-0 pl-[52px] lg:pl-0">
                    <p className="truncate text-sm font-semibold text-foreground">{row.email}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.department || "No department set"}</p>
                  </div>
                  <div className="pl-[52px] lg:pl-0">
                    <StatusBadge status={ROLE_LABELS[row.role]} />
                  </div>
                  <div className="flex items-center gap-2 pl-[52px] lg:pl-0">
                    <select
                      value={row.role}
                      disabled={submittingId === row.id}
                      aria-label={`Change role for ${name}`}
                      onChange={(event) => void updateRole(row, event.target.value as BackendAppRole)}
                      className="h-10 w-full max-w-44 cursor-pointer rounded-control border border-border-strong bg-white px-3 text-sm font-bold text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-wait disabled:opacity-60"
                    >
                      <option value="STUDENT">Student</option>
                      <option value="STAFF">Staff</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                    {submittingId === row.id ? <span className="text-xs font-semibold text-muted-foreground" role="status">Saving...</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <FeedbackState
            plain
            kind="empty"
            title="No matching users found"
            description={search || role !== "All" ? "Try a different search or role filter." : "Accounts appear here after their first sign-in."}
            action={search || role !== "All" ? <Button variant="secondary" size="sm" onClick={() => { setSearch(""); setRole("All"); }}>Clear filters</Button> : undefined}
          />
        )}
      </section>
      {nextCursor ? (
        <div className="flex justify-center">
          <Button variant="secondary" loading={loadingMore} onClick={() => void loadUsers({ cursor: nextCursor })}>
            {loadingMore ? "Loading more..." : "Load more users"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
