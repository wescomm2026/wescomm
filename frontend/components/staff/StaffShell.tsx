"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bell, BellOff, CheckCheck, ChevronDown, ChevronRight, LoaderCircle, LogOut, Menu, Search, Settings, ShieldCheck, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { ThemeSelector } from "@/components/theme/ThemeSelector";
import { useAccessibleDialog } from "@/components/ui/useAccessibleDialog";
import {
  getNotificationsFromApi,
  getStaffDashboardSummaryFromApi,
  getUnreadNotificationCountFromApi,
  markAllNotificationsReadFromApi,
  markNotificationReadFromApi,
  type BackendNotification,
  type BackendNotificationType
} from "@/lib/api";
import type { WorkspaceNavItem } from "@/lib/data";
import { clearStaffSession, storeStaffSession } from "@/lib/staff-api";
import { cn } from "@/lib/utils";

type NavItem = WorkspaceNavItem & { badge?: number; badgeLabel?: string };

type QueueCounts = {
  pendingReservations: number;
  receiptsToVerify: number;
  openConversations: number;
  itemsToRestock: number;
};

/** Maps a workspace page to the live queue count shown beside it in the sidebar. */
function queueBadgeFor(href: string, counts: QueueCounts | null) {
  if (!counts) return null;
  if (href.endsWith("/reservations")) return { badge: counts.pendingReservations, badgeLabel: "pending review" };
  if (href.endsWith("/receipt-verification")) return { badge: counts.receiptsToVerify, badgeLabel: "waiting for verification" };
  if (href.endsWith("/messages")) return { badge: counts.openConversations, badgeLabel: "open conversations" };
  if (href.endsWith("/inventory")) return { badge: counts.itemsToRestock, badgeLabel: "items to restock" };
  return null;
}

