"use client";

import Link from "next/link";
import Image from "next/image";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useStudentCart } from "@/components/cart/StudentCartProvider";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { StudentAccountMenu } from "@/components/layout/StudentAccountMenu";
import { StudentNotifications } from "@/components/layout/StudentNotifications";
import { StudentNavLink } from "@/components/layout/StudentNavLink";
import { Button } from "@/components/ui/button";
import { AssetIcon } from "@/components/ui/AssetIcon";

type NavItem = {
  href: string;
  label: string;
  iconSrc?: string;
};

export function WebHeader({ items, role }: { items: NavItem[]; role: string }) {
  const { user, ready, openAuth, logout } = useStudentAuth();
  const { itemCount, openCart } = useStudentCart();
  const resolvedItems = role === "Student"
    ? items.map((item) => item.label === "Receipts"
      ? { ...item, href: ready && user ? "/student/receipts" : "/verify-receipt" }
      : item)
    : items;

  return (
    <>
      <header className="sticky left-0 right-0 top-0 z-40 w-full border-b border-[#e6ece6] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[74px] w-full max-w-[1500px] items-center gap-1 px-3 sm:h-[86px] sm:gap-4 sm:px-8 lg:px-10">
          <Link href="/student/dashboard" className="wescomm-header-logo relative block w-[128px] shrink-0 overflow-hidden min-[390px]:w-[142px] sm:w-[170px]">
            <Image src="/assets/wescomm-logo-ui.webp" alt="WESCOMM" width={1589} height={990} priority className="wescomm-header-logo-art absolute left-0 top-0 h-auto w-full max-w-none" />
          </Link>
          <nav className="ml-6 hidden items-center gap-6 lg:flex xl:gap-8">
            {resolvedItems.map((item) => (
              <StudentNavLink key={item.href} href={item.href} label={item.label} iconSrc={item.iconSrc} />
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
            <div className="flex items-center gap-1">
              {role === "Student" ? (
                <button
                  type="button"
                  onClick={openCart}
                  aria-label={`Open cart with ${itemCount} ${itemCount === 1 ? "item" : "items"}`}
                  title="My Cart"
                  className="relative grid size-9 shrink-0 place-items-center rounded-md hover:bg-[#eef6ee] min-[390px]:size-10 sm:size-11"
                >
                  <AssetIcon src="/assets/cart-bag.svg" className="size-6 sm:size-7" />
                  {itemCount ? (
                    <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] font-extrabold leading-[18px] text-accent-foreground shadow-sm sm:right-0 sm:top-0">
                      {itemCount}
                    </span>
                  ) : null}
                </button>
              ) : null}
              <StudentNotifications onRequireAuth={ready && !user ? openAuth : undefined} />
              {ready && user ? (
                <StudentAccountMenu user={user} onLogout={logout} />
              ) : (
                <div className="flex items-center gap-1 md:hidden">
                  <button
                    type="button"
                    onClick={openAuth}
                    className="whitespace-nowrap rounded-md border border-[#cddccd] px-2 py-2 text-[11px] font-semibold leading-none text-primary min-[390px]:px-2.5 min-[390px]:text-xs"
                  >
                    Log in
                  </button>
                </div>
              )}
            </div>
            {ready && !user ? (
              <div className="hidden items-center md:flex">
                <Button className="h-11 px-5" onClick={openAuth}>
                  Log in
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <MobileBottomNav items={resolvedItems.map(({ href, label, iconSrc }) => ({ href, label, iconSrc }))} />
    </>
  );
}
