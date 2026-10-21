"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StudentNavIcon } from "@/components/layout/StudentNavIcon";
import { cn } from "@/lib/utils";

type StudentNavLinkProps = {
  href: string;
  label: string;
  iconSrc?: string;
};

export function StudentNavLink({ href, label, iconSrc }: StudentNavLinkProps) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={cn(
        "group flex min-w-16 flex-col items-center gap-1 text-xs font-medium transition-colors",
        active ? "text-primary" : "text-[#1f2b25] hover:text-primary"
      )}
    >
      {iconSrc ? (
        <StudentNavIcon
          src={iconSrc}
          active={active}
          className={cn("group-hover:-translate-y-0.5", active && "-translate-y-0.5")}
        />
      ) : (
        <span className={cn("size-8 rounded-lg border-2 border-primary transition-transform group-hover:-translate-y-0.5", active && "-translate-y-0.5 bg-[#e8f4e8]")} />
      )}
      <span>{label}</span>
      <span className={cn("h-1 w-14 rounded-full transition-colors", active ? "bg-primary" : "bg-transparent group-hover:bg-primary/50")} />
    </Link>
  );
}
