"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirmationDialog } from "@/components/ui/ConfirmationDialogProvider";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { mapStaffProduct, sortSizeVariants, type Product } from "@/components/staff/StaffOperationsShared";
import { ADJUSTMENT_REASONS, AdjustmentReasonFields, Variance, adjustmentNote, isCountInput } from "@/components/staff/stock-dialog-parts";
import { isRequestAbortError } from "@/lib/api";
import { getStaffProductsPage, restockStaffProduct, restockStaffProductSkus, type StaffCategory, type StaffProduct } from "@/lib/staff-api";
import { userFacingErrorMessage } from "@/lib/user-facing-error";
import { cn } from "@/lib/utils";

type CountLine = { key: string; label: string; system: number };

type CountItem = {
  product: Product;
  /** SKU products post every size together; single-count products post one total. */
  kind: "sku" | "single" | "setup";
  lines: CountLine[];
};

type PostResult = { productId: string; name: string; ok: boolean; message: string };

const SALE_MODE_ORDER: Record<Product["saleMode"], number> = { CLOTH_ONLY: 0, OPTIONS: 1, SIMPLE: 2 };

function countItem(product: Product): CountItem {
  if (product.saleMode === "OPTIONS") {
    if (!product.skuInventoryEnabled || !product.skus.length) return { product, kind: "setup", lines: [] };
    const lines = product.skus.map((sku) => ({
      key: sku.id,
      label: sku.options.length ? sku.options.map((option) => option.optionValue).join(" · ") : "Standard",
      optionValue: sku.options.map((option) => option.optionValue).join(" "),
      system: sku.stock
    }));
    return { product, kind: "sku", lines: sortSizeVariants(lines).map(({ key, label, system }) => ({ key, label, system })) };
  }
  return { product, kind: "single", lines: [{ key: product.id, label: "All units", system: product.stock }] };
}

function formatTime(value: Date) {
  return value.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
}

/**
 * Bulk physical count: staff key in the counted quantity for every item and size, review the
 * variances, and post them in one pass. Blank fields keep the system stock unchanged.
 */
