"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CalendarClock, CheckCircle2, PackagePlus, RefreshCw, ShoppingBag, UserSearch } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { SiteFooterLinks } from "@/components/layout/SiteFooterLinks";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { FeedbackState } from "@/components/ui/FeedbackState";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { MetricSkeletonGrid } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  getStaffDashboardSummaryFromApi,
  isRequestAbortError,
  type BackendDashboardProduct,
  type BackendReservation,
  type BackendReservationStatus,
  type BackendStaffDashboard
} from "@/lib/api";
import { getStoredStaffSession } from "@/lib/staff-api";
import { markWelcomeContentReady } from "@/lib/welcome-readiness";

const emptyDashboardData: BackendStaffDashboard = {
  products: [],
  reservations: [],
  receipts: [],
  metrics: {
    totalProducts: 0,
    itemsToRestock: 0,
    pendingReservations: 0,
    activeReservations: 0,
    receiptsToVerify: 0,
    openConversations: 0
  }
};

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

function stockStatus(product: BackendDashboardProduct) {
  if (product.status === "OUT_OF_STOCK" || product.stock <= 0) return "Out of Stock";
  if (product.status === "RESTOCK_SOON" || product.stock <= product.lowStockThreshold) return "Needs Restock";
  return "Available";
}

function stockPriority(product: BackendDashboardProduct) {
  const status = stockStatus(product);
  if (status === "Out of Stock") return 0;
  if (status === "Needs Restock") return 1;
  return 2;
}

function categoryName(product: BackendDashboardProduct) {
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
  const [data, setData] = useState<BackendStaffDashboard>(emptyDashboardData);
  const [loading, setLoading] = useState(true);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [error, setError] = useState("");
  const [hasSuccessfulLoad, setHasSuccessfulLoad] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [hasCredential, setHasCredential] = useState(false);
  const requestSequenceRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  const loadDashboard = useCallback(async ({ background = false, fresh = false }: { background?: boolean; fresh?: boolean } = {}) => {
    if (!ready) return;

    const requestId = ++requestSequenceRef.current;
    requestAbortRef.current?.abort();
    const requestController = new AbortController();
    requestAbortRef.current = requestController;

    const storedSession = getStoredStaffSession();
    const userCanUseStaffApi = user?.role === "STAFF" || user?.role === "ADMIN";
    const token = userCanUseStaffApi ? user.accessToken ?? "" : !user ? storedSession.token : "";
    setHasCredential(Boolean(token));

    if (!token) {
      requestController.abort();
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
      const nextData = await getStaffDashboardSummaryFromApi(token, requestController.signal, fresh);
      if (requestId !== requestSequenceRef.current) return;
      setData(nextData);
      setHasSuccessfulLoad(true);
      setLastUpdatedAt(new Date());
      setError("");
    } catch (dashboardError) {
      if (requestId === requestSequenceRef.current && !isRequestAbortError(dashboardError)) {
        setError(userFacingErrorMessage(dashboardError, "Unable to load the staff dashboard."));
      }
    } finally {
      if (requestId === requestSequenceRef.current && !background) {
        setLoading(false);
        setInitialLoadComplete(true);
        markWelcomeContentReady(window.location.pathname);
      }
    }
  }, [ready, user]);

  useRealtimeRefresh(["dashboard", "inventory", "reservations", "receipts", "conversations"], () => {
    void loadDashboard({ background: true });
  });

  useEffect(() => {
    void loadDashboard();
    return () => requestAbortRef.current?.abort();
  }, [loadDashboard]);

  useEffect(() => {
    if (!hasCredential) return;

    const refresh = () => {
      if (document.visibilityState === "visible") void loadDashboard({ background: true });
    };

    const interval = window.setInterval(refresh, 5 * 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [hasCredential, loadDashboard]);

  return {
    user,
    ready,
    openAuth,
    data,
    loading,
    initialLoadComplete,
    error,
    hasCredential,
    hasSuccessfulLoad,
    lastUpdatedAt,
    reload: () => loadDashboard({ fresh: true })
  };
}

function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="flex min-h-11 items-center justify-between px-4 text-sm font-bold text-primary transition-colors hover:bg-surface-subtle sm:px-5">
      {children}
      <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-success/10 text-success">
        <CheckCircle2 className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-muted-foreground">{children}</p>
    </div>
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
    return <MetricSkeletonGrid label="Loading live staff dashboard data." />;
  }

  if (user?.role === "STUDENT") {
    return <InlineAlert>This page is restricted to staff and admin accounts.</InlineAlert>;
  }

  if (!hasCredential) {
    return (
      <FeedbackState
        kind="empty"
        title="Staff sign in required"
        description="Use a staff or admin Wesleyan account to load live commissary data."
        action={<Button onClick={openAuth}>Sign in</Button>}
      />
    );
  }

  return null;
}

const quickActions = [
  { href: "/staff/walk-in-sales", label: "Record walk-in sale", icon: ShoppingBag },
  { href: "/staff/inventory", label: "Update stock", icon: PackagePlus },
  { href: "/staff/pickup-schedule", label: "Pickup schedule", icon: CalendarClock },
  { href: "/staff/students", label: "Look up a student", icon: UserSearch }
];

