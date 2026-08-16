import { ReactNode } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { WebHeader } from "@/components/layout/WebHeader";

type NavItem = {
  href: string;
  label: string;
  iconSrc: string;
};

export function PageShell({
  children,
  items,
  role,
  sidebar = false
}: {
  children: ReactNode;
  items: NavItem[];
  role: string;
  sidebar?: boolean;
}) {
  return (
    <div className="min-h-screen w-full overflow-x-hidden">
      <WebHeader items={items.map(({ href, label, iconSrc }) => ({ href, label, iconSrc }))} role={role} />
      <div className={sidebar ? "flex" : ""}>
        {sidebar ? <Sidebar items={items} /> : null}
        <main className="mx-auto w-full max-w-[1500px] px-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-8 sm:pt-6 lg:px-10 lg:py-6">{children}</main>
      </div>
    </div>
  );
}