export function StockCountWorkspace({
  token,
  categories,
  onClose,
  onProductUpdated
}: {
  token: string;
  categories: StaffCategory[];
  onClose: () => void;
  onProductUpdated: (product: StaffProduct) => void;
}) {
  const confirm = useConfirmationDialog();
  const [products, setProducts] = useState<Product[]>([]);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [varianceOnly, setVarianceOnly] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<string>(ADJUSTMENT_REASONS[0]);
  const [remarks, setRemarks] = useState("");
  const [posting, setPosting] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<PostResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);

  const loadProducts = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const all: Product[] = [];
      let cursor: string | null = null;
      do {
        const page = await getStaffProductsPage(token, { limit: 50, cursor, visibility: "ACTIVE", signal: controller.signal });
        all.push(...page.products.map(mapStaffProduct));
        cursor = page.nextCursor;
      } while (cursor);
      if (controller.signal.aborted) return;
      setProducts(all);
      setLoadedAt(new Date());
    } catch (loadError) {
      if (!isRequestAbortError(loadError)) setError(userFacingErrorMessage(loadError, "Unable to load the inventory for counting."));
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadProducts();
    return () => abortRef.current?.abort();
  }, [loadProducts]);

  const items = useMemo(() => products
    .map(countItem)
    .sort((left, right) => left.product.category.localeCompare(right.product.category)
      || SALE_MODE_ORDER[left.product.saleMode] - SALE_MODE_ORDER[right.product.saleMode]
      || left.product.name.localeCompare(right.product.name)), [products]);

  const varianceOf = useCallback((line: CountLine) => {
    const value = counts[line.key] ?? "";
    return isCountInput(value) ? Number(value) - line.system : null;
  }, [counts]);

  const itemHasVariance = useCallback((item: CountItem) => item.lines.some((line) => {
    const variance = varianceOf(line);
    return variance !== null && variance !== 0;
  }), [varianceOf]);

  const visibleItems = items.filter((item) =>
    (!category || item.product.category === category)
    && (!search.trim() || item.product.name.toLowerCase().includes(search.trim().toLowerCase()))
    && (!varianceOnly || itemHasVariance(item))
  );

  const enteredLines = items.flatMap((item) => item.lines).filter((line) => (counts[line.key] ?? "").trim() !== "");
  const invalidLines = enteredLines.filter((line) => !isCountInput(counts[line.key] ?? ""));
  const pendingItems = items.filter((item) => item.kind !== "setup" && itemHasVariance(item));
  const varianceTotals = pendingItems.flatMap((item) => item.lines).reduce((totals, line) => {
    const variance = varianceOf(line) ?? 0;
    if (variance > 0) totals.over += variance;
    if (variance < 0) totals.short += -variance;
    return totals;
  }, { over: 0, short: 0 });
  const resultByProduct = new Map(results.map((result) => [result.productId, result]));

  const close = async () => {
    if (enteredLines.length && !posting) {
      const leave = await confirm({
        title: "Discard this count?",
        description: `${enteredLines.length} counted quantit${enteredLines.length === 1 ? "y has" : "ies have"} not been posted.`,
        confirmLabel: "Discard count",
        tone: "danger"
      });
      if (!leave) return;
    }
    onClose();
  };

  const focusNextInput = (current: HTMLInputElement) => {
    const inputs = Array.from(tableRef.current?.querySelectorAll<HTMLInputElement>("input[data-count-input]") ?? []);
    const next = inputs[inputs.indexOf(current) + 1];
    if (next) {
      next.focus();
      next.select();
    }
  };

  const postAdjustments = async () => {
    if (invalidLines.length) {
      setError(`${invalidLines.length} quantit${invalidLines.length === 1 ? "y is" : "ies are"} not a whole number from 0 to 10,000,000.`);
      return;
    }
    if (!pendingItems.length) return;
    const confirmed = await confirm({
      title: `Post ${pendingItems.length} stock adjustment${pendingItems.length === 1 ? "" : "s"}?`,
      description: `Over: +${varianceTotals.over} units · Short: −${varianceTotals.short} units. System stock for these items is replaced with the physical count. Reason: ${reason}.`,
      confirmLabel: "Post adjustments",
      tone: "warning"
    });
    if (!confirmed) return;

    setError("");
    setResults([]);
    const notes = adjustmentNote(reason, remarks);
    const outcome: PostResult[] = [];
    const posted = new Map<string, Product>();
    setPosting({ done: 0, total: pendingItems.length });
    for (let index = 0; index < pendingItems.length; index += 1) {
      const item = pendingItems[index];
      const { product } = item;
      try {
        const counted = (line: CountLine) => isCountInput(counts[line.key] ?? "") ? Number(counts[line.key]) : line.system;
        const updated = item.kind === "sku"
          ? await restockStaffProductSkus(token, product.id, {
              mode: "set",
              quantities: item.lines.map((line) => ({ skuId: line.key, quantity: counted(line) })),
              lowStockPercent: product.lowStockPercent,
              notes
            })
          : await restockStaffProduct(token, product.id, {
              mode: "set",
              quantity: counted(item.lines[0]),
              lowStockPercent: product.lowStockPercent,
              notes
            });
        posted.set(product.id, mapStaffProduct(updated));
        onProductUpdated(updated);
        outcome.push({ productId: product.id, name: product.name, ok: true, message: "Posted" });
      } catch (postError) {
        outcome.push({ productId: product.id, name: product.name, ok: false, message: userFacingErrorMessage(postError, "Unable to post this adjustment.") });
      }
      setPosting({ done: index + 1, total: pendingItems.length });
    }
    setProducts((current) => current.map((product) => posted.get(product.id) ?? product));
    setCounts((current) => {
      const next = { ...current };
      for (const item of pendingItems) {
        if (posted.has(item.product.id)) item.lines.forEach((line) => delete next[line.key]);
      }
      return next;
    });
    setResults(outcome);
    // Posted items no longer have a variance; show the full list so their "Posted" badges stay visible.
    if (posted.size) setVarianceOnly(false);
    setPosting(null);
  };

  const failed = results.filter((result) => !result.ok);
  const succeeded = results.length - failed.length;

  return (
    <section className="rounded-xl border bg-card shadow-soft" aria-label="Stock count">
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-foreground"><ClipboardCheck className="size-5 text-primary" aria-hidden="true" /> Stock count</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Enter the physical count for each item and size. Leave a field blank to keep the system stock. Only items with a variance are posted.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => void loadProducts()} disabled={loading || Boolean(posting)}>
              <RefreshCw className={cn("size-4", loading ? "animate-spin" : "")} /> Refresh
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void close()} disabled={Boolean(posting)} aria-label="Close stock count"><X className="size-4" /></Button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)_auto] sm:items-end">
          <label className="grid gap-1.5 text-sm font-semibold">
            Count category
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-11 rounded-md border bg-white px-3 font-normal outline-none focus:border-primary">
              <option value="">All categories</option>
              {categories.map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Find item
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Item name" className="h-11 rounded-md border bg-white px-3 font-normal outline-none focus:border-primary" />
          </label>
          <label className="flex h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={varianceOnly} onChange={(event) => setVarianceOnly(event.target.checked)} className="size-4" />
            Only items with variance
          </label>
        </div>
        <div className="mt-4">
          <AdjustmentReasonFields reason={reason} remarks={remarks} onReason={setReason} onRemarks={setRemarks} />
        </div>
      </div>

      {error ? <div className="px-4 pt-4 sm:px-5"><InlineAlert>{error}</InlineAlert></div> : null}
      {results.length ? (
        <div className={cn("mx-4 mt-4 rounded-md border px-3 py-2 text-sm sm:mx-5", failed.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-primary/30 bg-primary/5 text-foreground")} role="status">
          <p className="font-extrabold">{succeeded} adjustment{succeeded === 1 ? "" : "s"} posted{failed.length ? `, ${failed.length} not posted` : ""}.</p>
          {failed.length ? <ul className="mt-1 list-disc pl-5 text-xs leading-5">{failed.map((result) => <li key={result.productId}><strong>{result.name}:</strong> {result.message}</li>)}</ul> : null}
        </div>
      ) : null}

      <div ref={tableRef} className="overflow-x-auto px-4 py-4 sm:px-5">
        {loading && !products.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading inventory...</p>
        ) : visibleItems.length ? (
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Item / size</th>
                <th className="w-24 py-2 pr-3 text-right">System</th>
                <th className="w-36 py-2 pr-3 text-center">Physical count</th>
                <th className="w-24 py-2 text-center">Variance</th>
              </tr>
            </thead>
            {visibleItems.map((item) => {
              const result = resultByProduct.get(item.product.id);
              return (
                <tbody key={item.product.id} className="border-b">
                  <tr className="bg-surface-subtle/70">
                    <th colSpan={4} scope="rowgroup" className="px-2 py-2 text-left">
                      <span className="font-extrabold text-foreground">{item.product.name}</span>
                      <span className="ml-2 text-xs font-semibold text-muted-foreground">{item.product.category}</span>
                      {item.kind === "setup" ? <span className="ml-2 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">Set up sizes first from Update stock</span> : null}
                      {result ? <span className={cn("ml-2 rounded px-2 py-0.5 text-[11px] font-bold", result.ok ? "bg-primary/10 text-primary" : "bg-danger/10 text-danger")}>{result.ok ? "Posted" : "Not posted"}</span> : null}
                    </th>
                  </tr>
                  {item.lines.map((line) => {
                    const value = counts[line.key] ?? "";
                    const variance = varianceOf(line);
                    const invalid = value.trim() !== "" && !isCountInput(value);
                    return (
                      <tr key={line.key}>
                        <td className="py-1.5 pl-4 pr-3 font-semibold text-foreground">{line.label}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{line.system}</td>
                        <td className="py-1.5 pr-3">
                          <input
                            data-count-input
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            value={value}
                            placeholder={String(line.system)}
                            disabled={Boolean(posting)}
                            aria-invalid={invalid || undefined}
                            aria-label={`${item.product.name} ${line.label} physical count`}
                            onChange={(event) => setCounts((current) => ({ ...current, [line.key]: event.target.value }))}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                focusNextInput(event.currentTarget);
                              }
                            }}
                            className={cn("h-10 w-full rounded-md border px-2 text-center text-base outline-none placeholder:text-muted-foreground/50 focus:border-primary", invalid ? "border-danger" : "")}
                          />
                        </td>
                        <td className="py-1.5 text-center">{variance === null ? <span className="text-xs text-muted-foreground">{"—"}</span> : <Variance value={variance} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">{varianceOnly ? "No items have a variance yet." : "No items match this filter."}</p>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-border bg-white/95 px-4 py-3 backdrop-blur sm:px-5">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {posting
            ? `Posting ${posting.done} of ${posting.total}...`
            : <>
                <strong className="text-foreground">{enteredLines.length}</strong> counted · <strong className="text-foreground">{pendingItems.length}</strong> item{pendingItems.length === 1 ? "" : "s"} with variance
                {pendingItems.length ? <> · Over <strong className="text-primary">+{varianceTotals.over}</strong> · Short <strong className="text-danger">{"−"}{varianceTotals.short}</strong></> : null}
                {loadedAt ? <> · System stock as of {formatTime(loadedAt)}</> : null}
              </>}
        </p>
        <Button type="button" onClick={() => void postAdjustments()} disabled={Boolean(posting) || loading || !pendingItems.length}>
          {posting ? "Posting..." : pendingItems.length ? `Post ${pendingItems.length} adjustment${pendingItems.length === 1 ? "" : "s"}` : "Post adjustments"}
        </Button>
      </div>
    </section>
  );
}