export function StaffDashboard() {
  const { user, ready, openAuth, data, loading, initialLoadComplete, error, hasCredential, hasSuccessfulLoad, lastUpdatedAt, reload } = useStaffDashboardData();
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

  const activeReservations = data.reservations;
  const receiptsToVerify = data.receipts;
  const totalProducts = data.metrics.totalProducts;
  const itemsToRestock = data.metrics.itemsToRestock;
  const staffName = user?.fullName?.split(" ")[0] || getStoredStaffSession().email || "Staff";
  const verified = !error && hasSuccessfulLoad;
  const allClear = verified
    && !itemsToRestock
    && !data.metrics.pendingReservations
    && !data.metrics.receiptsToVerify
    && !data.metrics.openConversations;

  if (!ready || !hasCredential || user?.role === "STUDENT") return accessState;

  const header = (
    <PageHeader
      eyebrow="Staff dashboard"
      title={`Welcome back, ${staffName}`}
      description={initialLoadComplete
        ? "Here is what needs attention in the commissary right now."
        : `Preparing live commissary data for ${staffName}.`}
      meta={initialLoadComplete ? (
        <span className="inline-flex items-center gap-2">
          <span className={verified ? "size-2 rounded-full bg-success" : "size-2 rounded-full bg-warning"} aria-hidden="true" />
          {lastUpdatedAt
            ? `Updated ${lastUpdatedAt.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}`
            : "Live data is not yet verified."}
        </span>
      ) : undefined}
      action={initialLoadComplete ? (
        <Button variant="secondary" onClick={() => void reload()} disabled={loading}>
          <RefreshCw className={loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} aria-hidden="true" />
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      ) : undefined}
    />
  );

  if (!initialLoadComplete) {
    return (
      <div className="space-y-6">
        {header}
        <MetricSkeletonGrid label="Loading live staff dashboard data." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {error ? (
        <InlineAlert action={<Button size="sm" variant="secondary" onClick={() => void reload()} disabled={loading}>Retry</Button>}>
          {error}
        </InlineAlert>
      ) : null}
      {!verified ? (
        <InlineAlert tone="warning" title="Unable to verify operations">
          Live operational data could not be loaded. Retry before acting on queue status.
        </InlineAlert>
      ) : allClear ? (
        <InlineAlert tone="success" title="Operations are clear">
          No urgent stock, reservation, receipt, or message alerts right now.
        </InlineAlert>
      ) : null}

      <section aria-labelledby="staff-priorities-heading" className="space-y-3">
        <h2 id="staff-priorities-heading" className="text-sm font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Needs attention</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <MetricCard
            label="Pending reservations"
            value={formatNumber(data.metrics.pendingReservations)}
            detail={data.metrics.pendingReservations ? "Awaiting staff review" : "Nothing waiting for review"}
            href="/staff/reservations"
            actionLabel="Review reservations"
            iconSrc="/assets/pending.svg"
            tone={data.metrics.pendingReservations ? "attention" : "default"}
          />
          <MetricCard
            label="Receipts to verify"
            value={formatNumber(data.metrics.receiptsToVerify)}
            detail={data.metrics.receiptsToVerify ? "Pending verification" : "Verification queue is empty"}
            href="/staff/receipt-verification"
            actionLabel="Verify receipts"
            iconSrc="/assets/scan-receipt.svg"
            tone={data.metrics.receiptsToVerify ? "attention" : "default"}
          />
          <MetricCard
            label="Items to restock"
            value={formatNumber(itemsToRestock)}
            detail="Reached the restock alert count"
            href="/staff/inventory?status=needs-restock"
            actionLabel="Open restock list"
            iconSrc="/assets/low-stock.svg"
            tone={itemsToRestock ? "critical" : "default"}
          />
          <MetricCard
            label="Open conversations"
            value={formatNumber(data.metrics.openConversations)}
            detail={data.metrics.openConversations ? "Need a reply or follow-up" : "No student is waiting"}
            href="/staff/messages"
            actionLabel="Open messages"
            iconSrc="/assets/messages.svg"
            tone={data.metrics.openConversations ? "attention" : "default"}
          />
        </div>
      </section>

      <nav aria-label="Quick actions" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {quickActions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="flex min-h-12 items-center gap-3 rounded-xl border bg-card px-3 py-2 text-sm sm:px-4 font-bold text-foreground shadow-soft transition hover:border-primary/40 hover:text-primary"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <action.icon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 leading-tight">{action.label}</span>
          </Link>
        ))}
      </nav>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Panel
          title="Reservation queue"
          description={`${formatNumber(data.metrics.activeReservations)} active reservation${data.metrics.activeReservations === 1 ? "" : "s"}`}
          icon={<AssetIcon src="/assets/reservations.svg" className="size-6" />}
          footer={<PanelLink href="/staff/reservations">Open reservation queue</PanelLink>}
        >
          {activeReservations.length ? (
            <ul className="divide-y">
              {activeReservations.slice(0, 5).map((row) => (
                <li key={row.id}>
                  <Link href={`/staff/reservations?reservationId=${encodeURIComponent(row.id)}`} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-subtle sm:px-5">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-foreground">{row.referenceCode}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{studentName(row)} · {formatDate(row.pickupStart ?? row.createdAt)}</p>
                    </div>
                    <StatusBadge status={reservationStatusLabel(row.status)} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyPanel>No active reservations are waiting in the queue.</EmptyPanel>
          )}
        </Panel>

        <Panel
          title="Receipt verification"
          description={`${formatNumber(data.metrics.receiptsToVerify)} receipt${data.metrics.receiptsToVerify === 1 ? "" : "s"} waiting`}
          icon={<AssetIcon src="/assets/receipts.svg" className="size-6" />}
          footer={<PanelLink href="/staff/receipt-verification">Open receipt verification</PanelLink>}
        >
          {receiptsToVerify.length ? (
            <ul className="divide-y">
              {receiptsToVerify.slice(0, 5).map((row) => (
                <li key={row.id}>
                  <Link href={`/staff/receipt-verification?receiptId=${encodeURIComponent(row.id)}`} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-subtle sm:px-5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">Receipt #{row.receiptCode}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{formatDateTime(row.issuedAt)}</p>
                    </div>
                    <p className="text-sm font-extrabold tabular-nums text-primary">{formatCurrency(row.totalAmount)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyPanel>No receipts are waiting for verification.</EmptyPanel>
          )}
        </Panel>

        <Panel
          title="Restock alerts"
          description={`${formatNumber(itemsToRestock)} item${itemsToRestock === 1 ? "" : "s"} need attention`}
          icon={<AssetIcon src="/assets/low-stock.svg" className="size-6" />}
          footer={<PanelLink href="/staff/inventory?status=needs-restock">Open restock list</PanelLink>}
        >
          {restockProducts.length ? (
            <ul className="divide-y">
              {restockProducts.slice(0, 5).map((row) => (
                <li key={row.id}>
                  <Link href={`/staff/inventory?productId=${encodeURIComponent(row.id)}`} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-subtle sm:px-5">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-foreground">{row.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-bold text-danger">{formatNumber(row.stock)} pcs left</span> · Alert at {formatNumber(row.lowStockThreshold)}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1"><StatusBadge status={stockStatus(row)} />{row.isOnSale ? <StatusBadge status="On Sale" /> : null}</div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyPanel>No products are currently marked for restock.</EmptyPanel>
          )}
        </Panel>
      </div>

      <Panel
        title="Inventory overview"
        description={`${formatNumber(totalProducts)} active product${totalProducts === 1 ? "" : "s"} · lowest stock first`}
        icon={<AssetIcon src="/assets/all-items.svg" className="size-6" />}
        action={(
          <Link href="/staff/inventory" className="inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline">
            Open inventory <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      >
        {inventoryRows.length ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-bold">Product</th>
                    <th scope="col" className="px-4 py-3 font-bold">Category</th>
                    <th scope="col" className="px-4 py-3 text-right font-bold">Current stock</th>
                    <th scope="col" className="px-4 py-3 text-right font-bold">Restock alert at</th>
                    <th scope="col" className="px-5 py-3 font-bold">Stock status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {inventoryRows.map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-surface-subtle">
                      <td className="px-5 py-3 font-semibold">
                        <Link href={`/staff/inventory?productId=${encodeURIComponent(row.id)}`} className="text-primary hover:underline">
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{categoryName(row)}</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">{formatNumber(row.stock)} <span className="font-normal text-muted-foreground">pcs</span></td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.lowStockThreshold)}</td>
                      <td className="px-5 py-3"><div className="flex flex-wrap gap-1"><StatusBadge status={stockStatus(row)} />{row.isOnSale ? <StatusBadge status="On Sale" /> : null}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y md:hidden">
              {inventoryRows.map((row) => (
                <li key={row.id}>
                  <Link href={`/staff/inventory?productId=${encodeURIComponent(row.id)}`} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-sm hover:bg-surface-subtle">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-foreground">{row.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{categoryName(row)} · {formatNumber(row.stock)} pcs · alert at {formatNumber(row.lowStockThreshold)}</p>
                    </div>
                    <StatusBadge status={stockStatus(row)} />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="px-5 py-8 text-center text-sm font-semibold text-muted-foreground">No active products are available yet.</div>
        )}
      </Panel>

      <footer className="flex flex-col items-center gap-4 border-t pt-6 text-center text-xs text-muted-foreground md:flex-row md:justify-between md:text-left">
        <div className="flex items-center justify-center gap-3 md:justify-start">
          <AssetIcon src="/assets/wescomm-logo-ui.webp" className="h-10 w-24" />
          <div>
            <p className="font-extrabold text-foreground">Wesleyan University-Philippines</p>
            <p>Integrated Commissary Management System</p>
          </div>
        </div>
        <SiteFooterLinks />
        <p className="md:text-right">© 2026 Wesleyan University-Philippines</p>
      </footer>
    </div>
  );
}
