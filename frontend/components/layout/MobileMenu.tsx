"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  iconSrc?: string;
};

export function MobileMenu({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const menuOverlay = (
    <div className="fixed inset-0 z-[9999] bg-white">
      <div className="flex h-[100svh] min-h-screen w-full flex-col overflow-hidden bg-white">
        <div className="flex h-20 shrink-0 items-center justify-between border-b border-[#e6ece6] bg-white px-5">
          <Image src="/assets/wescomm-logo.png" alt="WESCOMM" width={132} height={52} className="h-11 w-auto object-contain" />
          <Button variant="ghost" className="size-10 rounded-xl px-0 text-[#1f2b25] hover:bg-[#eef6ee]" onClick={() => setOpen(false)} aria-label="Close student menu">
            <X className="size-6" />
          </Button>
        </div>
        <div className="border-b border-[#eef3ee] bg-white px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Student Portal</p>
          <h2 className="mt-1 text-lg font-extrabold text-[#101820]">WESCOMM Menu</h2>
        </div>
        <nav className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto bg-white p-5">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex h-14 items-center gap-4 rounded-xl px-4 text-base font-semibold hover:bg-[#f1f8f1]",
                  active ? "bg-[#e8f4e8] text-primary" : "text-[#1f2b25]"
                )}
              >
                {item.iconSrc ? (
                  <Image src={item.iconSrc} alt="" width={34} height={34} className="size-8 object-contain" />
                ) : (
                  <span className="size-2 rounded-full bg-primary" />
                )}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );

  return (
    <div className="shrink-0 lg:hidden">
      <Button
        variant="ghost"
        className="size-11 shrink-0 rounded-xl border border-transparent px-0 text-primary hover:border-[#cddccd] hover:bg-[#eef6ee]"
        onClick={() => setOpen(true)}
        aria-label="Open student menu"
        aria-expanded={open}
      >
        <Menu className="size-7" />
      </Button>
      {open && mounted ? createPortal(menuOverlay, document.body) : null}
    </div>
  );
}
