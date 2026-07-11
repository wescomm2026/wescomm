"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssetIcon } from "@/components/ui/AssetIcon";
import { getProductsFromApi } from "@/lib/api";

type Products = Awaited<ReturnType<typeof getProductsFromApi>>;

type StockStat = {
  label: string;
  value: number;
  image: string;
  href: string;
};

function statusCount(products: Products, status: string) {
  return products.filter((product) => product.status === status).length;
}

export function StockOverview() {
  const [stats, setStats] = useState<StockStat[]>([]);
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(() => {
    let cancelled = false;
    setLoading(true);

    getProductsFromApi()
      .then((products) => {
        if (cancelled) return;
        setStats([
          { label: "Available", value: statusCount(products, "In Stock"), image: "/assets/in-stock.svg", href: "/student/shop?status=in-stock" },
          { label: "Restock Soon", value: statusCount(products, "Restock Soon"), image: "/assets/restock-soon.svg", href: "/student/shop?status=restock-soon" },
          { label: "Unavailable", value: statusCount(products, "Out of Stock"), image: "/assets/out-of-stock.svg", href: "/student/shop?status=out-of-stock" },
          { label: "On Sale", value: statusCount(products, "On Sale"), image: "/assets/on-sale.svg", href: "/student/shop?status=on-sale" }
        ]);
      })
      .catch(() => {
        if (!cancelled) setStats([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => loadStats(), [loadStats]);

  const hasData = useMemo(() => stats.some((stat) => stat.value > 0), [stats]);

  return (
    <section className="wes-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Stock Status Overview</h2>
        <Link href="/student/shop" className="text-sm font-semibold text-primary">View shop</Link>
      </div>
      {loading ? (
        <div className="rounded-lg border border-[#e1e9e1] p-5 text-sm font-semibold text-[#68746d]">Loading live stock status...</div>
      ) : hasData ? (
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
          No active stock data found yet.
        </div>
      )}
    </section>
  );
}
