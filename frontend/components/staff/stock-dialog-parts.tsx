"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { StaffInventoryBatchResult } from "@/lib/inventory-batch-api";
import { cn } from "@/lib/utils";

// Shared vocabulary for the Update stock dialogs (single-count and size/option
// products) and the bulk Stock count page, so every screen uses the same terms.

export type StockAction = "receive" | "adjust" | "price";

export const STOCK_ACTIONS: Array<{ value: StockAction; label: string; detail: string }> = [
  { value: "receive", label: "Receive stock", detail: "Record a delivery from a supplier." },
  { value: "adjust", label: "Adjust stock count", detail: "Match the system to a physical count." },
  { value: "price", label: "Update selling price", detail: "Change the price students pay." }
];

export const ADJUSTMENT_REASONS = [
  "Physical inventory count",
  "Recording error",
  "Damaged / defective",
  "Lost / missing",
  "Found / returned to shelf"
] as const;

export const REORDER_ALERT_PERCENTS = [10, 20, 25, 30, 40, 50] as const;

/** Today's date (YYYY-MM-DD) in Philippine time, for "Date received" defaults. */
export function todayInManila() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

export function formatPhp(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function isMoneyInput(value: string) {
  if (!value.trim()) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10_000_000 && Math.round(parsed * 100) === parsed * 100;
}

export function isCountInput(value: string, minimum = 0) {
  if (!value.trim()) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= 10_000_000;
}

/** Audit note stored on the inventory movement for a count adjustment. */
export function adjustmentNote(reason: string, remarks: string) {
  const trimmed = remarks.trim();
  return `Stock count adjustment - ${reason}${trimmed ? `: ${trimmed}` : ""}`.slice(0, 500);
}

export function reorderAlertQuantity(stockLevel: number, percent: number) {
  return stockLevel <= 0 ? 0 : Math.ceil(stockLevel * percent / 100);
}

export function StockActionTabs({
  value,
  onChange,
  disabled
}: {
  value: StockAction;
  onChange: (next: StockAction) => void;
  disabled?: boolean;
}) {
  return (
    <div role="tablist" aria-label="Stock action" className="grid grid-cols-3 gap-1 rounded-lg border bg-surface-subtle p-1">
      {STOCK_ACTIONS.map((action) => {
        const selected = action.value === value;
        return (
          <button
            key={action.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => onChange(action.value)}
            className={cn(
              "min-h-11 rounded-md px-2 py-1.5 text-center text-xs font-extrabold leading-4 transition sm:text-sm",
              selected ? "bg-white text-primary shadow-sm ring-1 ring-primary/30" : "text-muted-foreground hover:bg-white/70 hover:text-foreground"
            )}
          >
            {action.label}
          </button>
        );
      })}
    </div>
  );
}

export function StockActionIntro({ action }: { action: StockAction }) {
  const text = {
    receive: "Enter only the units that arrived in this delivery. They are added to the current stock on hand.",
    adjust: "Enter the quantity physically on hand. The system stock is replaced with this count and the variance is recorded with your reason.",
    price: "The new price applies to all future reservations and walk-in sales. Completed sales keep the price they were recorded at."
  }[action];
  return <p className="mt-3 text-xs leading-5 text-muted-foreground">{text}</p>;
}

export function Variance({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn(
      "inline-flex min-w-12 justify-center rounded px-1.5 py-0.5 text-xs font-extrabold tabular-nums",
      value > 0 ? "bg-primary/10 text-primary" : value < 0 ? "bg-danger/10 text-danger" : "bg-surface-subtle text-muted-foreground",
      className
    )}>
      {value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0"}
    </span>
  );
}

export function MoneyInput({
  label,
  value,
  onChange,
  hint,
  autoFocus
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  autoFocus?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      {label}
      <div className="flex h-12 items-center rounded-md border bg-white px-3 focus-within:border-primary">
        <span className="mr-2 text-sm font-bold text-muted-foreground">PHP</span>
        <input
          aria-label={label}
          autoFocus={autoFocus}
          type="number"
          min="0"
          max="10000000"
          step="0.01"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0.00"
          className="min-w-0 flex-1 bg-transparent text-base font-normal outline-none focus-visible:outline-none"
        />
      </div>
      {hint ? <span className="text-xs font-normal leading-4 text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function AdjustmentReasonFields({
  reason,
  remarks,
  onReason,
  onRemarks
}: {
  reason: string;
  remarks: string;
  onReason: (value: string) => void;
  onRemarks: (value: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1.5 text-sm font-semibold">
        Adjustment reason
        <select value={reason} onChange={(event) => onReason(event.target.value)} className="h-12 rounded-md border bg-white px-3 font-normal outline-none focus:border-primary">
          {ADJUSTMENT_REASONS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm font-semibold">
        Remarks <span className="sr-only">(optional)</span>
        <input type="text" maxLength={300} value={remarks} onChange={(event) => onRemarks(event.target.value)} placeholder="Optional, e.g. counted by J. Cruz" className="h-12 rounded-md border bg-white px-3 font-normal outline-none focus:border-primary" />
      </label>
    </div>
  );
}

export function SummaryPanel({ rows }: { rows: Array<{ label: string; value: ReactNode; emphasis?: boolean }> }) {
  return (
    <dl className="mt-5 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3" aria-label="Summary">
      {rows.map((row) => (
        <div key={row.label} className={cn("bg-white px-4 py-3", row.emphasis ? "bg-primary/5" : "")}>
          <dt className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{row.label}</dt>
          <dd className={cn("mt-1 text-lg font-extrabold tabular-nums", row.emphasis ? "text-primary" : "text-foreground")}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MarginNote({ price, unitCost, priceLabel = "the current selling price" }: { price: number; unitCost: number | null; priceLabel?: string }) {
  if (unitCost === null || !Number.isFinite(unitCost) || price <= 0) return null;
  const margin = price - unitCost;
  const percent = margin / price * 100;
  return (
    <p className={cn("mt-3 rounded-md border px-3 py-2 text-xs font-semibold leading-5", margin < 0 ? "border-red-200 bg-red-50 text-red-800" : "border-border bg-surface-subtle text-muted-foreground")}>
      {margin < 0
        ? `This unit cost is higher than the selling price of ${formatPhp(price)}. Each unit sold would lose ${formatPhp(Math.abs(margin))}.`
        : `Margin at ${priceLabel} of ${formatPhp(price)}: ${formatPhp(margin)} per unit (${percent.toFixed(1)}%).`}
    </p>
  );
}

export function SubmitHint({ text }: { text: string }) {
  if (!text) return null;
  return <p className="mr-auto text-xs font-semibold text-muted-foreground" aria-live="polite">{text}</p>;
}

/** Units added by a stock count have no recorded cost and cannot be sold until one is entered. */
export function UnitCostNeeded({
  batches,
  drafts,
  onDraft,
  onSave,
  submitting
}: {
  batches: StaffInventoryBatchResult["batches"];
  drafts: Record<string, string>;
  onDraft: (batchId: string, value: string) => void;
  onSave: (batchId: string) => void;
  submitting: boolean;
}) {
  const pending = batches.filter((batch) => !batch.costVerified && batch.quantityRemaining > 0);
  if (!pending.length) return null;
  return (
    <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h3 className="text-sm font-extrabold text-amber-900">Unit cost needed</h3>
      <p className="mt-1 text-xs leading-5 text-amber-800">These units were added by a stock count without a cost. Enter what was paid per unit so they can be sold.</p>
      <div className="mt-3 space-y-2">
        {pending.map((batch) => (
          <div key={batch.id} className="grid gap-2 rounded-md bg-white p-3 sm:grid-cols-[1fr_160px_auto] sm:items-center">
            <div>
              <p className="text-xs font-bold text-foreground">{batch.sku?.optionSnapshot?.map((option) => option.optionValue).join(" · ") || "All units"}</p>
              <p className="text-xs text-muted-foreground">{batch.quantityRemaining} unit{batch.quantityRemaining === 1 ? "" : "s"}</p>
            </div>
            <div className="flex h-10 items-center rounded-md border px-2 focus-within:border-primary">
              <span className="mr-1 text-xs font-bold text-muted-foreground">PHP</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" aria-label={`Unit cost for ${batch.quantityRemaining} uncosted units`} value={drafts[batch.id] ?? ""} onChange={(event) => onDraft(batch.id, event.target.value)} className="min-w-0 flex-1 outline-none" placeholder="0.00" />
            </div>
            <Button type="button" className="h-10" disabled={submitting || !isMoneyInput(drafts[batch.id] ?? "")} onClick={() => onSave(batch.id)}>Save cost</Button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CostHistory({ batchResult, sellingPrice }: { batchResult: StaffInventoryBatchResult | null; sellingPrice: number }) {
  if (!batchResult) return null;
  const { summary, batches } = batchResult;
  return (
    <details className="mt-5 rounded-lg border bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm font-bold text-primary">Cost history ({batches.length} {batches.length === 1 ? "delivery" : "deliveries"})</summary>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs font-bold text-muted-foreground">Latest unit cost</dt><dd className="mt-0.5 font-extrabold">{summary.latestCost === null ? "Not recorded" : formatPhp(summary.latestCost)}</dd></div>
        <div><dt className="text-xs font-bold text-muted-foreground">Average unit cost</dt><dd className="mt-0.5 font-extrabold">{summary.averageInventoryCost === null ? "—" : formatPhp(summary.averageInventoryCost)}</dd></div>
        <div><dt className="text-xs font-bold text-muted-foreground">Stock value at cost</dt><dd className="mt-0.5 font-extrabold">{formatPhp(summary.inventoryValue)}</dd></div>
      </dl>
      {batches.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-muted-foreground"><tr><th className="py-2 pr-3">Item</th><th className="py-2 pr-3">Date received</th><th className="py-2 pr-3">Unit cost</th><th className="py-2 pr-3">Qty received</th><th className="py-2 pr-3">Qty remaining</th><th className="py-2">Margin / unit</th></tr></thead>
            <tbody className="divide-y divide-border">
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <td className="py-2 pr-3 font-bold">{batch.sku?.optionSnapshot?.map((option) => option.optionValue).join(" / ") || "All units"}</td>
                  <td className="py-2 pr-3">{new Date(batch.receivedAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</td>
                  <td className="py-2 pr-3">{batch.costVerified ? formatPhp(Number(batch.unitCost)) : "Not recorded"}</td>
                  <td className="py-2 pr-3">{batch.quantityReceived}</td>
                  <td className="py-2 pr-3 font-bold">{batch.quantityRemaining}</td>
                  <td className="py-2 font-bold text-primary">{batch.costVerified ? formatPhp(sellingPrice - Number(batch.unitCost)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-muted-foreground">Each delivery keeps its own unit cost. Sales use the oldest delivery first, so reported profit reflects what was actually paid.</p>
    </details>
  );
}

export function SellingPriceFields({
  currentPrice,
  oldPrice,
  value,
  onChange,
  latestCost
}: {
  currentPrice: number;
  oldPrice: number | null;
  value: string;
  onChange: (value: string) => void;
  latestCost: number | null;
}) {
  const entered = isMoneyInput(value) ? Number(value) : null;
  return (
    <div className="mt-5 grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-surface-subtle px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Current selling price</p>
          <p className="mt-1 text-lg font-extrabold">{currentPrice > 0 ? formatPhp(currentPrice) : "Not set"}</p>
        </div>
        <MoneyInput label="New selling price" value={value} onChange={onChange} autoFocus />
      </div>
      {oldPrice !== null ? <p className="text-xs leading-5 text-muted-foreground">This item is on sale from {formatPhp(oldPrice)}. The new price must stay below that amount, or remove the sale price under Manage &gt; Edit details.</p> : null}
      {entered !== null ? <MarginNote price={entered} unitCost={latestCost} priceLabel="the new price" /> : null}
    </div>
  );
}

export function ReorderAlertSelect({
  value,
  onChange,
  stockLevel,
  label = "Reorder alert"
}: {
  value: number;
  onChange: (value: number) => void;
  stockLevel: number;
  label?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      {label}
      <select aria-label={label} value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-11 w-full min-w-0 rounded-md border bg-white px-3 font-normal outline-none focus:border-primary">
        {REORDER_ALERT_PERCENTS.map((percent) => (
          <option key={percent} value={percent}>
            {percent}% of stock level{stockLevel > 0 ? ` — alert at ${reorderAlertQuantity(stockLevel, percent)} units` : ""}{percent === 25 ? " (recommended)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
