import Link from "next/link";
import { AssetIcon } from "@/components/ui/AssetIcon";

type NavItem = {
  href: string;
  label: string;
  iconSrc: string;
};

export function Sidebar({ items }: { items: NavItem[] }) {
  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 border-r bg-card lg:block">
      <nav className="grid gap-1 p-4">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            <AssetIcon src={item.iconSrc} className="size-7" />
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
