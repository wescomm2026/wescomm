"use client";

import Link from "next/link";
import Image from "next/image";
import { ShoppingCart } from "lucide-react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { useStudentCart } from "@/components/cart/StudentCartProvider";
import { MobileMenu } from "@/components/layout/MobileMenu";
import { StudentAccountMenu } from "@/components/layout/StudentAccountMenu";
import { StudentNotifications } from "@/components/layout/StudentNotifications";
import { StudentNavLink } from "@/components/layout/StudentNavLink";
import { Button } from "@/components/ui/button";

type NavItem = {
  href: string;
  label: string;
  iconSrc?: string;
};

export function WebHeader({ items, role }: { items: NavItem[]; role: string }) {
  const { user, ready, openAuth, logout } = useStudentAuth();
  const { itemCount, openCart } = useStudentCart();

  return (
    <header className="sticky left-0 right-0 top-0 z-40 w-full border-b border-[#e6ece6] bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-[74px] w-full max-w-[1500px] items-center gap-1 px-3 sm:h-[86px] sm:gap-4 sm:px-8 lg:px-10">
        <MobileMenu items={items.map(({ href, label, iconSrc }) => ({ href, label, iconSrc }))} />
        <Link href="/student/dashboard" className="relative h-11 w-[92px] shrink-0 min-[390px]:w-[116px] sm:h-14 sm:w-[185px]">
          <Image src="/assets/wescomm-logo.png" alt="WESCOMM" fill priority className="object-contain object-left" />
        </Link>
        <nav className="ml-6 hidden items-center gap-6 lg:flex xl:gap-8">
          {items.map((item) => (
            <StudentNavLink key={item.href} href={item.href} label={item.label} iconSrc={item.iconSrc} />
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
          <div className="flex items-center gap-1">
            {role === "Student" ? (
              <button
                type="button"
                onClick={openCart}
                aria-label={`Open cart with ${itemCount} items`}
                title="My Cart"
                className="relative grid size-9 shrink-0 place-items-center rounded-md hover:bg-[#eef6ee] min-[390px]:size-10 sm:size-11"
              >
                <ShoppingCart className="size-6 text-primary sm:size-7" strokeWidth={1.9} />
                {itemCount ? (
                  <span className="absolute right-0 top-0 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-5 text-white sm:right-0.5 sm:top-0.5">
                    {itemCount > 99 ? "99+" : itemCount}
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
  );
}
