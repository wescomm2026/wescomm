"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useDashboardProducts, type DashboardProducts } from "@/components/dashboard/DashboardProductsProvider";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { isProductUnavailable } from "@/lib/product-display";

type StockStat = {
  label: string;
  value: number;
  image: string;
  href: string;
};

export function StockOverview() {
  const { products, status } = useDashboardProducts();
  const stats = useMemo<StockStat[]>(() => [
    { label: "Available", value: products.filter((product) => !isProductUnavailable(product) && product.status === "In Stock").length, image: "/assets/in-stock.svg", href: "/student/shop?status=in-stock" },
    { label: "Restock Soon", value: products.filter((product) => !isProductUnavailable(product) && product.status === "Restock Soon").length, image: "/assets/restock-soon.svg", href: "/student/shop?status=restock-soon" },
    { label: "Unavailable", value: products.filter(isProductUnavailable).length, image: "/assets/out-of-stock.svg", href: "/student/shop?status=out-of-stock" },
    { label: "On Sale", value: products.filter((product) => !isProductUnavailable(product) && product.isOnSale).length, image: "/assets/on-sale.svg", href: "/student/shop?status=on-sale" }
  ], [products]);

  return (
    <section className="wes-card p-5" aria-busy={status === "loading"}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Stock Status Overview</h2>
        <Link href="/student/shop" className="text-sm font-semibold text-primary">View shop</Link>
      </div>
      {status === "loading" ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="status">
          <span className="sr-only">Loading live stock status.</span>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-[#e1e9e1] p-3" aria-hidden="true">
              <div className="animate-pulse space-y-2 motion-reduce:animate-none">
                <div className="mx-auto size-11 rounded-full bg-[#e7f0e7]" />
                <div className="mx-auto h-2.5 w-16 rounded-full bg-[#edf3ed]" />
                <div className="mx-auto h-7 w-10 rounded-md bg-[#dce9dc]" />
                <div className="mx-auto h-2.5 w-10 rounded-full bg-[#edf3ed]" />
              </div>
            </div>
          ))}
        </div>
      ) : status === "error" ? (
        <div className="rounded-lg border border-[#eadfbd] bg-[#fffaf0] p-5 text-sm font-semibold text-[#756033]" role="status">
          Live stock status is temporarily unavailable. Open the shop to try again.
        </div>
      ) : products.length ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((stat) => (
            <Link href={stat.href} key={stat.label} className="rounded-lg border border-[#e1e9e1] p-3 text-center transition hover:border-primary hover:bg-[#f4faf4]">
              <AssetIcon src={stat.image} className="mx-auto size-11" />
              <p className="mt-1 text-xs">{stat.label}</p>
              <p className="text-2xl font-extrabold text-primary">{stat.value}</p>
              <p className="text-xs text-muted-foreground">items</p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-[#e1e9e1] p-5 text-sm font-semibold text-[#68746d]">
          No active stock data is available yet.
        </div>
      )}
    </section>
  );
}
