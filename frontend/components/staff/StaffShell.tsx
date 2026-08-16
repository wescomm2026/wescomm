"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bell, Check, ChevronDown, LogOut, Menu, Search, Settings, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import {
  getNotificationsFromApi,
  markAllNotificationsReadFromApi,
  markNotificationReadFromApi,
  type BackendNotification,
  type BackendNotificationType
} from "@/lib/api";
import { clearStaffSession, storeStaffSession } from "@/lib/staff-api";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  iconSrc: string;
  badge?: number;
};

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

  return (
    <nav className="grid gap-1.5">
      {items.map((item) => {
        const active = item.href === homeHref ? pathname === homeHref : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex min-h-12 items-center gap-3 rounded-md px-3 text-sm font-semibold transition",
              active ? "bg-[#eaf3e9] text-primary" : "text-[#27332c] hover:bg-[#f3f7f3]"
            )}
          >
            <AssetIcon src={item.iconSrc} className="size-7" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.badge ? (
              <span className="grid min-w-6 place-items-center rounded-full bg-[#dcebdc] px-1.5 text-xs font-extrabold leading-6 text-primary">
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function StaffSidebar({ items, homeHref }: { items: NavItem[]; homeHref: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[230px] flex-col border-r border-[#e3e9e4] bg-white px-4 pb-5 pt-5 lg:flex">
      <Link href={homeHref} className="relative mx-2 h-[72px]">
        <Image src="/assets/wescomm-logo.png" alt="WESCOMM" fill priority className="object-contain object-left" />
      </Link>
      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        <StaffNavigation items={items} homeHref={homeHref} />
      </div>
    </aside>
  );
}

function StaffMobileMenu({
  items,
  homeHref,
  portalLabel,
  portalTitle,
  open,
  onClose
}: {
  items: NavItem[];
  homeHref: string;
  portalLabel: string;
  portalTitle: string;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-[#101820]/45 lg:hidden" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="flex h-[100svh] w-[min(88vw,360px)] flex-col bg-white shadow-[20px_0_60px_rgba(0,0,0,0.2)]">
        <div className="flex h-20 shrink-0 items-center border-b border-[#e5ebe6] px-5">
          <Image src="/assets/wescomm-logo.png" alt="WESCOMM" width={145} height={58} className="h-12 w-auto object-contain" />
          <button type="button" onClick={onClose} aria-label="Close staff menu" className="ml-auto grid size-10 place-items-center rounded-md hover:bg-[#eef6ee]">
            <X className="size-6" />
          </button>
        </div>
        <div className="border-b border-[#edf1ed] px-5 py-4">
          <p className="text-xs font-bold uppercase text-primary">{portalLabel}</p>
          <p className="mt-1 font-extrabold text-[#17211b]">{portalTitle}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
  if (type === "MESSAGE") return "/assets/wesbot-chat.svg";
  return "/assets/notifications.svg";
}

function staffNotificationHref(type: BackendNotificationType, routeBase: string, homeHref: string) {
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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<BackendNotification[]>([]);
  const [notificationOwnerId, setNotificationOwnerId] = useState("");
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const notificationRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationRequestRef = useRef(0);
  const router = useRouter();
  const { user, ready, openAuth, logout } = useStudentAuth();
  const accountId = user?.id ?? "";
  const visibleNotifications = notificationOwnerId === accountId ? notifications : [];
  const unreadCount = visibleNotifications.filter((notification) => !notification.readAt).length;
  const displayName = user?.fullName || user?.email?.split("@")[0] || (role === "ADMIN" ? "Admin" : "Staff");
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || (role === "ADMIN" ? "AD" : "ST");

  const loadNotifications = useCallback(async () => {
    if (!user?.accessToken || user.role !== role || !accountId) return;
    const requestSequence = ++notificationRequestRef.current;
    setNotificationsLoading(true);
    setNotificationsError("");

    try {
      const rows = await getNotificationsFromApi(user.accessToken);
      if (requestSequence !== notificationRequestRef.current) return;
      setNotifications(rows);
      setNotificationOwnerId(accountId);
    } catch (notificationError) {
      if (requestSequence !== notificationRequestRef.current) return;
      setNotificationsError(notificationError instanceof Error ? notificationError.message : "Unable to load notifications.");
    } finally {
      if (requestSequence === notificationRequestRef.current) setNotificationsLoading(false);
    }
  }, [accountId, role, user?.accessToken, user?.role]);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!notificationRef.current?.contains(target)) setNotificationsOpen(false);
      if (!profileRef.current?.contains(target)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

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
    setNotificationOwnerId(accountId);
    if (!user?.accessToken || user.role !== role) {
      setNotifications([]);
      setNotificationsError("");
      return;
    }

    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 15000);
    return () => {
      notificationRequestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [accountId, loadNotifications, role, user?.accessToken, user?.role]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const query = search.trim();
    if (!query) return;
    router.push(`${routeBase}/inventory?query=${encodeURIComponent(query)}`);
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

    try {
      await markNotificationReadFromApi(user.accessToken, notification.id);
    } catch {
      void loadNotifications();
    }
  };

  const markAllNotificationsRead = async () => {
    if (!user?.accessToken) return;

    setNotifications((current) =>
      current.map((notification) => ({ ...notification, readAt: notification.readAt ?? new Date().toISOString() }))
    );

    try {
      await markAllNotificationsReadFromApi(user.accessToken);
      void loadNotifications();
    } catch (notificationError) {
      setNotificationsError(notificationError instanceof Error ? notificationError.message : "Unable to update notifications.");
    }
  };

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#fbfcfb] px-4">
        <div className="w-full max-w-md rounded-lg border border-[#dce5dd] bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-bold uppercase text-primary">Staff portal</p>
          <h1 className="mt-2 text-2xl font-extrabold text-[#101820]">Loading account...</h1>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#fbfcfb] px-4">
        <div className="w-full max-w-md rounded-lg border border-[#dce5dd] bg-white p-6 text-center shadow-sm">
          <Image src="/assets/wescomm-logo.png" alt="WESCOMM" width={155} height={64} className="mx-auto h-14 w-auto object-contain" />
          <p className="mt-5 text-sm font-bold uppercase text-primary">Staff portal</p>
          <h1 className="mt-2 text-2xl font-extrabold text-[#101820]">Sign in with your WESCOMM account</h1>
          <p className="mt-2 text-sm leading-6 text-[#68746d]">Use the main login once. Staff accounts will open the staff dashboard automatically.</p>
          <button type="button" onClick={openAuth} className="mt-5 h-11 rounded-md bg-primary px-5 text-sm font-bold text-white shadow-lg shadow-primary/20">
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (user.role !== role) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#fbfcfb] px-4">
        <div className="w-full max-w-md rounded-lg border border-[#dce5dd] bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-bold uppercase text-primary">Redirecting</p>
          <h1 className="mt-2 text-2xl font-extrabold text-[#101820]">Opening your assigned dashboard...</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fbfcfb]">
      <StaffSidebar items={items} homeHref={homeHref} />
      <StaffMobileMenu
        items={items}
        homeHref={homeHref}
        portalLabel={portalLabel}
        portalTitle={portalTitle}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />

      <div className="lg:pl-[230px]">
        <header className="sticky top-0 z-30 border-b border-[#e3e9e4] bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-[78px] max-w-[1580px] items-center gap-3 px-3 sm:px-6 lg:h-[90px] lg:px-8">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open staff menu"
              className="grid size-11 shrink-0 place-items-center rounded-md text-primary hover:bg-[#eef6ee] lg:hidden"
            >
              <Menu className="size-7" />
            </button>
            <Link href={homeHref} className="relative h-12 w-[150px] shrink-0 lg:hidden">
              <Image src="/assets/wescomm-logo.png" alt="WESCOMM" fill priority className="object-contain object-left" />
            </Link>

            <form onSubmit={submitSearch} className="ml-auto hidden h-12 w-full max-w-[390px] items-center rounded-md border border-[#d7e0d8] bg-white px-4 focus-within:border-primary md:flex">
              <Search className="mr-3 size-5 text-[#68746d]" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search products, reservations, receipts..."
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#8a938d]"
              />
            </form>

            <div ref={notificationRef} className="relative ml-auto shrink-0 md:ml-0">
              <button
                type="button"
                aria-label={`Staff notifications, ${unreadCount} unread`}
                aria-expanded={notificationsOpen}
                onClick={() => {
                  setNotificationsOpen((current) => !current);
                  setProfileOpen(false);
                  if (!notificationsOpen) void loadNotifications();
                }}
                className="relative grid size-11 place-items-center rounded-md hover:bg-[#eef6ee]"
              >
                <Bell className="size-6 text-primary" />
                {unreadCount ? <span className="absolute right-0 top-0 grid min-w-5 place-items-center rounded-full border-2 border-white bg-[#f5ad00] px-1 text-[10px] font-extrabold leading-4 text-white">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
              </button>
              {notificationsOpen ? (
                <section className="fixed inset-x-3 top-[72px] z-50 overflow-hidden rounded-lg border border-[#dbe5dc] bg-white shadow-[0_18px_55px_rgba(17,40,25,0.2)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+10px)] sm:w-[360px]">
                  <div className="flex items-center border-b border-[#e7eee8] px-4 py-3">
                    <div>
                      <p className="font-extrabold text-[#17211b]">Notifications</p>
                      <p className="text-xs text-[#68746d]">{unreadCount ? `${unreadCount} update${unreadCount > 1 ? "s" : ""} need attention` : "No unread updates"}</p>
                    </div>
                    {unreadCount ? (
                      <button type="button" onClick={() => void markAllNotificationsRead()} className="ml-auto flex items-center gap-1 text-xs font-bold text-primary">
                        <Check className="size-4" /> Mark read
                      </button>
                    ) : null}
                  </div>
                  <div className="max-h-[min(420px,calc(100svh-170px))] overflow-y-auto">
                    {notificationsLoading ? (
                      <p className="px-4 py-6 text-sm font-semibold text-[#68746d]">Loading notifications...</p>
                    ) : notificationsError ? (
                      <p className="px-4 py-6 text-sm font-semibold text-red-700">{notificationsError}</p>
                    ) : visibleNotifications.length ? visibleNotifications.map((notification) => (
                      <Link
                        key={notification.id}
                        href={staffNotificationHref(notification.type, routeBase, homeHref)}
                        onClick={() => {
                          void markNotificationRead(notification);
                          setNotificationsOpen(false);
                        }}
                        className={cn(
                          "grid grid-cols-[38px_1fr_auto] gap-3 border-b border-[#edf1ed] px-4 py-3 last:border-0 hover:bg-[#f4f8f4]",
                          !notification.readAt && "bg-[#f1f8f1]"
                        )}
                      >
                        <AssetIcon src={staffNotificationIcon(notification.type)} className="size-8" />
                        <span>
                          <span className="block text-sm font-bold text-[#253129]">{notification.title}</span>
                          <span className="mt-0.5 block text-xs leading-5 text-[#68746d]">{notification.message}</span>
                          <span className="mt-1 block text-[11px] font-semibold text-[#79837d]">{formatStaffNotificationTime(notification.createdAt)}</span>
                        </span>
                        {!notification.readAt ? <span className="mt-1 size-2 rounded-full bg-primary" /> : null}
                      </Link>
                    )) : (
                      <p className="px-4 py-6 text-sm font-semibold text-[#68746d]">No notifications yet.</p>
                    )}
                  </div>
                </section>
              ) : null}
            </div>

            <div ref={profileRef} className="relative shrink-0">
              <button
                type="button"
                aria-expanded={profileOpen}
                onClick={() => {
                  setProfileOpen((current) => !current);
                  setNotificationsOpen(false);
                }}
                className="flex items-center gap-2 rounded-md p-1.5 text-left hover:bg-[#f3f7f3]"
              >
                <span className="grid size-10 place-items-center rounded-full bg-[#dcebdd] text-sm font-extrabold text-primary">{initials}</span>
                <span className="hidden min-w-24 sm:block">
                  <span className="block text-sm font-extrabold text-[#17211b]">{displayName}</span>
                  <span className="block text-xs text-[#69746e]">{role === "ADMIN" ? "Admin" : "Staff"}</span>
                </span>
                <ChevronDown className={cn("hidden size-4 text-[#637068] transition-transform sm:block", profileOpen && "rotate-180")} />
              </button>
              {profileOpen ? (
                <div className="fixed inset-x-3 top-[72px] z-50 overflow-hidden rounded-lg border border-[#dbe5dc] bg-white p-1.5 shadow-[0_16px_45px_rgba(17,40,25,0.18)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+10px)] sm:w-64">
                  <div className="border-b border-[#edf1ed] px-3 py-3">
                    <p className="truncate text-sm font-extrabold text-[#17211b]">{displayName}</p>
                    <p className="mt-0.5 truncate text-xs text-[#68746d]">{user.email}</p>
                    <span className="mt-2 inline-flex rounded-full bg-[#eef6ee] px-2.5 py-1 text-[11px] font-bold uppercase text-primary">{role === "ADMIN" ? "Admin account" : "Staff account"}</span>
                  </div>
                  <Link href={`${routeBase}/settings`} onClick={() => setProfileOpen(false)} className="mt-1 flex min-h-12 items-center gap-3 rounded-md px-3 text-sm font-semibold hover:bg-[#eef6ee]">
                    <Settings className="size-5 text-primary" /> Account settings
                  </Link>
                  <button
                    type="button"
                    onClick={signOut}
                    className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
                  >
                    <LogOut className="size-5" /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto min-h-[calc(100vh-90px)] w-full max-w-[1580px] px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
