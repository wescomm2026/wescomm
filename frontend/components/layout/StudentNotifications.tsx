"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import {
  getNotificationsFromApi,
  markAllNotificationsReadFromApi,
  markNotificationReadFromApi,
  type BackendNotification,
  type BackendNotificationType
} from "@/lib/api";
import { cn } from "@/lib/utils";

function notificationIcon(type: BackendNotificationType) {
  if (type === "RESERVATION") return "/assets/reservations.svg";
  if (type === "RECEIPT") return "/assets/verified.svg";
  if (type === "PAYMENT") return "/assets/payment.svg";
  if (type === "LOW_STOCK") return "/assets/restock-soon.svg";
  if (type === "BACK_IN_STOCK") return "/assets/restock-soon.svg";
  if (type === "MESSAGE") return "/assets/support.svg";
  return "/assets/notifications.svg";
}

function notificationHref(notification: BackendNotification) {
  if (
    notification.actionUrl?.startsWith("/") &&
    !notification.actionUrl.startsWith("//")
  ) {
    return notification.actionUrl;
  }
  if (notification.type === "RESERVATION") return "/student/reservations";
  if (notification.type === "RECEIPT") return "/student/receipts";
  if (notification.type === "PAYMENT") return "/student/reservations";
  if (notification.type === "LOW_STOCK" || notification.type === "BACK_IN_STOCK") return "/student/shop?wishlist=1";
  if (notification.type === "MESSAGE") return "/student/support";
  return "/student/dashboard";
}

function formatNotificationTime(value: string) {
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

export function StudentNotifications({ onRequireAuth }: { onRequireAuth?: () => void }) {
  const { user } = useStudentAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<BackendNotification[]>([]);
  const [notificationOwnerId, setNotificationOwnerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requestSequenceRef = useRef(0);
  const accountId = user?.id ?? "";
  const visibleNotifications = notificationOwnerId === accountId ? notifications : [];
  const unreadCount = visibleNotifications.filter((notification) => !notification.readAt).length;

  const loadNotifications = useCallback(async () => {
    if (!user?.accessToken || !accountId) return;
    const requestSequence = ++requestSequenceRef.current;
    setLoading(true);
    setError("");

    try {
      const rows = await getNotificationsFromApi(user.accessToken);
      if (requestSequence !== requestSequenceRef.current) return;
      setNotifications(rows);
      setNotificationOwnerId(accountId);
    } catch (notificationError) {
      if (requestSequence !== requestSequenceRef.current) return;
      setError(notificationError instanceof Error ? notificationError.message : "Unable to load notifications.");
    } finally {
      if (requestSequence === requestSequenceRef.current) setLoading(false);
    }
  }, [accountId, user?.accessToken]);

  useEffect(() => {
    setOpen(false);
    setNotifications([]);
    setNotificationOwnerId(accountId);
    if (!user?.accessToken || !accountId) {
      setNotifications([]);
      setError("");
      setLoading(false);
      return;
    }

    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 15000);
    return () => {
      requestSequenceRef.current += 1;
      window.clearInterval(timer);
    };
  }, [accountId, loadNotifications, user?.accessToken]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const toggleNotifications = () => {
    if (!user?.accessToken && onRequireAuth) {
      onRequireAuth();
      return;
    }
    setOpen((current) => !current);
    if (!open) void loadNotifications();
  };

  const markAllRead = async () => {
    if (!user?.accessToken) return;
    setNotifications((current) =>
      current.map((notification) => ({ ...notification, readAt: notification.readAt ?? new Date().toISOString() }))
    );

    try {
      await markAllNotificationsReadFromApi(user.accessToken);
      void loadNotifications();
    } catch (notificationError) {
      setError(notificationError instanceof Error ? notificationError.message : "Unable to update notifications.");
    }
  };

  const markRead = async (notification: BackendNotification) => {
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

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleNotifications}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={open}
        aria-controls={open ? "student-notifications-panel" : undefined}
        title="Notifications"
        className={cn(
          "relative grid size-10 place-items-center rounded-md border border-transparent transition-colors sm:size-11",
          open ? "border-[#cfe0d0] bg-[#eef6ee]" : "hover:border-[#d9e5da] hover:bg-[#f3f8f3]"
        )}
      >
        <Bell className="size-6 text-primary sm:size-7" strokeWidth={1.9} />
        {unreadCount ? (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full border-2 border-white bg-[#f5b000] px-1 text-[10px] font-extrabold leading-4 text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <section
          id="student-notifications-panel"
          role="region"
          aria-label="Student notifications"
          className="fixed inset-x-3 top-[82px] z-50 overflow-hidden rounded-lg border border-[#d8e3d9] bg-white shadow-[0_18px_55px_rgba(17,40,25,0.2)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+12px)] sm:w-[380px]"
        >
          <div className="flex items-center justify-between border-b border-[#e7eee8] px-4 py-3">
            <div>
              <h2 className="font-extrabold text-[#17211b]">Notifications</h2>
              <p className="text-xs text-[#6b766f]">{unreadCount ? `${unreadCount} unread update${unreadCount > 1 ? "s" : ""}` : "You are all caught up"}</p>
            </div>
            <div className="flex items-center gap-1">
              {unreadCount ? (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-bold text-primary hover:bg-[#eef6ee]"
                >
                  <Check className="size-4" />
                  Mark all read
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  window.requestAnimationFrame(() => triggerRef.current?.focus());
                }}
                aria-label="Close notifications"
                className="grid size-9 place-items-center rounded-md hover:bg-[#eef3ee]"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[min(420px,calc(100svh-180px))] overflow-y-auto">
            {loading ? (
              <p className="px-4 py-6 text-sm font-semibold text-[#68746d]">Loading notifications...</p>
            ) : error ? (
              <p className="px-4 py-6 text-sm font-semibold text-red-700">{error}</p>
            ) : visibleNotifications.length ? visibleNotifications.map((notification) => (
              <Link
                key={notification.id}
                href={notificationHref(notification)}
                onClick={() => {
                  void markRead(notification);
                  setOpen(false);
                }}
                className={cn(
                  "grid grid-cols-[42px_1fr_auto] gap-3 border-b border-[#eef2ee] px-4 py-4 transition-colors last:border-b-0 hover:bg-[#f5faf5]",
                  !notification.readAt && "bg-[#f1f8f1]"
                )}
              >
                <span className="relative grid size-10 place-items-center rounded-md border border-[#dce7dd] bg-white">
                  <Image src={notificationIcon(notification.type)} alt="" width={30} height={30} className="size-7 object-contain" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-extrabold text-[#203027]">{notification.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-[#667169]">{notification.message}</span>
                  <span className="mt-1.5 block text-[11px] font-semibold text-[#79837d]">{formatNotificationTime(notification.createdAt)}</span>
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
  );
}
