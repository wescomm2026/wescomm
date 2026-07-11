"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import type { StudentUser } from "@/components/auth/StudentAuthProvider";
import { cn } from "@/lib/utils";

export function StudentAccountMenu({
  user,
  onLogout
}: {
  user: StudentUser;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const firstName = user.fullName.split(" ")[0] ?? "Student";
  const initials = user.fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={`${user.fullName} account menu`}
        aria-expanded={open}
        className={cn(
          "flex h-10 items-center gap-2 rounded-md border p-1 transition-colors sm:h-11 sm:px-2",
          open
            ? "border-[#bdd2bf] bg-[#eef6ee]"
            : "border-transparent hover:border-[#d5e1d6] hover:bg-[#f4f8f4]"
        )}
      >
        <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-[#dcebdd] text-xs font-extrabold text-primary">
          {user.avatarDataUrl ? (
            <Image src={user.avatarDataUrl} alt="" fill unoptimized className="object-cover" />
          ) : (
            initials
          )}
        </span>
        <span className="hidden max-w-24 truncate text-sm font-bold text-[#26332c] md:block">{firstName}</span>
        <ChevronDown className={cn("hidden size-4 text-[#667169] transition-transform md:block", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="fixed inset-x-3 top-[76px] z-50 overflow-hidden rounded-lg border border-[#d9e4da] bg-white p-1.5 shadow-[0_16px_45px_rgba(17,40,25,0.18)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+10px)] sm:w-64">
          <div className="border-b border-[#edf1ed] px-3 py-3">
            <p className="truncate text-sm font-extrabold text-[#17211b]">{user.fullName}</p>
            <p className="mt-0.5 truncate text-xs text-[#68746d]">{user.email}</p>
          </div>
          <Link
            href="/student/profile"
            onClick={() => setOpen(false)}
            className="mt-1 flex min-h-12 items-center gap-3 rounded-md bg-[#eef6ee] px-3 text-sm font-semibold text-[#26332c] hover:bg-[#e3f1e4]"
          >
            <Settings className="size-5 text-primary" />
            Account settings
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            <LogOut className="size-5" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
