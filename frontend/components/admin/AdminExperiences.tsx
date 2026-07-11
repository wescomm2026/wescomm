"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { ArrowRight, Download, RefreshCw, Search } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  getAdminAuditLogsFromApi,
  getAdminReportSummaryFromApi,
  getAdminUsersFromApi,
  updateAdminUserRoleFromApi,
  type BackendAuditLog,
  type BackendAdminUser,
  type BackendAppRole,
  type BackendReportSummary
} from "@/lib/api";

const emptySummary: BackendReportSummary = {
  totalSales: 0,
  totalReservations: 0,
  pendingReservations: 0,
  lowStockItems: 0,
  outOfStockItems: 0,
  totalProducts: 0,
  inventoryValue: 0,
  activeUsers: 0,
  roleCounts: { students: 0, staff: 0, admins: 0 },
  receiptsToVerify: 0,
  totalReceipts: 0,
  activeConversations: 0,
  salesTrend: [],
  categorySales: [],
  reservationStatusDistribution: [],
  inventoryInsights: []
};

const statusColors = ["#16803c", "#8cc665", "#f5b000", "#9aa3a8", "#00652f"];

function formatCurrency(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-PH");
}

function formatAuditDate(value: string) {
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

function formatAuditAction(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function useAdminSummary() {
  const { user, ready, openAuth } = useStudentAuth();
  const [summary, setSummary] = useState<BackendReportSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!ready) return;
    if (!user?.accessToken) {
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const data = await getAdminReportSummaryFromApi(user.accessToken);
      setSummary(data);
    } catch (summaryError) {
      if (!background) {
        setError(summaryError instanceof Error ? summaryError.message : "Unable to load admin summary.");
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, [ready, user?.accessToken]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!user?.accessToken) return;

    const refresh = () => {
      if (document.visibilityState === "visible") void loadSummary({ background: true });
    };

    const interval = window.setInterval(refresh, 20000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadSummary, user?.accessToken]);

  return { user, ready, openAuth, summary, loading, error, reload: loadSummary };
}

function AdminHeader({
  eyebrow,
  title,
  detail,
  action
}: {
  eyebrow: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-bold uppercase text-primary">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-extrabold text-[#101820]">{title}</h1>
        <p className="mt-2 text-sm text-[#68746d]">{detail}</p>
      </div>
      {action}
    </header>
  );
}

function AdminStatCard({
  title,
  value,
  detail,
  iconSrc,
  tone = "green",
  href
}: {
  title: string;
  value: string;
  detail: string;
  iconSrc: string;
  tone?: "green" | "yellow" | "red";
  href?: string;
}) {
  const iconTone = tone === "red" ? "bg-red-50" : tone === "yellow" ? "bg-[#fff4d8]" : "bg-[#eaf4ea]";
  const content = (
    <article className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm transition hover:border-primary">
      <div className="flex items-start gap-4">
        <span className={`grid size-14 shrink-0 place-items-center rounded-full ${iconTone}`}>
          <AssetIcon src={iconSrc} className="size-10" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#27332c]">{title}</p>
          <p className="mt-1 text-2xl font-extrabold text-primary">{value}</p>
          <p className="mt-1 text-xs text-[#68746d]">{detail}</p>
        </div>
      </div>
    </article>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
      <div className="flex min-h-14 items-center border-b border-[#e5ebe6] px-4">
        <h2 className="font-extrabold text-[#17211b]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function AdminAccessState({
  ready,
  user,
  openAuth
}: {
  ready: boolean;
  user: ReturnType<typeof useStudentAuth>["user"];
  openAuth: () => void;
}) {
  if (!ready) {
    return <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">Loading admin account...</div>;
  }

  if (!user) {
    return (
      <section className="rounded-lg border border-[#dce5dd] bg-white p-6 shadow-sm">
        <p className="font-extrabold text-[#17211b]">Admin sign in required</p>
        <p className="mt-2 text-sm text-[#68746d]">Use an admin Wesleyan account to continue.</p>
        <Button className="mt-5" onClick={openAuth}>Sign in</Button>
      </section>
    );
  }

  if (user.role !== "ADMIN") {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700">This page is restricted to admin accounts.</div>;
  }

  return null;
}

function SummaryCharts({ summary }: { summary: BackendReportSummary }) {
  const totalStatus = summary.reservationStatusDistribution.reduce((total, item) => total + item.value, 0);

  return (
    <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <ChartPanel title="Sales Trend">
        <div className="h-[310px] p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={summary.salesTrend} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e5ebe6" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(value) => `PHP ${Math.round(Number(value) / 1000)}K`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Line type="monotone" dataKey="sales" stroke="#08742f" strokeWidth={3} dot={{ r: 3, fill: "#08742f" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartPanel>

      <ChartPanel title="Reservation Status">
        <div className="grid min-h-[310px] items-center gap-3 p-4 sm:grid-cols-[1fr_1fr] xl:grid-cols-1 2xl:grid-cols-[1fr_1fr]">
          <div className="relative mx-auto h-52 w-full max-w-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={summary.reservationStatusDistribution} dataKey="value" nameKey="label" innerRadius={52} outerRadius={82} paddingAngle={1}>
                  {summary.reservationStatusDistribution.map((entry, index) => <Cell key={entry.status} fill={statusColors[index % statusColors.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="text-2xl font-extrabold text-primary">{totalStatus}</p>
                <p className="text-xs text-[#69746e]">Total</p>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {summary.reservationStatusDistribution.map((item, index) => (
              <div key={item.status} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: statusColors[index % statusColors.length] }} />
                <span className="text-[#536058]">{item.label}</span>
                <span className="font-bold">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </ChartPanel>
    </section>
  );
}

export function AdminDashboardExperience() {
  const { user, ready, openAuth, summary, loading, error, reload } = useAdminSummary();
  const accessState = <AdminAccessState ready={ready} user={user} openAuth={openAuth} />;
  if (!ready || !user || user.role !== "ADMIN") return accessState;

  return (
    <div className="space-y-5">
      <AdminHeader
        eyebrow="Admin dashboard"
        title="Commissary monitoring and decisions"
        detail="Track sales, users, stock risk, reservations, receipts, and support activity from live backend data."
        action={<Button variant="secondary" onClick={() => void reload()} disabled={loading}><RefreshCw className="size-4" /> Refresh</Button>}
      />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      {loading ? <div className="rounded-lg border border-[#dce5dd] bg-white p-6 text-sm font-semibold text-[#68746d] shadow-sm">Loading admin summary...</div> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard title="Total Sales" value={formatCurrency(summary.totalSales)} detail={`${formatNumber(summary.totalReceipts)} receipts recorded`} iconSrc="/assets/cash.svg" href="/admin/reports" />
        <AdminStatCard title="Inventory Value" value={formatCurrency(summary.inventoryValue)} detail={`${formatNumber(summary.totalProducts)} active products`} iconSrc="/assets/all-items.svg" href="/admin/inventory" />
        <AdminStatCard title="Items to Restock" value={formatNumber(summary.lowStockItems)} detail={`${formatNumber(summary.outOfStockItems)} unavailable`} iconSrc="/assets/low-stock.svg" tone={summary.lowStockItems ? "yellow" : "green"} href="/admin/inventory" />
        <AdminStatCard title="Active Users" value={formatNumber(summary.activeUsers)} detail={`${summary.roleCounts.students} students, ${summary.roleCounts.staff} staff`} iconSrc="/assets/my-profile.svg" href="/admin/users" />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard title="Reservations" value={formatNumber(summary.totalReservations)} detail={`${formatNumber(summary.pendingReservations)} pending review`} iconSrc="/assets/reservations.svg" href="/admin/reservations" />
        <AdminStatCard title="Receipts to Verify" value={formatNumber(summary.receiptsToVerify)} detail="Pending staff/admin verification" iconSrc="/assets/scan-receipt.svg" href="/admin/receipt-verification" />
        <AdminStatCard title="Open Messages" value={formatNumber(summary.activeConversations)} detail="Student support conversations" iconSrc="/assets/messages.svg" href="/admin/messages" />
        <AdminStatCard title="Admins" value={formatNumber(summary.roleCounts.admins)} detail="System decision makers" iconSrc="/assets/settings.svg" href="/admin/users" />
      </section>

      <SummaryCharts summary={summary} />

      <section className="grid gap-4 lg:grid-cols-3">
        {summary.inventoryInsights.map((insight) => (
          <article key={insight.insight} className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <AssetIcon src={insight.impact === "High" ? "/assets/low-stock.svg" : "/assets/in-stock.svg"} className="size-10" />
              <div>
                <p className="font-extrabold text-[#17211b]">{insight.insight}</p>
                <p className="mt-2 text-sm leading-6 text-[#68746d]">{insight.recommendation}</p>
                <span className="mt-3 inline-block"><StatusBadge status={insight.impact} /></span>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

export function AdminReportsExperience() {
  const { user, ready, openAuth, summary, loading, error, reload } = useAdminSummary();
  const accessState = <AdminAccessState ready={ready} user={user} openAuth={openAuth} />;
  if (!ready || !user || user.role !== "ADMIN") return accessState;

  const exportCsv = () => {
    const rows = [
      ["Metric", "Value"],
      ["Total Sales", formatCurrency(summary.totalSales)],
      ["Inventory Value", formatCurrency(summary.inventoryValue)],
      ["Total Reservations", String(summary.totalReservations)],
      ["Items to Restock", String(summary.lowStockItems)],
      ["Active Users", String(summary.activeUsers)],
      [],
      ["Category", "Sales"],
      ...summary.categorySales.map((item) => [item.category, formatCurrency(item.amount)])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "wescomm-admin-report.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <AdminHeader
        eyebrow="Reports"
        title="Sales, inventory value, and planning analytics"
        detail="Use live backend data for resource planning, budget decisions, and commissary monitoring."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void reload()} disabled={loading}><RefreshCw className="size-4" /> Refresh</Button>
            <Button onClick={exportCsv}><Download className="size-4" /> Export CSV</Button>
          </div>
        }
      />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard title="Total Sales" value={formatCurrency(summary.totalSales)} detail="From non-voided receipts" iconSrc="/assets/cash.svg" />
        <AdminStatCard title="Total Reservations" value={formatNumber(summary.totalReservations)} detail={`${summary.pendingReservations} pending`} iconSrc="/assets/reservations.svg" />
        <AdminStatCard title="Inventory Value" value={formatCurrency(summary.inventoryValue)} detail={`${summary.totalProducts} active products`} iconSrc="/assets/all-items.svg" />
        <AdminStatCard title="Items to Restock" value={formatNumber(summary.lowStockItems)} detail={`${summary.outOfStockItems} unavailable`} iconSrc="/assets/low-stock.svg" tone="yellow" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.95fr]">
        <ChartPanel title="Top Categories by Sales">
          <div className="h-[330px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.categorySales} layout="vertical" margin={{ top: 5, right: 70, left: 10, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="category" width={125} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="amount" fill="#16803c" radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartPanel>
        <SummaryCharts summary={summary} />
      </section>

      <section className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
        <div className="flex min-h-14 items-center border-b border-[#e5ebe6] px-4">
          <h2 className="font-extrabold text-[#17211b]">Inventory Insights</h2>
        </div>
        <div className="divide-y divide-[#edf1ed]">
          {summary.inventoryInsights.map((insight) => (
            <article key={insight.insight} className="grid gap-3 p-4 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <p className="font-bold text-[#17211b]">{insight.insight}</p>
              <StatusBadge status={insight.impact} />
              <p className="text-[#68746d]">{insight.recommendation}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function AdminUsersExperience() {
  const { user, ready, openAuth } = useStudentAuth();
  const [users, setUsers] = useState<BackendAdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("All");
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const accessState = <AdminAccessState ready={ready} user={user} openAuth={openAuth} />;

  const loadUsers = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!ready) return;
    if (!user?.accessToken || user.role !== "ADMIN") {
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const rows = await getAdminUsersFromApi(user.accessToken);
      setUsers(rows);
    } catch (usersError) {
      if (!background) setError(usersError instanceof Error ? usersError.message : "Unable to load users.");
    } finally {
      if (!background) setLoading(false);
    }
  }, [ready, user?.accessToken, user?.role]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const filteredUsers = useMemo(
    () =>
      users.filter((row) => {
        const text = `${row.fullName} ${row.email} ${row.studentNumber ?? ""} ${row.department ?? ""}`.toLowerCase();
        return text.includes(search.toLowerCase()) && (role === "All" || row.role === role);
      }),
    [role, search, users]
  );

  const updateRole = async (row: BackendAdminUser, nextRole: BackendAppRole) => {
    if (!user?.accessToken || row.role === nextRole) return;
    setSubmittingId(row.id);
    setError("");

    try {
      const updatedUser = await updateAdminUserRoleFromApi(user.accessToken, row.id, nextRole);
      setUsers((current) => current.map((item) => item.id === updatedUser.id ? updatedUser : item));
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
        <AdminStatCard title="Students" value={String(users.filter((row) => row.role === "STUDENT").length)} detail="Student portal accounts" iconSrc="/assets/my-profile.svg" />
        <AdminStatCard title="Staff" value={String(users.filter((row) => row.role === "STAFF").length)} detail="Operations accounts" iconSrc="/assets/settings.svg" />
        <AdminStatCard title="Admins" value={String(users.filter((row) => row.role === "ADMIN").length)} detail="Decision makers" iconSrc="/assets/verified.svg" />
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
          <article key={row.id} className="grid gap-3 border-b border-[#edf1ed] p-4 last:border-0 lg:grid-cols-[1.1fr_1.1fr_auto_auto] lg:items-center">
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
    </div>
  );
}

export function AdminAuditLogsExperience() {
  const { user, ready, openAuth } = useStudentAuth();
  const [logs, setLogs] = useState<BackendAuditLog[]>([]);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("All");
  const [entityType, setEntityType] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const accessState = <AdminAccessState ready={ready} user={user} openAuth={openAuth} />;

  const loadLogs = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!ready) return;
    if (!user?.accessToken || user.role !== "ADMIN") {
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const rows = await getAdminAuditLogsFromApi(user.accessToken, {
        action: action === "All" ? undefined : action,
        entityType: entityType === "All" ? undefined : entityType,
        limit: 150
      });
      setLogs(rows);
    } catch (auditError) {
      if (!background) setError(auditError instanceof Error ? auditError.message : "Unable to load audit logs.");
    } finally {
      if (!background) setLoading(false);
    }
  }, [action, entityType, ready, user?.accessToken, user?.role]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    if (!user?.accessToken || user.role !== "ADMIN") return;

    const refresh = () => {
      if (document.visibilityState === "visible") void loadLogs({ background: true });
    };

    const interval = window.setInterval(refresh, 20000);
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
  const filteredLogs = useMemo(
    () =>
      logs.filter((log) => {
        const actor = `${log.actor?.fullName ?? ""} ${log.actor?.email ?? ""}`;
        const text = `${log.summary} ${log.action} ${log.entityType} ${log.entityId ?? ""} ${actor}`.toLowerCase();
        return text.includes(search.toLowerCase());
      }),
    [logs, search]
  );

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
          <article key={log.id} className="grid gap-3 border-b border-[#edf1ed] p-4 last:border-0 xl:grid-cols-[220px_1fr_180px] xl:items-start">
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
    </div>
  );
}
