"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { MoreHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  iconSrc?: string;
};

const PRIMARY_NAV_LABELS = new Set(["Home", "Shop", "Reservations", "Receipts"]);

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function compactLabel(label: string) {
  return label === "Reservations" ? "Reserve" : label;
}

export function MobileBottomNav({ items }: { items: NavItem[] }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const primaryItems = items.filter((item) => PRIMARY_NAV_LABELS.has(item.label));
  const moreItems = items.filter((item) => !PRIMARY_NAV_LABELS.has(item.label));
  const moreActive = moreItems.some((item) => isActivePath(pathname, item.href));

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  const moreSheet = (
    <div className="fixed inset-0 z-[70] lg:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-[#101820]/40 backdrop-blur-[2px]"
        onClick={() => setMoreOpen(false)}
        aria-label="Close more navigation"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-more-navigation-title"
        className="absolute inset-x-0 bottom-0 rounded-t-[28px] border-t border-[#dbe6dc] bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_40px_rgba(16,24,32,0.18)]"
      >
        <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-[#d6dfd7]" />
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Student Portal</p>
            <h2 id="mobile-more-navigation-title" className="mt-1 text-xl font-extrabold text-[#101820]">
              More from WESCOMM
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setMoreOpen(false)}
            aria-label="Close more navigation"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-[#eef6ee] text-[#1f2b25] transition-colors hover:bg-[#e1eee2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <X className="size-5" />
          </button>
        </div>
        <nav aria-label="More student navigation" className="mt-5 grid gap-3 sm:grid-cols-2">
          {moreItems.map((item) => {
            const active = isActivePath(pathname, item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-16 items-center gap-4 rounded-2xl border px-4 py-3 font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  active
                    ? "border-primary/30 bg-[#e8f4e8] text-primary"
                    : "border-[#e2e9e3] bg-white text-[#1f2b25] hover:bg-[#f3f8f3]"
                )}
              >
                {item.iconSrc ? (
                  <Image src={item.iconSrc} alt="" width={38} height={38} className="size-9 object-contain" />
                ) : null}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </section>
    </div>
  );

  return (
    <>
      <nav
        aria-label="Mobile student navigation"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-[#dbe6dc] bg-white/95 shadow-[0_-8px_24px_rgba(16,24,32,0.08)] backdrop-blur-xl lg:hidden"
      >
        <div className="mx-auto grid h-16 w-full max-w-lg grid-cols-5 px-1">
          {primaryItems.map((item) => {
            const active = isActivePath(pathname, item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-bold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                  active ? "text-primary" : "text-[#667169] hover:bg-[#f1f7f1] hover:text-primary"
                )}
              >
                <span className={cn("absolute inset-x-3 top-0 h-0.5 rounded-b-full", active ? "bg-primary" : "bg-transparent")} />
                {item.iconSrc ? (
                  <Image src={item.iconSrc} alt="" width={28} height={28} className="size-7 object-contain" />
                ) : null}
                <span className="max-w-full truncate">{compactLabel(item.label)}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="Open more navigation"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cn(
              "relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-bold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
              moreActive || moreOpen ? "text-primary" : "text-[#667169] hover:bg-[#f1f7f1] hover:text-primary"
            )}
          >
            <span className={cn("absolute inset-x-3 top-0 h-0.5 rounded-b-full", moreActive || moreOpen ? "bg-primary" : "bg-transparent")} />
            <MoreHorizontal className="size-7" strokeWidth={2.2} />
            <span>More</span>
          </button>
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>
      {moreOpen && mounted ? createPortal(moreSheet, document.body) : null}
    </>
  );
}
