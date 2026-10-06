"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Printer, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { isRequestAbortError } from "@/lib/api";
import { getInventoryReport, type InventoryReport, type StaffCategory } from "@/lib/staff-api";
import { userFacingErrorMessage } from "@/lib/user-facing-error";
import { cn } from "@/lib/utils";

type InventoryReportPreviewProps = {
  token: string;
  categories: StaffCategory[];
  onClose: () => void;
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Manila"
  });
}

function count(value: number) {
  return value.toLocaleString("en-PH");
}

/**
 * Printable inventory: the system's version of the paper "ending inventory" sheets.
 * Count-sheet mode adds blank columns for a physical count.
 */
export function InventoryReportPreview({ token, categories, onClose }: InventoryReportPreviewProps) {
  const [categorySlug, setCategorySlug] = useState("");
  const [hideZeroStock, setHideZeroStock] = useState(false);
  const [countSheet, setCountSheet] = useState(false);
  const [report, setReport] = useState<InventoryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  const loadReport = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const data = await getInventoryReport(token, {
        categorySlug: categorySlug || undefined,
        includeZeroStock: !hideZeroStock,
        signal: controller.signal
      });
      if (!controller.signal.aborted) setReport(data);
    } catch (loadError) {
      if (!isRequestAbortError(loadError)) setError(userFacingErrorMessage(loadError, "Unable to prepare the inventory report."));
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }, [categorySlug, hideZeroStock, token]);

  useEffect(() => {
    void loadReport();
    return () => requestRef.current?.abort();
  }, [loadReport]);

  const title = countSheet ? "Inventory Count Sheet" : "Ending Inventory";
  const countColumns = countSheet ? 3 : 0;
  const categoryName = categories.find((category) => category.slug === categorySlug)?.name ?? "All categories";

  return (
    <section className="rounded-xl border bg-card shadow-soft" aria-label="Printable inventory">
      <div className="no-print border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-extrabold text-foreground">Printable inventory</h2>
            <p className="mt-1 text-xs text-muted-foreground">Every active item with its stock by size. Use the count sheet for a physical stock count.</p>
          </div>
          <Button variant="secondary" onClick={onClose}><X className="size-4" /> Close</Button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,16rem)_auto_auto_1fr] lg:items-end">
          <label className="grid gap-1.5 text-sm font-bold">
            Report category
            <select value={categorySlug} onChange={(event) => setCategorySlug(event.target.value)} className="h-11 rounded-md border bg-white px-3 outline-none focus:border-primary">
              <option value="">All categories</option>
              {categories.map((category) => <option key={category.id} value={category.slug}>{category.name}</option>)}
            </select>
          </label>
          <label className="flex h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={hideZeroStock} onChange={(event) => setHideZeroStock(event.target.checked)} className="size-4 accent-primary" />
            Hide items with zero stock
          </label>
          <label className="flex h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={countSheet} onChange={(event) => setCountSheet(event.target.checked)} className="size-4 accent-primary" />
            Count sheet (blank count columns)
          </label>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button variant="secondary" onClick={() => void loadReport()} disabled={loading}>
              <RefreshCw className={cn("size-4", loading && "animate-spin motion-reduce:animate-none")} /> Refresh
            </Button>
            <Button onClick={() => window.print()} disabled={!report || loading}>
              <Printer className="size-4" /> Print
            </Button>
          </div>
        </div>
      </div>

      {error ? <InlineAlert className="no-print mx-5 mt-4" onDismiss={() => setError("")}>{error}</InlineAlert> : null}
      {loading && !report ? <p className="no-print p-6 text-sm font-semibold text-muted-foreground">Preparing the inventory report...</p> : null}

      {report ? (
        <div className="overflow-x-auto p-5">
          <article id="inventory-report-print-area" data-print-document className="inventory-report-doc" aria-label={`${title} as of ${formatDateTime(report.generatedAt)}`}>
            <header className="ird-header">
              <div>
                <p className="ird-wordmark">WESCOMM</p>
                <p className="ird-title">{title}</p>
                <p className="ird-org">Wesleyan University-Philippines — Integrated Commissary Management System</p>
                <p className="ird-asof">As of {formatDateTime(report.generatedAt)}</p>
              </div>
              <dl className="ird-meta">
                {([
                  ["Category", categoryName],
                  ["Prepared by", report.generatedBy ?? "Not recorded"],
                  ["Items", count(report.totals.products)],
                  ["Total units", count(report.totals.units)]
                ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            </header>

            {report.categories.length ? report.categories.map((category) => (
              <table key={category.slug} className={cn("ird-table", countSheet && "ird-table--count")}>
                <colgroup>
                  <col className="ird-col-item" />
                  <col className="ird-col-size" />
                  <col className="ird-col-qty" />
                  {countSheet ? <><col className="ird-col-count" /><col className="ird-col-count" /><col className="ird-col-remarks" /></> : null}
                </colgroup>
                <thead>
                  <tr className="ird-category-row"><th colSpan={3 + countColumns} scope="colgroup">{category.name}</th></tr>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Size / option</th>
                    <th scope="col" className="num">Total inv.</th>
                    {countSheet ? <><th scope="col" className="num">Physical count</th><th scope="col" className="num">Variance</th><th scope="col">Remarks</th></> : null}
                  </tr>
                </thead>
                {category.items.map((item) => (
                  <tbody key={item.productId} className="ird-item">
                    <tr className="ird-product-row">
                      <td colSpan={item.lines.length ? 2 : 1}>
                        <span className="ird-name">{item.name}</span>
                        {item.needsPrice ? <span className="ird-flag">No price</span> : null}
                        {item.setupRequired ? <span className="ird-flag">Sizes not set up</span> : null}
                      </td>
                      {item.lines.length ? null : <td className="ird-muted">{item.saleMode === "CLOTH_ONLY" ? "Cloth (sets)" : "—"}</td>}
                      <td className="num ird-strong">{count(item.total)}</td>
                      {countSheet ? (item.lines.length
                        ? <><td className="ird-shaded" /><td className="ird-shaded" /><td className="ird-shaded" /></>
                        : <><td /><td /><td /></>) : null}
                    </tr>
                    {item.lines.map((line) => (
                      <tr key={line.label} className="ird-line-row">
                        <td />
                        <td>{line.label}</td>
                        <td className="num">{count(line.stock)}</td>
                        {countSheet ? <><td /><td /><td /></> : null}
                      </tr>
                    ))}
                  </tbody>
                ))}
                <tfoot>
                  <tr>
                    <td colSpan={2}>Subtotal — {category.name}</td>
                    <td className="num">{count(category.total)}</td>
                    {countSheet ? <><td /><td /><td /></> : null}
                  </tr>
                </tfoot>
              </table>
            )) : <p className="ird-empty">No active items match this view.</p>}

            <div className="ird-closing">
              <dl className="ird-totals">
                <div><dt>Grand total units</dt><dd>{count(report.totals.units)}</dd></div>
                <div><dt>Items</dt><dd>{count(report.totals.products)}</dd></div>
                <div><dt>Items without a price</dt><dd>{count(report.totals.needsPrice)}</dd></div>
                <div><dt>Units awaiting cost</dt><dd>{count(report.totals.unverifiedCostUnits)}</dd></div>
              </dl>
              <footer className="ird-signatures">
                {(countSheet ? ["Counted by", "Checked by", "Noted by"] : ["Prepared by", "Checked by", "Noted by"]).map((label) => (
                  <div key={label}>
                    <p className="ird-signature">{label}: ______________________</p>
                    <p className="ird-signature-caption">Signature over printed name / Date</p>
                  </div>
                ))}
              </footer>
              <p className="ird-footnote">
                System-generated by WESCOMM from live stock as of the time shown.
                {countSheet ? " Variance = physical count minus total inventory." : ""}
              </p>
            </div>
          </article>
          {loading ? <p className="no-print mt-3 text-xs font-semibold text-muted-foreground">Updating...</p> : null}
        </div>
      ) : null}
    </section>
  );
}