function isActiveItem(item: NavItem, pathname: string, homeHref: string) {
  return item.href === homeHref ? pathname === homeHref : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function groupNavItems(items: NavItem[]) {
  const groups: Array<{ name: NavItem["group"]; items: NavItem[] }> = [];
  items.forEach((item) => {
    const existing = groups.find((group) => group.name === item.group);
    if (existing) existing.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  });
  return groups;
}

function StaffNavigation({
  items,
  homeHref,
  onNavigate
}: {
  items: NavItem[];
  homeHref: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups = useMemo(() => groupNavItems(items), [items]);

  return (
    <nav aria-label="Workspace" className="grid gap-5">
      {groups.map((group) => (
        <div key={group.name}>
          {group.name !== "Overview" ? (
            <p className="mb-1.5 flex items-center gap-2 px-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
              {group.name}
              {group.items.some((item) => item.adminOnly) ? (
                <span className="rounded-full bg-accent/20 px-1.5 py-px text-[10px] tracking-normal text-accent-foreground">Admin</span>
              ) : null}
            </p>
          ) : null}
          <ul className="grid gap-0.5">
            {group.items.map((item) => {
              const active = isActiveItem(item, pathname, homeHref);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex min-h-10 items-center gap-3 rounded-control px-3 py-1.5 text-sm font-semibold transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-foreground/80 hover:bg-surface-subtle hover:text-foreground"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn("absolute inset-y-2 left-0 w-1 rounded-r-full transition-colors", active ? "bg-primary" : "bg-transparent")}
                    />
                    <AssetIcon src={item.iconSrc} className={cn("size-6 transition-opacity", !active && "opacity-80 group-hover:opacity-100")} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span className={cn(
                        "grid min-w-6 place-items-center rounded-full px-1.5 text-[11px] font-extrabold leading-5 tabular-nums",
                        item.href.endsWith("/inventory") ? "bg-accent/25 text-accent-foreground" : "bg-primary text-primary-foreground"
                      )}>
                        {item.badge > 99 ? "99+" : item.badge}
                        {item.badgeLabel ? <span className="sr-only"> {item.badgeLabel}</span> : null}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function WorkspaceIdentity({ role, portalTitle }: { role: "STAFF" | "ADMIN"; portalTitle: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-surface-subtle px-3 py-2.5">
      <span className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md",
        role === "ADMIN" ? "bg-accent/20 text-accent-foreground" : "bg-primary/10 text-primary"
      )}>
        <ShieldCheck className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-primary">{role === "ADMIN" ? "Admin workspace" : "Staff workspace"}</p>
        <p className="truncate text-xs font-semibold text-muted-foreground">{portalTitle}</p>
      </div>
    </div>
  );
}

function StaffSidebar({ items, homeHref, role, portalTitle }: { items: NavItem[]; homeHref: string; role: "STAFF" | "ADMIN"; portalTitle: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[var(--workspace-sidebar)] flex-col border-r bg-card lg:flex">
      <div className="flex h-[var(--workspace-header)] shrink-0 items-center border-b px-5">
        <Link href={homeHref} className="relative h-11 w-36" aria-label="WESCOMM home">
          <Image src="/assets/wescomm-logo-ui.webp" alt="WESCOMM" fill priority sizes="144px" className="object-contain object-left" />
        </Link>
      </div>
      <div className="px-4 pt-4">
        <WorkspaceIdentity role={role} portalTitle={portalTitle} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <StaffNavigation items={items} homeHref={homeHref} />
      </div>
      <p className="border-t px-5 py-3 text-[11px] leading-4 text-muted-foreground">
        Wesleyan University-Philippines
        <span className="block">Integrated Commissary Management</span>
      </p>
    </aside>
  );
}

function StaffMobileMenu({
  items,
  homeHref,
  role,
  portalLabel,
  portalTitle,
  open,
  onClose
}: {
  items: NavItem[];
  homeHref: string;
  role: "STAFF" | "ADMIN";
  portalLabel: string;
  portalTitle: string;
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useAccessibleDialog<HTMLElement>(open, onClose);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-foreground/45 backdrop-blur-[2px] lg:hidden" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside ref={dialog.dialogRef} {...dialog.dialogProps} className="flex h-[100svh] w-[min(86vw,340px)] flex-col bg-card shadow-overlay">
        <div className="flex h-16 shrink-0 items-center border-b px-4">
          <Image src="/assets/wescomm-logo-ui.webp" alt="WESCOMM" width={130} height={52} className="h-10 w-auto object-contain" />
          <button type="button" data-dialog-autofocus onClick={onClose} aria-label={`Close ${role === "ADMIN" ? "admin" : "staff"} menu`} className="ml-auto grid size-10 place-items-center rounded-control text-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>
        <div className="px-4 pt-4">
          <h2 id={dialog.titleId} className="sr-only">{portalLabel} navigation</h2>
          <WorkspaceIdentity role={role} portalTitle={portalTitle} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <StaffNavigation items={items} homeHref={homeHref} onNavigate={onClose} />
        </div>
      </aside>
    </div>,
    document.body
  );
}

function staffNotificationIcon(type: BackendNotificationType) {
  if (type === "RESERVATION") return "/assets/reservations.svg";
  if (type === "RECEIPT") return "/assets/receipts.svg";
  if (type === "PAYMENT") return "/assets/payment.svg";
  if (type === "LOW_STOCK") return "/assets/low-stock.svg";
  if (type === "MESSAGE") return "/assets/chat-with-wesbot.svg";
  return "/assets/notifications.svg";
}

function staffNotificationHref(notification: BackendNotification, routeBase: string, homeHref: string) {
  if (notification.actionUrl?.startsWith("/staff/") || notification.actionUrl?.startsWith("/admin/")) {
    return notification.actionUrl.replace(/^\/(staff|admin)/, routeBase);
  }
  const type = notification.type;
  if (type === "RESERVATION") return `${routeBase}/reservations`;
  if (type === "RECEIPT") return `${routeBase}/receipt-verification`;
  if (type === "PAYMENT") return `${routeBase}/reservations`;
  if (type === "LOW_STOCK") return `${routeBase}/inventory`;
  if (type === "MESSAGE") return `${routeBase}/messages`;
  return homeHref;
}

function formatStaffNotificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila"
  });
}

function WorkspaceGate({ eyebrow, title, detail, action, showLogo = false, busy = false }: {
  eyebrow: string;
  title: string;
  detail?: string;
  action?: ReactNode;
  showLogo?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-7 text-center shadow-soft" role="status" aria-busy={busy || undefined}>
        {showLogo ? (
          <Image src="/assets/wescomm-logo-ui.webp" alt="WESCOMM" width={155} height={64} className="mx-auto mb-5 h-14 w-auto object-contain" />
        ) : busy ? (
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
            <LoaderCircle className="size-6 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          </span>
        ) : null}
        <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-primary">{eyebrow}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-foreground">{title}</h1>
        {detail ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p> : null}
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </div>
  );
}

export function StaffShell({
  children,
  items,
  role = "STAFF",
  homeHref = "/staff",
  routeBase = "/staff",
  portalLabel = "Staff portal",
  portalTitle = "Commissary Operations"
}: {
  children: ReactNode;
  items: NavItem[];
  role?: "STAFF" | "ADMIN";
  homeHref?: string;
  routeBase?: string;
  portalLabel?: string;
  portalTitle?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<BackendNotification[]>([]);
  const [notificationOwnerId, setNotificationOwnerId] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const notificationRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const notificationRequestRef = useRef(0);
  const [queueCounts, setQueueCounts] = useState<QueueCounts | null>(null);
  const queueRequestRef = useRef(0);
  const queueRefreshTimerRef = useRef<number | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { user, ready, openAuth, logout } = useStudentAuth();
  const accountId = user?.id ?? "";
  const roleWord = role === "ADMIN" ? "admin" : "staff";
  const visibleNotifications = notificationOwnerId === accountId ? notifications : [];
  const displayName = user?.fullName || user?.email?.split("@")[0] || (role === "ADMIN" ? "Admin" : "Staff");
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || (role === "ADMIN" ? "AD" : "ST");
  const navItems = useMemo(
    () => items.map((item) => ({ ...item, ...queueBadgeFor(item.href, queueCounts) })),
    [items, queueCounts]
  );
  const activeItem = items.find((item) => isActiveItem(item, pathname, homeHref));

  const loadNotifications = useCallback(async () => {
    if (!user?.accessToken || user.role !== role || !accountId) return;
    const requestSequence = ++notificationRequestRef.current;
    setNotificationsLoading(true);
    setNotificationsError("");

    try {
      const result = await getNotificationsFromApi(user.accessToken, { limit: 20 });
      if (requestSequence !== notificationRequestRef.current) return;
      setNotifications(result.notifications);
      setNotificationOwnerId(accountId);
    } catch (notificationError) {
      if (requestSequence !== notificationRequestRef.current) return;
      setNotificationsError(userFacingErrorMessage(notificationError, "Unable to load notifications."));
    } finally {
      if (requestSequence === notificationRequestRef.current) setNotificationsLoading(false);
    }
  }, [accountId, role, user?.accessToken, user?.role]);

  const loadUnreadCount = useCallback(async () => {
    if (!user?.accessToken || user.role !== role || !accountId) return;
    try {
      const count = await getUnreadNotificationCountFromApi(user.accessToken);
      setUnreadCount(count);
    } catch {
      // Preserve the last known badge count until the next focus/reconnect refresh.
    }
  }, [accountId, role, user?.accessToken, user?.role]);

  const loadQueueCounts = useCallback(async () => {
    if (!user?.accessToken || user.role !== role) return;
    const requestSequence = ++queueRequestRef.current;
    try {
      const summary = await getStaffDashboardSummaryFromApi(user.accessToken);
      if (requestSequence !== queueRequestRef.current) return;
      const { pendingReservations, receiptsToVerify, openConversations, itemsToRestock } = summary.metrics;
      setQueueCounts({ pendingReservations, receiptsToVerify, openConversations, itemsToRestock });
    } catch {
      // Badges are a convenience; keep the last known counts until the next refresh.
    }
  }, [role, user?.accessToken, user?.role]);

  useRealtimeRefresh(["dashboard", "inventory", "reservations", "receipts", "conversations"], () => {
    // Coalesce bursts of realtime events into one cached summary request.
    if (queueRefreshTimerRef.current !== null) window.clearTimeout(queueRefreshTimerRef.current);
    queueRefreshTimerRef.current = window.setTimeout(() => {
      queueRefreshTimerRef.current = null;
      void loadQueueCounts();
    }, 1500);
  });

  useEffect(() => {
    setQueueCounts(null);
    if (!user?.accessToken || user.role !== role) return;
    void loadQueueCounts();
    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") void loadQueueCounts();
    };
    const timer = window.setInterval(refreshWhenActive, 5 * 60_000);
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    return () => {
      queueRequestRef.current += 1;
      window.clearInterval(timer);
      if (queueRefreshTimerRef.current !== null) window.clearTimeout(queueRefreshTimerRef.current);
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
    };
  }, [loadQueueCounts, role, user?.accessToken, user?.role]);

  useRealtimeRefresh(["notifications"], () => {
    void loadUnreadCount();
    if (notificationsOpen) void loadNotifications();
  });

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!notificationRef.current?.contains(target)) setNotificationsOpen(false);
      if (!profileRef.current?.contains(target)) setProfileOpen(false);
    };
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
        setProfileOpen(false);
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, [contenteditable='true']");
      const shortcut = (event.key === "/" && !typing) || (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey));
      if (!shortcut || document.querySelector("[aria-modal='true']")) return;
      const input = searchInputRef.current;
      if (input && input.offsetParent !== null) {
        event.preventDefault();
        input.focus();
        input.select();
      } else {
        event.preventDefault();
        setMobileSearchOpen(true);
      }
    };
    document.addEventListener("mousedown", closeMenus);
    document.addEventListener("keydown", handleKeys);
    return () => {
      document.removeEventListener("mousedown", closeMenus);
      document.removeEventListener("keydown", handleKeys);
    };
  }, []);

  useEffect(() => {
    if (mobileSearchOpen) mobileSearchInputRef.current?.focus();
  }, [mobileSearchOpen]);

  useEffect(() => {
    if (!ready) return;

    if (!user) {
      openAuth();
      return;
    }

    if (user.role === "STUDENT") {
      router.replace("/student/dashboard");
      return;
    }

    if (role === "STAFF" && user.role === "ADMIN") {
      router.replace("/admin/dashboard");
      return;
    }

    if (role === "ADMIN" && user.role === "STAFF") {
      router.replace("/staff");
      return;
    }

    if (user.role !== role) return;

    if (user.accessToken) {
      storeStaffSession(user.accessToken, user.email);
    }
  }, [openAuth, ready, role, router, user]);

  useEffect(() => {
    setNotificationsOpen(false);
    setNotifications([]);
    setUnreadCount(0);
    setNotificationOwnerId(accountId);
    if (!user?.accessToken || user.role !== role) {
      setNotifications([]);
      setNotificationsError("");
      return;
    }

    void loadUnreadCount();
    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") void loadUnreadCount();
    };
    const timer = window.setInterval(refreshWhenActive, 5 * 60_000);
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    return () => {
      notificationRequestRef.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
    };
  }, [accountId, loadUnreadCount, role, user?.accessToken, user?.role]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const query = search.trim();
    if (!query) return;
    setMobileSearchOpen(false);
    router.push(`${routeBase}/search?query=${encodeURIComponent(query)}`);
  };

  const signOut = async () => {
    const signedOut = await logout();
    if (!signedOut) return;
    clearStaffSession();
    router.push("/");
  };

  const markNotificationRead = async (notification: BackendNotification) => {
    if (!user?.accessToken || notification.readAt) return;

    setNotifications((current) =>
      current.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item)
    );
    setUnreadCount((current) => Math.max(0, current - 1));

    try {
      await markNotificationReadFromApi(user.accessToken, notification.id);
    } catch {
      void loadNotifications();
      void loadUnreadCount();
    }
  };

  const markAllNotificationsRead = async () => {
    if (!user?.accessToken) return;

    setNotifications((current) =>
      current.map((notification) => ({ ...notification, readAt: notification.readAt ?? new Date().toISOString() }))
    );
    setUnreadCount(0);

    try {
      await markAllNotificationsReadFromApi(user.accessToken);
      void loadUnreadCount();
    } catch (notificationError) {
      setNotificationsError(userFacingErrorMessage(notificationError, "Unable to update notifications."));
      void loadNotifications();
      void loadUnreadCount();
    }
  };

  if (!ready) {
    return <WorkspaceGate eyebrow={portalLabel} title="Loading account..." busy />;
  }

  if (!user) {
    return (
      <WorkspaceGate
        showLogo
        eyebrow={portalLabel}
        title="Sign in with your WESCOMM account"
        detail="Use the main login once. Staff accounts will open the staff dashboard automatically."
        action={<Button size="lg" onClick={openAuth}>Sign in</Button>}
      />
    );
  }

  if (user.role !== role) {
    return <WorkspaceGate eyebrow="Redirecting" title="Opening your assigned dashboard..." busy />;
  }

  const searchField = (inputRef: typeof searchInputRef, className?: string, showShortcut = false) => (
    <form onSubmit={submitSearch} role="search" className={cn("relative flex h-10 items-center rounded-control border border-border-strong bg-white transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15", className)}>
      <Search className="pointer-events-none ml-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search products, reservations, receipts..."
        aria-label="Search the workspace"
        className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none focus-visible:outline-none placeholder:text-muted-foreground"
      />
      {showShortcut && !search ? (
        <kbd className="mr-2 hidden rounded border bg-surface-subtle px-1.5 py-0.5 font-sans text-[11px] font-bold text-muted-foreground xl:inline-block" aria-hidden="true">/</kbd>
      ) : null}
    </form>
  );

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#workspace-main"
        className="sr-only z-[200] rounded-control bg-primary px-4 py-2 text-sm font-bold text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <StaffSidebar items={navItems} homeHref={homeHref} role={role} portalTitle={portalTitle} />
      <StaffMobileMenu
        items={navItems}
        homeHref={homeHref}
        role={role}
        portalLabel={portalLabel}
        portalTitle={portalTitle}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />

      <div className="lg:pl-[var(--workspace-sidebar)]">
        <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
          <div className="mx-auto flex h-[var(--workspace-header)] max-w-[1580px] items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label={`Open ${roleWord} menu`}
              className="grid size-10 shrink-0 place-items-center rounded-control text-primary hover:bg-muted lg:hidden"
            >
              <Menu className="size-6" />
            </button>
            <Link href={homeHref} className="relative h-10 w-[120px] shrink-0 sm:w-[136px] lg:hidden" aria-label="WESCOMM home">
              <Image src="/assets/wescomm-logo-ui.webp" alt="WESCOMM" fill priority sizes="136px" className="object-contain object-left" />
            </Link>

            {activeItem ? (
              <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm lg:flex">
                <span className="truncate font-semibold text-muted-foreground">{activeItem.group === "Overview" ? (role === "ADMIN" ? "Admin" : "Staff") : activeItem.group}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate font-extrabold text-foreground" aria-current="page">{activeItem.label}</span>
              </nav>
            ) : null}

            {searchField(searchInputRef, "ml-auto hidden w-full max-w-sm md:flex", true)}

            <button
              type="button"
              onClick={() => setMobileSearchOpen((current) => !current)}
              aria-label={mobileSearchOpen ? "Close search" : "Open search"}
              aria-expanded={mobileSearchOpen}
              className="ml-auto grid size-10 shrink-0 place-items-center rounded-control text-primary hover:bg-muted md:hidden"
            >
              {mobileSearchOpen ? <X className="size-5" /> : <Search className="size-5" />}
            </button>

            <div ref={notificationRef} className="relative shrink-0">
              <button
                type="button"
                aria-label={`${role === "ADMIN" ? "Admin" : "Staff"} notifications, ${unreadCount} unread`}
                aria-expanded={notificationsOpen}
                aria-haspopup="dialog"
                onClick={() => {
                  setNotificationsOpen((current) => !current);
                  setProfileOpen(false);
                  if (!notificationsOpen) void loadNotifications();
                }}
                className={cn("relative grid size-10 place-items-center rounded-control text-primary hover:bg-muted", notificationsOpen && "bg-muted")}
              >
                <Bell className="size-5" />
                {unreadCount ? <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full border-2 border-card bg-accent px-1 text-[10px] font-extrabold leading-4 text-foreground">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
              </button>
              {notificationsOpen ? (
                <section aria-label="Notifications" className="fixed inset-x-3 top-[calc(var(--workspace-header)+0.5rem)] z-50 overflow-hidden rounded-xl border bg-card shadow-overlay sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-[380px]">
                  <div className="flex items-center gap-3 border-b px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-extrabold text-foreground">Notifications</p>
                      <p className="text-xs text-muted-foreground">{unreadCount ? `${unreadCount} update${unreadCount > 1 ? "s" : ""} need attention` : "You're all caught up"}</p>
                    </div>
                    {unreadCount ? (
                      <button type="button" onClick={() => void markAllNotificationsRead()} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-xs font-bold text-primary hover:bg-muted">
                        <CheckCheck className="size-4" /> Mark all read
                      </button>
                    ) : null}
                  </div>
                  <div className="max-h-[min(440px,calc(100svh-170px))] overflow-y-auto">
                    {notificationsLoading && !visibleNotifications.length ? (
                      <div className="flex items-center gap-2 px-4 py-6 text-sm font-semibold text-muted-foreground" role="status">
                        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading notifications...
                      </div>
                    ) : notificationsError ? (
                      <p className="px-4 py-6 text-sm font-semibold text-danger" role="alert">{notificationsError}</p>
                    ) : visibleNotifications.length ? (
                      <ul className="divide-y">
                        {visibleNotifications.map((notification) => (
                          <li key={notification.id}>
                            <Link
                              href={staffNotificationHref(notification, routeBase, homeHref)}
                              onClick={() => {
                                void markNotificationRead(notification);
                                setNotificationsOpen(false);
                              }}
                              className={cn(
                                "grid grid-cols-[36px_1fr_auto] gap-3 px-4 py-3 transition-colors hover:bg-surface-subtle",
                                !notification.readAt && "bg-primary/5"
                              )}
                            >
                              <AssetIcon src={staffNotificationIcon(notification.type)} className="size-8" />
                              <span className="min-w-0">
                                <span className="block text-sm font-bold text-foreground">{notification.title}</span>
                                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{notification.message}</span>
                                <span className="mt-1 block text-[11px] font-semibold text-muted-foreground">{formatStaffNotificationTime(notification.createdAt)}</span>
                              </span>
                              {!notification.readAt ? <span className="mt-1.5 size-2 rounded-full bg-primary" aria-label="Unread" /> : null}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="px-4 py-8 text-center">
                        <BellOff className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
                        <p className="mt-2 text-sm font-semibold text-muted-foreground">No notifications yet.</p>
                      </div>
                    )}
                  </div>
                </section>
              ) : null}
            </div>

            <ThemeSelector />

            <div ref={profileRef} className="relative shrink-0">
              <button
                type="button"
                aria-expanded={profileOpen}
                aria-haspopup="menu"
                aria-label={`${displayName} account menu`}
                onClick={() => {
                  setProfileOpen((current) => !current);
                  setNotificationsOpen(false);
                }}
                className={cn("flex items-center gap-2 rounded-control p-1 text-left hover:bg-muted sm:pr-2", profileOpen && "bg-muted")}
              >
                <span className="grid size-9 place-items-center rounded-full bg-primary text-xs font-extrabold text-primary-foreground">{initials}</span>
                <span className="hidden max-w-36 sm:block">
                  <span className="block truncate text-sm font-extrabold leading-5 text-foreground">{displayName}</span>
                  <span className="block text-xs leading-4 text-muted-foreground">{role === "ADMIN" ? "Admin" : "Staff"}</span>
                </span>
                <ChevronDown className={cn("hidden size-4 text-muted-foreground transition-transform sm:block", profileOpen && "rotate-180")} />
              </button>
              {profileOpen ? (
                <div className="fixed inset-x-3 top-[calc(var(--workspace-header)+0.5rem)] z-50 overflow-hidden rounded-xl border bg-card p-1.5 shadow-overlay sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-64">
                  <div className="border-b px-3 py-3">
                    <p className="truncate text-sm font-extrabold text-foreground">{displayName}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</p>
                    <span className={cn(
                      "mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase",
                      role === "ADMIN" ? "bg-accent/20 text-accent-foreground" : "bg-primary/10 text-primary"
                    )}>{role === "ADMIN" ? "Admin account" : "Staff account"}</span>
                  </div>
                  <Link href={`${routeBase}/settings`} onClick={() => setProfileOpen(false)} className="mt-1 flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-semibold text-foreground hover:bg-muted">
                    <Settings className="size-4 text-primary" /> Account settings
                  </Link>
                  <button
                    type="button"
                    onClick={signOut}
                    className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-sm font-semibold text-danger hover:bg-danger/5"
                  >
                    <LogOut className="size-4" /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          {mobileSearchOpen ? (
            <div className="border-t px-3 py-2 md:hidden">
              {searchField(mobileSearchInputRef, "w-full")}
            </div>
          ) : null}
        </header>

        <main id="workspace-main" tabIndex={-1} className="mx-auto min-h-[calc(100vh-var(--workspace-header))] w-full max-w-[1580px] px-3 py-5 outline-none sm:px-6 sm:py-6 lg:px-8 lg:py-7">
          {children}
        </main>
      </div>
    </div>
  );
}
