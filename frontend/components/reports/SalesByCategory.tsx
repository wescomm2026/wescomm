"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BackendReportSummary } from "@/lib/api";

function formatCurrency(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-PH");
}

export function SalesByCategory({
  categorySales,
  itemSales,
  description
}: {
  categorySales: BackendReportSummary["categorySales"];
  itemSales: BackendReportSummary["itemSales"];
  description: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const sortedCategories = useMemo(
    () => [...categorySales].sort((left, right) => right.sales - left.sales || left.category.localeCompare(right.category)),
    [categorySales]
  );
  const visibleCategories = showAll ? sortedCategories : sortedCategories.slice(0, 3);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 className="font-extrabold text-foreground">Sales by category</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        {sortedCategories.length > 3 ? (
          <Button
            type="button"
            variant="secondary"
            className="w-full shrink-0 sm:w-auto"
            aria-expanded={showAll}
            onClick={() => setShowAll((current) => !current)}
          >
            {showAll ? "Show top 3" : `Show all categories (${sortedCategories.length})`}
          </Button>
        ) : null}
      </div>

      {visibleCategories.length ? (
        <div>
          <div className="hidden grid-cols-12 gap-3 border-b border-border bg-muted/40 px-5 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground md:grid">
            <span className="col-span-5">Category</span>
            <span className="col-span-2 text-right">Qty sold</span>
            <span className="col-span-2 text-right">Sales</span>
            <span className="col-span-2 text-right">Gross profit</span>
            <span className="col-span-1" />
          </div>
          <div className="divide-y divide-border">
            {visibleCategories.map((category) => {
              const rank = sortedCategories.findIndex((entry) => entry.category === category.category) + 1;
              const categoryItems = itemSales.filter((item) => item.category === category.category);
              return (
                <details key={category.category} className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 marker:content-none hover:bg-muted/30 md:grid-cols-12 md:px-5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-extrabold text-primary md:col-span-1">{rank}</span>
                    <span className="min-w-0 md:col-span-4">
                      <span className="block truncate font-extrabold text-foreground">{category.category}</span>
                      <span className="mt-1 block text-xs text-muted-foreground md:hidden">{formatNumber(category.quantity)} sold · {formatCurrency(category.sales)} sales</span>
                    </span>
                    <ChevronDown className="size-5 text-primary transition-transform group-open:rotate-180 md:order-last md:col-span-1 md:justify-self-end" />
                    <span className="hidden text-right text-sm text-muted-foreground md:col-span-2 md:block">{formatNumber(category.quantity)}</span>
                    <span className="hidden text-right text-sm font-bold md:col-span-2 md:block">{formatCurrency(category.sales)}</span>
                    <span className="hidden text-right text-sm font-extrabold text-primary md:col-span-2 md:block">{formatCurrency(category.grossProfit)}</span>
                    <span className="col-span-2 ml-11 flex flex-wrap gap-x-4 gap-y-1 text-xs md:hidden">
                      <span className="text-muted-foreground">COGS {formatCurrency(category.cogs)}</span>
                      <span className="font-extrabold text-primary">Profit {formatCurrency(category.grossProfit)}</span>
                    </span>
                  </summary>
                  <div className="border-t border-border bg-muted/30 p-3 sm:p-4">
                    <div className="space-y-2 md:hidden">
                      {categoryItems.map((item) => (
                        <article key={item.productId} className="rounded-md border border-border bg-white p-3 text-sm">
                          <p className="font-extrabold text-foreground">{item.item}</p>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                            <p><span className="text-muted-foreground">Qty:</span> {formatNumber(item.quantity)}</p>
                            <p><span className="text-muted-foreground">Sales:</span> {formatCurrency(item.sales)}</p>
                            <p><span className="text-muted-foreground">COGS:</span> {formatCurrency(item.cogs)}</p>
                            <p className="font-bold text-primary">Profit: {formatCurrency(item.grossProfit)}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full min-w-[600px] text-left text-xs">
                        <thead><tr>{["Item", "Qty", "Sales", "COGS", "Gross profit"].map((heading) => <th key={heading} className="py-2 pr-3 text-muted-foreground">{heading}</th>)}</tr></thead>
                        <tbody className="divide-y divide-border">{categoryItems.map((item) => <tr key={item.productId}><td className="py-2 pr-3 font-bold">{item.item}</td><td className="py-2 pr-3">{formatNumber(item.quantity)}</td><td className="py-2 pr-3">{formatCurrency(item.sales)}</td><td className="py-2 pr-3">{formatCurrency(item.cogs)}</td><td className="py-2 font-bold text-primary">{formatCurrency(item.grossProfit)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      ) : <p className="px-4 py-6 text-center text-sm text-muted-foreground">No completed category sales in this range.</p>}
    </section>
  );
}
