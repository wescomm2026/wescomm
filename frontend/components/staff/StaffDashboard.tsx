"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, Megaphone, RefreshCw } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { SiteFooterLinks } from "@/components/layout/SiteFooterLinks";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  getConversationsFromApi,
  getReceiptsFromApi,
  getReservationsFromApi,
  getStaffReportSummaryFromApi,
  type BackendConversation,
  type BackendReceipt,
  type BackendReportSummary,
  type BackendReservation,
  type BackendReservationStatus
} from "@/lib/api";
import { getStaffProducts, getStoredStaffSession, type StaffProduct } from "@/lib/staff-api";
import { markWelcomeContentReady } from "@/lib/welcome-readiness";

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

type DashboardData = {
  products: StaffProduct[];
  reservations: BackendReservation[];
  receipts: BackendReceipt[];
  conversations: BackendConversation[];
  summary: BackendReportSummary;
};

const emptyDashboardData: DashboardData = {
  products: [],
  reservations: [],
  receipts: [],
  conversations: [],
  summary: emptySummary
};

const activeReservationStatuses: BackendReservationStatus[] = ["PENDING", "CONFIRMED", "READY_FOR_PICKUP"];

function toNumber(value: string | number | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-PH");
}

function formatCurrency(value: string | number | null | undefined) {
  return `PHP ${toNumber(value).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "No date set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date set";

  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila"
  });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "No date set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date set";

  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  });
}

function stockStatus(product: StaffProduct) {
  if (product.status === "OUT_OF_STOCK" || product.stock <= 0) return "Out of Stock";
  if (product.status === "ON_SALE") return "On Sale";
  if (product.status === "RESTOCK_SOON" || product.stock <= product.lowStockThreshold) return "Needs Restock";
  return "Available";
}

function stockPriority(product: StaffProduct) {
  const status = stockStatus(product);
  if (status === "Out of Stock") return 0;
  if (status === "Needs Restock") return 1;
  if (status === "On Sale") return 2;
  return 3;
}

function categoryName(product: StaffProduct) {
  return product.category?.name || "Uncategorized";
}

function reservationStatusLabel(status: BackendReservationStatus) {
  const labels: Record<BackendReservationStatus, string> = {
    PENDING: "Pending",
    CONFIRMED: "Confirmed",
    READY_FOR_PICKUP: "Ready for Pick-up",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    NO_SHOW: "No-show"
  };

  return labels[status];
}

function studentName(reservation: BackendReservation) {
  return reservation.student?.fullName || reservation.student?.email || "Student account";
}

function useStaffDashboardData() {
  const { user, ready, openAuth } = useStudentAuth();
  const [data, setData] = useState<DashboardData>(emptyDashboardData);
  const [loading, setLoading] = useState(true);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [error, setError] = useState("");
  const [hasCredential, setHasCredential] = useState(false);

  const loadDashboard = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!ready) return;

    const storedSession = getStoredStaffSession();
    const userCanUseStaffApi = user?.role === "STAFF" || user?.role === "ADMIN";
    const token = userCanUseStaffApi ? user.accessToken ?? "" : !user ? storedSession.token : "";
    setHasCredential(Boolean(token));

    if (!token) {
      setLoading(false);
      if (!background) {
        setInitialLoadComplete(true);
        markWelcomeContentReady(window.location.pathname);
      }
      return;
    }

    if (!background) {
      setLoading(true);
      setError("");
    }

    try {
      const [products, reservations, receipts, conversations, summary] = await Promise.all([
        getStaffProducts(token),
        getReservationsFromApi(token),
        getReceiptsFromApi(token),
        getConversationsFromApi(token),
        getStaffReportSummaryFromApi(token)
      ]);

      setData({ products, reservations, receipts, conversations, summary });
    } catch (dashboardError) {
      if (!background) {
        setError(dashboardError instanceof Error ? dashboardError.message : "Unable to load staff dashboard.");
      }
    } finally {
      if (!background) {
        setLoading(false);
        setInitialLoadComplete(true);
        markWelcomeContentReady(window.location.pathname);
      }
    }
  }, [ready, user]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!hasCredential) return;

    const refresh = () => {
      if (document.visibilityState === "visible") void loadDashboard({ background: true });
    };

    const interval = window.setInterval(refresh, 20000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [hasCredential, loadDashboard]);

  return { user, ready, openAuth, data, loading, initialLoadComplete, error, hasCredential, reload: loadDashboard };
}

function SectionHeader({
  title,
  iconSrc,
  href,
  action
}: {
  title: string;
  iconSrc: string;
  href: string;
  action: string;
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 border-b border-[#e5ebe6] px-4 sm:px-5">
      <AssetIcon src={iconSrc} className="size-7" />
      <h2 className="font-extrabold text-[#17211b]">{title}</h2>
      <Link href={href} className="ml-auto flex items-center gap-2 text-sm font-bold text-primary">
        {action}
        <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}

function DashboardStat({
  title,
  value,
  detail,
  href,
  action,
  iconSrc,
  warning = false
}: {
  title: string;
  value: string;
  detail: string;
  href: string;
  action: string;
  iconSrc: string;
  warning?: boolean;
}) {
  return (
    <article className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <span className={warning ? "grid size-16 shrink-0 place-items-center rounded-full bg-[#fff2d4]" : "grid size-16 shrink-0 place-items-center rounded-full bg-[#eaf4ea]"}>
          <AssetIcon src={iconSrc} className="size-11" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#26322b]">{title}</p>
          <p className={warning ? "mt-1 text-3xl font-extrabold text-[#f0a400]" : "mt-1 text-3xl font-extrabold text-primary"}>{value}</p>
          <p className="mt-1 text-xs leading-5 text-[#68746d]">{detail}</p>
          <Link href={href} className="mt-4 flex items-center gap-2 text-sm font-bold text-primary">
            {action}
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </article>
  );
}

function CollapsibleHeader({
  title,
  summary,
  iconSrc
}: {
  title: string;
  summary: string;
  iconSrc: string;
}) {
  return (
    <summary className="flex min-h-[72px] cursor-pointer list-none items-center gap-3 px-4 py-3 marker:content-none sm:px-5">
      <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#eef6ee]">
        <AssetIcon src={iconSrc} className="size-8" />
      </span>
      <span className="min-w-0">
        <span className="block font-extrabold text-[#17211b]">{title}</span>
        <span className="mt-0.5 block text-xs text-[#68746d]">{summary}</span>
      </span>
      <ChevronDown className="ml-auto size-5 shrink-0 text-primary transition-transform group-open:rotate-180" />
    </summary>
  );
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return <div className="p-5 text-sm font-semibold text-[#68746d]">{children}</div>;
}

function StaffDashboardLoading() {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-live="polite">
      <span className="sr-only">Loading live staff dashboard data.</span>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-lg border border-[#dce5dd] bg-white p-5 shadow-sm" aria-hidden="true">
          <div className="animate-pulse space-y-3 motion-reduce:animate-none">
            <div className="size-12 rounded-full bg-[#e7f0e7]" />
            <div className="h-3 w-28 rounded-full bg-[#e4ece4]" />
            <div className="h-8 w-20 rounded-md bg-[#d8e6d9]" />
            <div className="h-2.5 w-36 max-w-full rounded-full bg-[#edf3ed]" />
          </div>
        </div>
      ))}
    </section>
  );
}

function StaffAccessState({
  ready,
  loading,
  hasCredential,
  user,
  openAuth
}: {
  ready: boolean;
  loading: boolean;
  hasCredential: boolean;
  user: ReturnType<typeof useStudentAuth>["user"];
  openAuth: () => void;
}) {
  if (!ready || (loading && !hasCredential)) {
    return <StaffDashboardLoading />;
  }

  if (user?.role === "STUDENT") {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700">This page is restricted to staff and admin accounts.</div>;
  }

  if (!hasCredential) {
    return (
      <section className="rounded-lg border border-[#dce5dd] bg-white p-6 shadow-sm">
        <p className="font-extrabold text-[#17211b]">Staff sign in required</p>
        <p className="mt-2 text-sm text-[#68746d]">Use a staff or admin Wesleyan account to load live commissary data.</p>
        <Button className="mt-5" onClick={openAuth}>Sign in</Button>
      </section>
    );
  }

  return null;
}

export function StaffDashboard() {
  const { user, ready, openAuth, data, loading, initialLoadComplete, error, hasCredential, reload } = useStaffDashboardData();
  const accessState = (
    <StaffAccessState
      ready={ready}
      loading={loading}
      hasCredential={hasCredential}
      user={user}
      openAuth={openAuth}
    />
  );

  const restockProducts = useMemo(
    () =>
      data.products
        .filter((product) => stockStatus(product) === "Needs Restock" || stockStatus(product) === "Out of Stock")
        .sort((left, right) => (left.stock - left.lowStockThreshold) - (right.stock - right.lowStockThreshold)),
    [data.products]
  );

  const inventoryRows = useMemo(
    () =>
      [...data.products]
        .sort((left, right) => stockPriority(left) - stockPriority(right) || left.name.localeCompare(right.name))
        .slice(0, 5),
    [data.products]
  );

  const activeReservations = useMemo(
    () =>
      data.reservations
        .filter((reservation) => activeReservationStatuses.includes(reservation.status))
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [data.reservations]
  );

  const pendingReservations = useMemo(
    () => data.reservations.filter((reservation) => reservation.status === "PENDING"),
    [data.reservations]
  );

  const receiptsToVerify = useMemo(
    () =>
      data.receipts
        .filter((receipt) => receipt.status === "PENDING")
        .sort((left, right) => new Date(right.issuedAt).getTime() - new Date(left.issuedAt).getTime()),
    [data.receipts]
  );

  const openMessages = data.conversations.filter((conversation) => conversation.status === "OPEN");
  const totalProducts = data.summary.totalProducts || data.products.length;
  const itemsToRestock = data.summary.lowStockItems || restockProducts.length;
  const staffName = user?.fullName?.split(" ")[0] || getStoredStaffSession().email || "Staff";

  const operationalNotices = useMemo(() => {
    const notices: Array<{ title: string; detail: string; tone: "yellow" | "green" }> = [];

    if (itemsToRestock) {
      notices.push({
        title: "Restock attention needed",
        detail: `${formatNumber(itemsToRestock)} item${itemsToRestock === 1 ? "" : "s"} reached the restock alert count.`,
        tone: "yellow"
      });
    }

    if (pendingReservations.length) {
      notices.push({
        title: "Reservation queue active",
        detail: `${formatNumber(pendingReservations.length)} reservation${pendingReservations.length === 1 ? "" : "s"} awaiting staff review.`,
        tone: "green"
      });
    }

    if (receiptsToVerify.length) {
      notices.push({
        title: "Receipt verification queue",
        detail: `${formatNumber(receiptsToVerify.length)} receipt${receiptsToVerify.length === 1 ? "" : "s"} waiting for verification.`,
        tone: "green"
      });
    }

    if (openMessages.length) {
      notices.push({
        title: "Student support messages",
        detail: `${formatNumber(openMessages.length)} open conversation${openMessages.length === 1 ? "" : "s"} need a reply or follow-up.`,
        tone: "green"
      });
    }

    return notices.length
      ? notices.slice(0, 2)
      : [{ title: "Operations are clear", detail: "No urgent stock, reservation, receipt, or message alerts right now.", tone: "green" as const }];
  }, [itemsToRestock, openMessages.length, pendingReservations.length, receiptsToVerify.length]);

  if (!ready || !hasCredential || user?.role === "STUDENT") return accessState;

  if (!initialLoadComplete) {
    return (
      <div className="space-y-5">
        <header>
          <h1 className="text-3xl font-extrabold text-[#111a15] sm:text-4xl">Dashboard</h1>
          <p className="mt-2 text-sm text-[#606c64] sm:text-base">Preparing live commissary data for {staffName}.</p>
        </header>
        <StaffDashboardLoading />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-[#111a15] sm:text-4xl">Dashboard</h1>
          <p className="mt-2 text-sm text-[#606c64] sm:text-base">Welcome back, {staffName}. Live commissary data is shown below.</p>
        </div>
        <Button variant="secondary" onClick={() => void reload()} disabled={loading}>
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      </header>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      <section className="overflow-hidden rounded-lg border border-[#d8e4d9] bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-[#e5ebe6] bg-[#f3f8f3] px-4 py-3 sm:px-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-white text-primary shadow-sm">
            <Megaphone className="size-5" />
          </span>
          <div>
            <h2 className="font-extrabold text-[#17211b]">Operational Notices</h2>
            <p className="text-xs text-[#68746d]">Generated from live stock, reservation, receipt, and support data.</p>
          </div>
        </div>
        <div className="grid divide-y divide-[#e8ede9] md:grid-cols-2 md:divide-x md:divide-y-0">
          {operationalNotices.map((notice) => (
            <article key={notice.title} className="px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={notice.tone === "yellow" ? "size-2 rounded-full bg-[#f5b000]" : "size-2 rounded-full bg-primary"} />
                <h3 className="font-extrabold text-primary">{notice.title}</h3>
                <span className="text-xs text-[#69746e] md:ml-auto">Live now</span>
              </div>
              <p className="mt-2 pl-5 text-sm leading-6 text-[#56625a]">{notice.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardStat title="Total Products" value={formatNumber(totalProducts)} detail="Active products in inventory" href="/staff/inventory" action="View Inventory" iconSrc="/assets/all-items.svg" />
        <DashboardStat title="Items to Restock" value={formatNumber(itemsToRestock)} detail="Reached the restock alert count" href="/staff/inventory?status=needs-restock" action="Review Restock List" iconSrc="/assets/low-stock.svg" warning={itemsToRestock > 0} />
        <DashboardStat title="Pending Reservations" value={formatNumber(pendingReservations.length || data.summary.pendingReservations)} detail="Awaiting staff review" href="/staff/reservations" action="View Reservations" iconSrc="/assets/pending.svg" />
        <DashboardStat title="Receipts to Verify" value={formatNumber(receiptsToVerify.length || data.summary.receiptsToVerify)} detail="Pending verification" href="/staff/receipt-verification" action="Verify Receipts" iconSrc="/assets/scan-receipt.svg" />
      </section>

      <section className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
        <SectionHeader title="Inventory Overview" iconSrc="/assets/all-items.svg" href="/staff/inventory" action="Open Inventory" />
        {inventoryRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-[#f8faf8] text-xs text-[#59655d]">
                <tr>
                  <th className="px-4 py-3 font-bold">Product</th>
                  <th className="px-4 py-3 font-bold">Category</th>
                  <th className="px-4 py-3 font-bold">Current Stock</th>
                  <th className="px-4 py-3 font-bold">Restock Alert At</th>
                  <th className="px-4 py-3 font-bold">Stock Status</th>
                  <th className="px-4 py-3 font-bold">Unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede9]">
                {inventoryRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-semibold">{row.name}</td>
                    <td className="px-4 py-3 text-[#58645d]">{categoryName(row)}</td>
                    <td className="px-4 py-3">{formatNumber(row.stock)}</td>
                    <td className="px-4 py-3">{formatNumber(row.lowStockThreshold)}</td>
                    <td className="px-4 py-3"><StatusBadge status={stockStatus(row)} /></td>
                    <td className="px-4 py-3 text-[#58645d]">pcs</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel>No active products found in the database yet.</EmptyPanel>
        )}
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <details className="group overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
          <CollapsibleHeader title="Restock Alerts" summary={`${formatNumber(itemsToRestock)} item${itemsToRestock === 1 ? "" : "s"} need attention`} iconSrc="/assets/low-stock.svg" />
          <div className="border-t border-[#e5ebe6]">
            {restockProducts.length ? (
              <div className="divide-y divide-[#e8ede9]">
                {restockProducts.slice(0, 5).map((row) => (
                  <div key={row.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3 text-sm">
                    <p className="min-w-0 truncate font-semibold">{row.name}</p>
                    <p className="text-right text-xs font-bold text-red-600">
                      {formatNumber(row.stock)} pcs left
                      <span className="block text-[#8a6a20]">Alert at {formatNumber(row.lowStockThreshold)}</span>
                    </p>
                    <StatusBadge status={stockStatus(row)} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPanel>No products are currently marked for restock.</EmptyPanel>
            )}
            <Link href="/staff/inventory?status=needs-restock" className="flex min-h-12 items-center justify-between border-t border-[#e5ebe6] px-4 text-sm font-bold text-primary">
              Open restock list <ArrowRight className="size-4" />
            </Link>
          </div>
        </details>

        <details className="group overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
          <CollapsibleHeader title="Reservation Queue" summary={`${formatNumber(activeReservations.length)} active reservation${activeReservations.length === 1 ? "" : "s"}`} iconSrc="/assets/reservations.svg" />
          <div className="border-t border-[#e5ebe6]">
            {activeReservations.length ? (
              <div className="divide-y divide-[#e8ede9]">
                {activeReservations.slice(0, 5).map((row) => (
                  <div key={row.id} className="grid grid-cols-[1fr_auto] gap-2 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{row.referenceCode}</p>
                      <p className="mt-1 truncate text-xs text-[#4f5b54]">{studentName(row)} - {formatDate(row.pickupStart ?? row.createdAt)}</p>
                    </div>
                    <StatusBadge status={reservationStatusLabel(row.status)} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPanel>No active reservations are waiting in the queue.</EmptyPanel>
            )}
            <Link href="/staff/reservations" className="flex min-h-12 items-center justify-between border-t border-[#e5ebe6] px-4 text-sm font-bold text-primary">
              Open reservation queue <ArrowRight className="size-4" />
            </Link>
          </div>
        </details>

        <details className="group overflow-hidden rounded-lg border border-[#dce5dd] bg-white shadow-sm">
          <CollapsibleHeader title="Receipt Verification" summary={`${formatNumber(receiptsToVerify.length)} receipt${receiptsToVerify.length === 1 ? "" : "s"} waiting`} iconSrc="/assets/receipts.svg" />
          <div className="border-t border-[#e5ebe6]">
            {receiptsToVerify.length ? (
              <div className="divide-y divide-[#e8ede9]">
                {receiptsToVerify.slice(0, 5).map((row) => (
                  <div key={row.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3">
                    <AssetIcon src="/assets/digital-receipts.svg" className="size-8" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">Receipt #{row.receiptCode}</p>
                      <p className="truncate text-xs text-[#69746e]">{formatDateTime(row.issuedAt)}</p>
                    </div>
                    <p className="text-sm font-extrabold text-primary">{formatCurrency(row.totalAmount)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPanel>No receipts are waiting for verification.</EmptyPanel>
            )}
            <Link href="/staff/receipt-verification" className="flex min-h-12 items-center justify-between border-t border-[#e5ebe6] px-4 text-sm font-bold text-primary">
              Open receipt verification <ArrowRight className="size-4" />
            </Link>
          </div>
        </details>
      </div>

      <footer className="flex flex-col gap-4 border-t border-[#e2e8e3] py-6 text-xs text-[#68736c] md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <AssetIcon src="/assets/wescomm-logo.png" className="h-10 w-24" />
          <div>
            <p className="font-extrabold text-[#26322b]">Wesleyan University-Philippines</p>
            <p>Integrated Commissary Management System</p>
          </div>
        </div>
        <SiteFooterLinks />
        <p>(c) 2026 Wesleyan University-Philippines</p>
      </footer>
    </div>
  );
}
