"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, Minus, Plus, Printer, ReceiptText, RefreshCw, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { useRealtimeRefresh } from "@/components/realtime/RealtimeProvider";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAccessibleDialog } from "@/components/ui/useAccessibleDialog";
import {
  BackendApiError,
  getOperationalStudentsFromApi,
  isRequestAbortError,
  type BackendOperationalStudent
} from "@/lib/api";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { VoidDialogDetails, VoidWindowBadge } from "@/components/staff/VoidWindowParts";
import { voidWindowState } from "@/lib/void-window";
import {
  getStaffProductsPage,
  getStoredStaffSession,
  listWalkInSales,
  recordWalkInSale,
  voidWalkInSale,
  type StaffCategory,
  type StaffProduct,
  type WalkInCollectionChannel,
  type WalkInReceipt,
  type WalkInSalePayload
} from "@/lib/staff-api";
import {
  buildThermalReceiptDocument,
  DEFAULT_THERMAL_PRINTER_SETTINGS,
  defaultPrintableWidthMm,
  loadThermalPrinterSettings,
  normalizeThermalPrinterSettings,
  printThermalDocument,
  printThermalReceipt,
  sampleThermalReceipt,
  saveThermalPrinterSettings,
  THERMAL_CUSTOM_PAPER_WIDTH,
  THERMAL_MIN_PRINTABLE_WIDTH,
  THERMAL_PAPER_PRESETS,
  thermalReceiptFromWalkIn,
  thermalReceiptLogoUrl,
  type ThermalPaperPreset,
  type ThermalPrinterSettings
} from "@/lib/thermal-receipt";
import {
  backendReceiptStatusFilter,
  mergeUniqueById,
  Notice,
  PageHeading,
  Toolbar,
  formatStaffReceiptDate
} from "@/components/staff/StaffOperationsShared";
import { FeedbackState } from "@/components/ui/FeedbackState";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { Skeleton } from "@/components/ui/Skeleton";
import { resolveShopProductAsset, shopProductCardImage } from "@/lib/shop-assets";
import { cn } from "@/lib/utils";

type CartRow = {
  key: string;
  product: StaffProduct;
  skuId: string;
  variantId: string;
  quantity: string;
};

type StockFilter = "ALL" | "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

let cartRowSequence = 0;
function nextCartRowKey() {
  cartRowSequence += 1;
  return `cart-${Date.now()}-${cartRowSequence}`;
}

function createClientSaleId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sale-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function formatPeso(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parsePeso(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}

function rowStock(row: CartRow) {
  if (row.product.skuInventoryEnabled) {
    const sku = row.product.skus?.find((entry) => entry.id === row.skuId);
    return sku ? sku.stock : null;
  }
  if (row.product.variants?.length) {
    const variant = row.product.variants.find((entry) => entry.id === row.variantId);
    return variant ? variant.stock : null;
  }
  return row.product.stock;
}

function rowLineTotal(row: CartRow) {
  const quantity = Number.parseInt(row.quantity, 10);
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.round(Number(row.product.price) * quantity * 100) / 100;
}

function productSellableStock(product: StaffProduct) {
  if (product.skuInventoryEnabled) {
    return (product.skus ?? []).reduce((total, sku) => total + sku.stock, 0);
  }
  if (product.variants?.length) {
    return (product.variants ?? []).reduce((total, variant) => total + variant.stock, 0);
  }
  return product.stock;
}

function productIsLowStock(product: StaffProduct) {
  if (product.skuInventoryEnabled) {
    return (product.skus ?? []).some((sku) => sku.stock > 0 && sku.stock <= sku.lowStockThreshold);
  }
  if (product.variants?.length) {
    return (product.variants ?? []).some((variant) => variant.stock > 0 && variant.stock <= variant.lowStockThreshold);
  }
  return product.stock > 0 && product.stock <= product.lowStockThreshold;
}

function productIsOutOfStock(product: StaffProduct) {
  return productSellableStock(product) <= 0;
}

function matchesStockFilter(product: StaffProduct, filter: StockFilter) {
  if (filter === "ALL") return true;
  if (filter === "OUT_OF_STOCK") return productIsOutOfStock(product);
  if (filter === "IN_STOCK") return !productIsOutOfStock(product);
  return productIsLowStock(product);
}

function ProductSkuPickerModal({
  product,
  onClose,
  onAdd
}: {
  product: StaffProduct;
  onClose: () => void;
  onAdd: (skuId: string, quantity: number) => void;
}) {
  const { dialogRef, titleId, dialogProps } = useAccessibleDialog<HTMLDivElement>(true, onClose);
  const optionGroups = useMemo(() => {
    const groups: Array<{ name: string; values: string[] }> = [];
    for (const sku of product.skus ?? []) {
      for (const option of sku.options) {
        const group = groups.find((entry) => entry.name === option.optionName);
        if (group) {
          if (!group.values.includes(option.optionValue)) group.values.push(option.optionValue);
        } else {
          groups.push({ name: option.optionName, values: [option.optionValue] });
        }
      }
    }
    return groups;
  }, [product.skus]);

  const [selections, setSelections] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const group of optionGroups) {
      if (group.values.length === 1) initial[group.name] = group.values[0];
    }
    return initial;
  });
  const [quantity, setQuantity] = useState("1");

  const matchedSku = useMemo(() => {
    if (!optionGroups.length) return null;
    if (optionGroups.some((group) => !selections[group.name])) return null;
    return (product.skus ?? []).find((sku) => (
      sku.options.length === optionGroups.length
      && optionGroups.every((group) => (
        sku.options.some((option) => option.optionName === group.name && option.optionValue === selections[group.name])
      ))
    )) ?? null;
  }, [optionGroups, product.skus, selections]);

  const optionIsAvailable = (groupName: string, optionValue: string) => (
    (product.skus ?? []).some((sku) => (
      sku.stock > 0
      && sku.options.some((option) => option.optionName === groupName && option.optionValue === optionValue)
      && optionGroups.every((group) => {
        if (group.name === groupName) return true;
        const selectedValue = selections[group.name];
        return !selectedValue || sku.options.some((option) => option.optionName === group.name && option.optionValue === selectedValue);
      })
    ))
  );

  const availableStock = matchedSku?.stock ?? 0;
  const quantityValue = Number.parseInt(quantity, 10);
  const quantityValid = Number.isFinite(quantityValue) && quantityValue > 0 && quantityValue <= availableStock;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div ref={dialogRef} {...dialogProps} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 id={titleId} className="text-xl font-extrabold text-foreground">{product.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Choose the available combination.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-surface-subtle">
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {optionGroups.map((group) => (
            <label key={group.name} className="grid gap-1.5 text-sm font-semibold">
              {group.name}
              <select
                value={selections[group.name] ?? ""}
                onChange={(event) => setSelections((current) => ({ ...current, [group.name]: event.target.value }))}
                className="h-11 rounded-md border border-border-strong bg-white px-3 font-normal outline-none focus:border-primary"
              >
                <option value="">Choose {group.name.toLowerCase()}</option>
                {group.values.map((value) => (
                  <option key={value} value={value} disabled={!optionIsAvailable(group.name, value)}>{value}</option>
                ))}
              </select>
            </label>
          ))}

          <div className="rounded-lg border bg-surface-subtle p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Available stock</span>
              <span className="font-extrabold">{matchedSku ? `${availableStock} pc(s)` : "\u2014"}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Price</span>
              <span className="font-extrabold text-primary">{formatPeso(Number(product.price))}</span>
            </div>
          </div>

          <label className="grid gap-1.5 text-sm font-semibold">
            Quantity
            <input
              type="number"
              min="1"
              max={Math.max(1, availableStock)}
              step="1"
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="h-11 rounded-md border border-border-strong bg-white px-3 font-normal outline-none focus:border-primary"
            />
          </label>
          {matchedSku && availableStock <= 0 ? (
            <p className="text-xs font-semibold text-danger">This combination is out of stock.</p>
          ) : null}
          {matchedSku && quantityValue > availableStock ? (
            <p className="text-xs font-semibold text-danger">Only {availableStock} pc(s) available for this combination.</p>
          ) : null}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            data-dialog-autofocus
            disabled={!matchedSku || !quantityValid}
            onClick={() => matchedSku && quantityValid && onAdd(matchedSku.id, quantityValue)}
          >
            Add to sale
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProductVariantPickerModal({
  product,
  onClose,
  onAdd
}: {
  product: StaffProduct;
  onClose: () => void;
  onAdd: (variantId: string, quantity: number) => void;
}) {
  const { dialogRef, titleId, dialogProps } = useAccessibleDialog<HTMLDivElement>(true, onClose);
  const variants = (product.variants ?? []).filter((variant) => Boolean(variant.id));
  const [variantId, setVariantId] = useState(() => (variants.length === 1 ? variants[0].id ?? "" : ""));
  const [quantity, setQuantity] = useState("1");
  const selectedVariant = variants.find((variant) => variant.id === variantId) ?? null;
  const availableStock = selectedVariant?.stock ?? 0;
  const quantityValue = Number.parseInt(quantity, 10);
  const quantityValid = Number.isFinite(quantityValue) && quantityValue > 0 && quantityValue <= availableStock;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div ref={dialogRef} {...dialogProps} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 id={titleId} className="text-xl font-extrabold text-foreground">{product.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Choose the size or option.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-surface-subtle">
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="grid gap-1.5 text-sm font-semibold">
            Option
            <select
              value={variantId}
              onChange={(event) => setVariantId(event.target.value)}
              className="h-11 rounded-md border border-border-strong bg-white px-3 font-normal outline-none focus:border-primary"
            >
              <option value="">Choose an option</option>
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id} disabled={variant.stock <= 0}>
                  {variant.optionValue} — {variant.stock} pc(s)
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-lg border bg-surface-subtle p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Available stock</span>
              <span className="font-extrabold">{selectedVariant ? `${availableStock} pc(s)` : "\u2014"}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Price</span>
              <span className="font-extrabold text-primary">{formatPeso(Number(product.price))}</span>
            </div>
          </div>

          <label className="grid gap-1.5 text-sm font-semibold">
            Quantity
            <input
              type="number"
              min="1"
              max={Math.max(1, availableStock)}
              step="1"
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="h-11 rounded-md border border-border-strong bg-white px-3 font-normal outline-none focus:border-primary"
            />
          </label>
          {selectedVariant && quantityValue > availableStock ? (
            <p className="text-xs font-semibold text-danger">Only {availableStock} pc(s) available for this option.</p>
          ) : null}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            data-dialog-autofocus
            disabled={!selectedVariant?.id || !quantityValid}
            onClick={() => selectedVariant?.id && quantityValid && onAdd(selectedVariant.id, quantityValue)}
          >
            Add to sale
          </Button>
        </div>
      </div>
    </div>
  );
}

function VoidWalkInSaleModal({
  receipt,
  submitting,
  reason,
  role,
  onReasonChange,
  onClose,
  onConfirm
}: {
  receipt: WalkInReceipt | null;
  submitting: boolean;
  reason: string;
  role?: string | null;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { dialogRef, titleId, dialogProps } = useAccessibleDialog<HTMLDivElement>(Boolean(receipt), onClose);
  if (!receipt) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div ref={dialogRef} {...dialogProps} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 id={titleId} className="text-xl font-extrabold text-foreground">Void walk-in sale</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-surface-subtle">
            <X className="size-5" />
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Voiding <span className="font-bold text-foreground">{receipt.receiptCode}</span> returns every item back to inventory
          and marks the receipt voided. This cannot be undone.
        </p>
        {receipt.collectionChannel === "TREASURER" ? (
          <InlineAlert tone="warning" title="Treasury payment is not refunded here" className="mt-3">
            <p>
              This sale was paid at the Treasury (OR {receipt.officialReceiptNumber}). Voiding restores stock only.
              Coordinate any refund with the Treasury; admins will be notified to reconcile it.
            </p>
          </InlineAlert>
        ) : null}
        <VoidDialogDetails state={voidWindowState(receipt.voidableUntil, role)} reason={reason} onReasonChange={onReasonChange} />
        <label className="mt-4 grid gap-1.5 text-sm font-semibold">
          Reason (required)
          <textarea
            data-dialog-autofocus
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            maxLength={300}
            rows={3}
            placeholder="e.g. Wrong item handed, payment did not push through"
            className="rounded-md border border-border-strong px-3 py-2 outline-none focus:border-primary"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            variant="destructive"
            disabled={submitting || reason.trim().length < 5}
            loading={submitting}
            onClick={onConfirm}
          >
            Void & restore stock
          </Button>
        </div>
      </div>
    </div>
  );
}

function collectionLabel(receipt: WalkInReceipt) {
  return receipt.collectionChannel === "TREASURER" ? "Treasury" : "Commissary cash";
}

function SaleSuccessModal({
  receipt,
  printing,
  printed,
  printError,
  onPrint,
  onClose
}: {
  receipt: WalkInReceipt | null;
  printing: boolean;
  printed: boolean;
  printError: string;
  onPrint: () => void;
  onClose: () => void;
}) {
  const { dialogRef, titleId, dialogProps } = useAccessibleDialog<HTMLDivElement>(Boolean(receipt), onClose);
  if (!receipt) return null;
  const total = Number(receipt.totalAmount);
  const treasury = receipt.collectionChannel === "TREASURER";
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div ref={dialogRef} {...dialogProps} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-success/10 text-success">
            <Check className="size-6" />
          </span>
          <div>
            <h2 id={titleId} className="text-xl font-extrabold text-foreground">Sale recorded</h2>
            <p className="text-sm text-muted-foreground">Stock has been deducted and the receipt is verified.</p>
          </div>
        </div>
        <div className="mt-5 rounded-lg border bg-surface-subtle p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Receipt code</span>
            <span className="font-extrabold">{receipt.receiptCode}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Buyer</span>
            <span className="font-bold">{receipt.buyerName}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-extrabold text-primary">{formatPeso(total)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Paid at</span>
            <span className="font-bold">{collectionLabel(receipt)}</span>
          </div>
          {treasury ? (
            <div className="mt-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Treasury OR No.</span>
              <span className="break-all text-right font-extrabold">{receipt.officialReceiptNumber}</span>
            </div>
          ) : (
            <>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Cash received</span>
                <span className="font-bold">{formatPeso(Number(receipt.sale?.cashTendered ?? 0))}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Change</span>
                <span className="font-extrabold">{formatPeso(Number(receipt.sale?.changeDue ?? 0))}</span>
              </div>
            </>
          )}
        </div>
        {printError ? <InlineAlert className="mt-4">{printError}</InlineAlert> : null}
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button type="button" size="lg" data-dialog-autofocus disabled={printing} loading={printing} onClick={onPrint}>
            <Printer className="size-4" aria-hidden="true" />
            {printed ? "Print again" : "Print receipt"}
          </Button>
          <Button type="button" size="lg" variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

function ThermalPrinterSettingsModal({
  open,
  settings,
  onClose,
  onSave
}: {
  open: boolean;
  settings: ThermalPrinterSettings;
  onClose: () => void;
  onSave: (settings: ThermalPrinterSettings) => void;
}) {
  const { dialogRef, titleId, dialogProps } = useAccessibleDialog<HTMLDivElement>(open, onClose);
  const [preset, setPreset] = useState<ThermalPaperPreset>(settings.preset);
  const [customPaper, setCustomPaper] = useState(String(settings.paperWidthMm));
  const [customPrintable, setCustomPrintable] = useState(String(settings.printableWidthMm));
  const [previewHtml, setPreviewHtml] = useState("");
  const [testPrinting, setTestPrinting] = useState(false);
  const [testError, setTestError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPreset(settings.preset);
    setCustomPaper(String(settings.paperWidthMm));
    setCustomPrintable(String(settings.printableWidthMm));
    setTestError("");
  }, [open, settings]);

  const customPaperValue = Number.parseFloat(customPaper);
  const customPrintableValue = Number.parseFloat(customPrintable);
  const customValid = Number.isFinite(customPaperValue)
    && customPaperValue >= THERMAL_CUSTOM_PAPER_WIDTH.min
    && customPaperValue <= THERMAL_CUSTOM_PAPER_WIDTH.max
    && Number.isFinite(customPrintableValue)
    && customPrintableValue >= THERMAL_MIN_PRINTABLE_WIDTH
    && customPrintableValue <= customPaperValue;
  const draft = normalizeThermalPrinterSettings(preset === "CUSTOM"
    ? { preset, paperWidthMm: customPaperValue, printableWidthMm: customPrintableValue }
    : { preset });
  const draftValid = preset !== "CUSTOM" || customValid;

  useEffect(() => {
    if (!open || !draftValid) return;
    let cancelled = false;
    void buildThermalReceiptDocument(sampleThermalReceipt(window.location.origin), {
      settings: draft,
      copy: "TEST",
      logoUrl: thermalReceiptLogoUrl()
    }).then((html) => {
      if (!cancelled) setPreviewHtml(html);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftValid, draft.paperWidthMm, draft.printableWidthMm]);

  if (!open) return null;

  const printTest = async () => {
    if (!draftValid) return;
    setTestPrinting(true);
    setTestError("");
    try {
      const html = await buildThermalReceiptDocument(sampleThermalReceipt(window.location.origin), {
        settings: draft,
        copy: "TEST",
        logoUrl: thermalReceiptLogoUrl()
      });
      await printThermalDocument(html, draft);
    } catch {
      setTestError("The test receipt could not be opened for printing. Try again.");
    } finally {
      setTestPrinting(false);
    }
  };

  const presetOptions: Array<{ value: ThermalPaperPreset; label: string; detail: string }> = [
    { value: "58", label: "58 mm", detail: `Prints ${THERMAL_PAPER_PRESETS["58"].printableWidthMm} mm wide. Safe default.` },
    { value: "80", label: "80 mm", detail: `Prints ${THERMAL_PAPER_PRESETS["80"].printableWidthMm} mm wide.` },
    { value: "CUSTOM", label: "Custom", detail: `${THERMAL_CUSTOM_PAPER_WIDTH.min} to ${THERMAL_CUSTOM_PAPER_WIDTH.max} mm paper.` }
  ];

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div ref={dialogRef} {...dialogProps} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-xl font-extrabold text-foreground">Receipt printer</h2>
            <p className="mt-1 text-sm text-muted-foreground">Saved on this computer only. Match the paper roll in this printer.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-surface-subtle">
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-4">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-semibold">Paper width</legend>
              {presetOptions.map((option) => (
                <label key={option.value} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors", preset === option.value ? "border-primary bg-primary/5" : "hover:border-primary/40")}>
                  <input
                    type="radio"
                    name="thermal-paper-width"
                    value={option.value}
                    checked={preset === option.value}
                    onChange={() => setPreset(option.value)}
                    className="mt-1 accent-primary"
                  />
                  <span>
                    <span className="block font-bold">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">{option.detail}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {preset === "CUSTOM" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-semibold">
                  Paper width (mm)
                  <input
                    type="number"
                    min={THERMAL_CUSTOM_PAPER_WIDTH.min}
                    max={THERMAL_CUSTOM_PAPER_WIDTH.max}
                    step="0.5"
                    inputMode="decimal"
                    value={customPaper}
                    onChange={(event) => {
                      setCustomPaper(event.target.value);
                      const paper = Number.parseFloat(event.target.value);
                      if (Number.isFinite(paper)) setCustomPrintable(String(defaultPrintableWidthMm(paper)));
                    }}
                    className="h-11 rounded-md border border-border-strong bg-white px-3 font-normal outline-none focus:border-primary"
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold">
                  Printable width (mm)
                  <input
                    type="number"
                    min={THERMAL_MIN_PRINTABLE_WIDTH}
                    max={Number.isFinite(customPaperValue) ? customPaperValue : THERMAL_CUSTOM_PAPER_WIDTH.max}
                    step="0.5"
                    inputMode="decimal"
                    value={customPrintable}
                    onChange={(event) => setCustomPrintable(event.target.value)}
                    className="h-11 rounded-md border border-border-strong bg-white px-3 font-normal outline-none focus:border-primary"
                  />
                </label>
                {!customValid ? (
                  <p className="text-xs font-semibold text-danger sm:col-span-2">
                    Use {THERMAL_CUSTOM_PAPER_WIDTH.min} to {THERMAL_CUSTOM_PAPER_WIDTH.max} mm paper, with a printable width of at least {THERMAL_MIN_PRINTABLE_WIDTH} mm and no wider than the paper.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-lg border bg-surface-subtle p-3 text-xs leading-5 text-muted-foreground">
              <p className="font-bold text-foreground">In the print dialog, set once per computer:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>Printer: the thermal receipt printer</li>
                <li>Paper size in the printer driver: the same roll width</li>
                <li>Margins: None. Headers and footers: off</li>
                <li>Scale: 100% (Default), not &quot;Fit to page&quot;</li>
              </ul>
              <p className="mt-2">Print a test receipt and check that both edge marks and the QR code print fully.</p>
            </div>

            {testError ? <InlineAlert>{testError}</InlineAlert> : null}
          </div>

          <div className="flex flex-col items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Preview</span>
            <div className="max-h-[28rem] overflow-y-auto rounded-md border bg-surface-subtle p-2">
              {previewHtml && draftValid ? (
                <iframe
                  title="Test receipt preview"
                  srcDoc={previewHtml}
                  className="block border-0 bg-white"
                  style={{ width: `${draft.paperWidthMm}mm`, height: "150mm" }}
                />
              ) : (
                <div className="grid h-40 w-48 place-items-center text-xs text-muted-foreground">No preview</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="secondary" disabled={!draftValid || testPrinting} loading={testPrinting} onClick={() => void printTest()}>
            <Printer className="size-4" aria-hidden="true" />
            Print test receipt
          </Button>
          <Button type="button" disabled={!draftValid} onClick={() => onSave(draft)}>
            Save printer setting
          </Button>
        </div>
      </div>
    </div>
  );
}

const CATALOG_PAGE_SIZE = 24;

export function StaffWalkInSalesExperience() {
  const [token, setToken] = useState("");
  const [cart, setCart] = useState<CartRow[]>([]);
  const [catalog, setCatalog] = useState<StaffProduct[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogCategories, setCatalogCategories] = useState<StaffCategory[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("ALL");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogNextCursor, setCatalogNextCursor] = useState<string | null>(null);
  const [skuPickerProduct, setSkuPickerProduct] = useState<StaffProduct | null>(null);
  const [variantPickerProduct, setVariantPickerProduct] = useState<StaffProduct | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [stockConflict, setStockConflict] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [studentResults, setStudentResults] = useState<BackendOperationalStudent[]>([]);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentError, setStudentError] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<BackendOperationalStudent | null>(null);
  const [receiptCode, setReceiptCode] = useState("");
  const [collectionChannel, setCollectionChannel] = useState<WalkInCollectionChannel>("COMMISSARY");
  const [cashReceived, setCashReceived] = useState("");
  const [officialReceiptNumber, setOfficialReceiptNumber] = useState("");
  const [treasuryInspected, setTreasuryInspected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saleError, setSaleError] = useState("");
  const [successReceipt, setSuccessReceipt] = useState<WalkInReceipt | null>(null);
  const [printerSettings, setPrinterSettings] = useState<ThermalPrinterSettings>(DEFAULT_THERMAL_PRINTER_SETTINGS);
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);
  const [printingReceiptId, setPrintingReceiptId] = useState<string | null>(null);
  const [printError, setPrintError] = useState("");
  const [printedReceiptIds, setPrintedReceiptIds] = useState<ReadonlySet<string>>(() => new Set());

  const [history, setHistory] = useState<WalkInReceipt[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("All");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<WalkInReceipt | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeView, setActiveView] = useState<"SALE" | "HISTORY">("SALE");

  const deferredHistorySearch = useDeferredValue(historySearch);
  const deferredCatalogSearch = useDeferredValue(catalogSearch);
  const historyRequestRef = useRef(0);
  const historyAbortRef = useRef<AbortController | null>(null);
  const catalogRequestRef = useRef(0);
  const catalogAbortRef = useRef<AbortController | null>(null);
  const studentRequestRef = useRef(0);
  const studentAbortRef = useRef<AbortController | null>(null);
  const clientSaleIdRef = useRef(createClientSaleId());
  const { ready, user } = useStudentAuth();

  useEffect(() => {
    setPrinterSettings(loadThermalPrinterSettings());
  }, []);

  const printReceipt = async (receipt: WalkInReceipt, options: { reprint: boolean }) => {
    setPrintingReceiptId(receipt.id);
    setPrintError("");
    try {
      await printThermalReceipt(thermalReceiptFromWalkIn(receipt), {
        settings: printerSettings,
        copy: options.reprint ? "REPRINT" : "ORIGINAL"
      });
      setPrintedReceiptIds((current) => new Set(current).add(receipt.id));
    } catch {
      setPrintError("The receipt could not be opened for printing. Try again, or check the receipt printer setting.");
    } finally {
      setPrintingReceiptId(null);
    }
  };

  useEffect(() => {
    if (!ready) return;
    const authenticatedToken = user?.role === "STAFF" || user?.role === "ADMIN"
      ? user.accessToken ?? ""
      : "";
    setToken(authenticatedToken || getStoredStaffSession().token);
  }, [ready, user?.accessToken, user?.role]);

  const loadCatalog = useCallback(async (options: { cursor?: string | null; background?: boolean } = {}) => {
    const sessionToken = token || getStoredStaffSession().token;
    if (!sessionToken) {
      setCatalogLoading(false);
      return;
    }
    const requestId = ++catalogRequestRef.current;
    catalogAbortRef.current?.abort();
    const controller = new AbortController();
    catalogAbortRef.current = controller;
    if (options.cursor) setCatalogLoadingMore(true);
    else if (!options.background) {
      setCatalogLoading(true);
      setCatalogError("");
    }
    try {
      const page = await getStaffProductsPage(sessionToken, {
        limit: CATALOG_PAGE_SIZE,
        cursor: options.cursor ?? undefined,
        query: deferredCatalogSearch.trim() || undefined,
        categoryId: activeCategoryId || undefined,
        status: stockFilter === "OUT_OF_STOCK" ? "OUT_OF_STOCK" : undefined,
        includeCategories: !options.cursor ? true : undefined,
        signal: controller.signal
      });
      if (requestId !== catalogRequestRef.current) return;
      setCatalog((current) => (options.cursor ? [...current, ...page.products] : page.products));
      const refreshedProducts = new Map(page.products.map((product) => [product.id, product]));
      setCart((current) => current.map((row) => {
        const refreshed = refreshedProducts.get(row.product.id);
        return refreshed ? { ...row, product: refreshed } : row;
      }));
      setCatalogNextCursor(page.nextCursor);
      if (page.categories) setCatalogCategories(page.categories);
    } catch (loadError) {
      if (requestId !== catalogRequestRef.current || isRequestAbortError(loadError)) return;
      setCatalogError(userFacingErrorMessage(loadError, "Unable to load the product catalog."));
    } finally {
      if (requestId === catalogRequestRef.current) {
        setCatalogLoading(false);
        setCatalogLoadingMore(false);
      }
    }
  }, [activeCategoryId, deferredCatalogSearch, stockFilter, token]);

  const refreshCartInventory = useCallback(async () => {
    const sessionToken = token || getStoredStaffSession().token;
    if (!sessionToken || !cart.length) return;
    const productIds = Array.from(new Set(cart.map((row) => row.product.id)));
    const pages = await Promise.all(productIds.map((productId) => getStaffProductsPage(sessionToken, {
      limit: 1,
      productId
    })));
    const refreshedProducts = new Map(pages.flatMap((page) => page.products).map((product) => [product.id, product]));
    setCart((current) => current.map((row) => {
      const refreshed = refreshedProducts.get(row.product.id);
      return refreshed ? { ...row, product: refreshed } : row;
    }));
  }, [cart, token]);

  useRealtimeRefresh(["inventory"], () => {
    void loadCatalog({ background: true });
  });

  useEffect(() => {
    if (!ready) return;
    void loadCatalog();
    return () => catalogAbortRef.current?.abort();
  }, [ready, loadCatalog]);

  const visibleCatalog = useMemo(() => (
    stockFilter === "IN_STOCK" || stockFilter === "LOW_STOCK"
      ? catalog.filter((product) => matchesStockFilter(product, stockFilter))
      : catalog
  ), [catalog, stockFilter]);

  const loadHistory = async (options: { cursor?: string | null; background?: boolean } = {}) => {
    const sessionToken = token || getStoredStaffSession().token;
    if (!sessionToken) {
      setHistoryLoading(false);
      return;
    }
    const requestId = ++historyRequestRef.current;
    historyAbortRef.current?.abort();
    const controller = new AbortController();
    historyAbortRef.current = controller;
    if (options.cursor) setHistoryLoadingMore(true);
    else if (!options.background) {
      setHistoryLoading(true);
      setHistoryError("");
    }
    try {
      const page = await listWalkInSales(sessionToken, {
        limit: 20,
        cursor: options.cursor,
        query: deferredHistorySearch,
        status: backendReceiptStatusFilter(historyStatus),
        signal: controller.signal
      });
      if (requestId !== historyRequestRef.current) return;
      setHistory((current) => {
        const source = options.cursor ? [...current, ...page.items] : page.items;
        return mergeUniqueById(source);
      });
      setHistoryNextCursor(page.nextCursor);
    } catch (loadError) {
      if (requestId !== historyRequestRef.current || isRequestAbortError(loadError)) return;
      setHistoryError(userFacingErrorMessage(loadError, "Unable to load walk-in sales."));
    } finally {
      if (requestId === historyRequestRef.current) {
        setHistoryLoading(false);
        setHistoryLoadingMore(false);
      }
    }
  };

  useRealtimeRefresh(["receipts"], () => {
    void loadHistory({ background: true });
  });

  useEffect(() => {
    if (!ready) return;
    void loadHistory();
    return () => historyAbortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, deferredHistorySearch, historyStatus, token]);

  useEffect(() => {
    if (studentSearch.trim().length < 2) {
      studentRequestRef.current += 1;
      studentAbortRef.current?.abort();
      setStudentResults([]);
      setStudentLoading(false);
      setStudentError("");
      return;
    }
    const sessionToken = token || getStoredStaffSession().token;
    if (!sessionToken) {
      setStudentError("A staff session is required to search students.");
      return;
    }
    const requestId = ++studentRequestRef.current;
    studentAbortRef.current?.abort();
    const controller = new AbortController();
    studentAbortRef.current = controller;
    setStudentLoading(true);
    setStudentError("");
    const timer = window.setTimeout(async () => {
      try {
        const page = await getOperationalStudentsFromApi(sessionToken, {
          limit: 8,
          query: studentSearch,
          signal: controller.signal
        });
        if (requestId !== studentRequestRef.current) return;
        setStudentResults(page.items);
        setStudentPickerOpen(true);
      } catch (searchError) {
        if (!isRequestAbortError(searchError)) {
          setStudentResults([]);
          setStudentError(userFacingErrorMessage(searchError, "Unable to search students."));
        }
      } finally {
        if (requestId === studentRequestRef.current) setStudentLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [studentSearch, token]);

  const addProductToCart = (product: StaffProduct, skuId: string, variantId: string, quantity: number) => {
    setCart((current) => {
      const existing = current.find((row) => (
        row.product.id === product.id && row.skuId === skuId && row.variantId === variantId
      ));
      if (existing) {
        const parsedQuantity = Number.parseInt(existing.quantity, 10);
        const existingQuantity = Number.isFinite(parsedQuantity) ? parsedQuantity : 0;
        const stock = rowStock(existing);
        const nextQuantity = stock === null
          ? existingQuantity + quantity
          : Math.min(stock, existingQuantity + quantity);
        return current.map((row) => row.key === existing.key
          ? { ...row, quantity: String(nextQuantity) }
          : row);
      }
      return [...current, {
        key: nextCartRowKey(),
        product,
        skuId,
        variantId,
        quantity: String(Math.max(1, quantity))
      }];
    });
    setConfirmClear(false);
  };

  const handleProductClick = (product: StaffProduct) => {
    if (productIsOutOfStock(product) || Number(product.price) <= 0) return;
    if (product.skuInventoryEnabled) {
      setSkuPickerProduct(product);
      return;
    }
    if (product.variants?.length) {
      setVariantPickerProduct(product);
      return;
    }
    addProductToCart(product, "", "", 1);
  };

  const updateCartRow = (key: string, update: Partial<Omit<CartRow, "key" | "product">>) => {
    setCart((current) => current.map((row) => row.key === key ? { ...row, ...update } : row));
  };

  const adjustCartRowQuantity = (row: CartRow, delta: number) => {
    const quantity = Number.parseInt(row.quantity, 10);
    const stock = rowStock(row);
    const next = Number.isFinite(quantity) ? Math.max(1, quantity + delta) : 1;
    updateCartRow(row.key, { quantity: String(stock === null ? next : Math.min(stock, next)) });
  };

  const removeCartRow = (key: string) => {
    setCart((current) => current.filter((row) => row.key !== key));
  };

  const clearCart = () => {
    setCart([]);
    setConfirmClear(false);
    setStockConflict("");
  };

  const cartValid = cart.length > 0
    && cart.every((row) => {
      const quantity = Number.parseInt(row.quantity, 10);
      if (!Number.isFinite(quantity) || quantity <= 0) return false;
      const stock = rowStock(row);
      if ((row.product.skuInventoryEnabled || row.product.variants?.length) && stock === null) return false;
      if (stock !== null && quantity > stock) return false;
      if (row.product.skuInventoryEnabled) return Boolean(row.skuId);
      if (row.product.variants?.length) return Boolean(row.variantId);
      return true;
    });

  const cartTotal = Math.round(cart.reduce((total, row) => total + rowLineTotal(row), 0) * 100) / 100;
  const buyerName = selectedStudent?.fullName ?? studentSearch.trim().replace(/\s+/g, " ");
  const buyerNameValid = buyerName.length >= 2 && buyerName.length <= 120;
  const treasurySale = collectionChannel === "TREASURER";
  const cashReceivedValue = parsePeso(cashReceived);
  const cashValid = cashReceivedValue !== null && cashReceivedValue >= cartTotal;
  const changeDue = cashReceivedValue !== null && cashValid
    ? Math.round((cashReceivedValue - cartTotal) * 100) / 100
    : null;
  const officialReceiptNumberValue = officialReceiptNumber.trim().replace(/\s+/g, " ");
  const treasuryValid = officialReceiptNumberValue.length > 0 && treasuryInspected;
  const paymentValid = treasurySale ? treasuryValid : cashValid;
  const quickCashAmounts = Array.from(new Set([
    cartTotal,
    Math.ceil(cartTotal / 100) * 100,
    500,
    1000
  ])).filter((amount) => amount >= cartTotal && amount > 0).slice(0, 4);

  const recordSale = async () => {
    if (!cart.length) {
      setSaleError("Add at least one product to the current sale.");
      return;
    }
    if (!cartValid) {
      setSaleError("Review the product options, quantities, and available stock before saving.");
      return;
    }
    if (!buyerNameValid) {
      setSaleError("Enter the walk-in buyer's name before saving.");
      return;
    }
    if (treasurySale && !officialReceiptNumberValue) {
      setSaleError("Enter the Treasury OR number before saving.");
      return;
    }
    if (treasurySale && !treasuryInspected) {
      setSaleError("Confirm that you inspected the Treasury official receipt before releasing items.");
      return;
    }
    if (!treasurySale && !cashValid) {
      setSaleError("Enter a cash amount that covers the sale total.");
      return;
    }
    setSubmitting(true);
    setSaleError("");
    setStockConflict("");
    const sessionToken = token || getStoredStaffSession().token;
    if (!sessionToken) {
      setSaleError("Your staff session has expired. Refresh the page and sign in again.");
      setSubmitting(false);
      return;
    }
    try {
      const sale = {
        items: cart.map((row) => ({
          productId: row.product.id,
          skuId: row.skuId || undefined,
          variantId: row.variantId || undefined,
          quantity: Number.parseInt(row.quantity, 10)
        })),
        buyerName,
        studentId: selectedStudent?.id,
        receiptCode: receiptCode.trim() || undefined,
        clientSaleId: clientSaleIdRef.current
      };
      const payload: WalkInSalePayload = treasurySale
        ? { ...sale, collectionChannel: "TREASURER", officialReceiptNumber: officialReceiptNumberValue, treasuryReceiptInspected: true }
        : { ...sale, collectionChannel: "COMMISSARY", cashReceived: cashReceivedValue ?? 0 };
      const receipt = await recordWalkInSale(sessionToken, payload);
      setPrintError("");
      setSuccessReceipt(receipt);
      setCart([]);
      setSelectedStudent(null);
      setStudentSearch("");
      setReceiptCode("");
      setCashReceived("");
      setCollectionChannel("COMMISSARY");
      setOfficialReceiptNumber("");
      setTreasuryInspected(false);
      clientSaleIdRef.current = createClientSaleId();
      setNotice(`${receipt.receiptCode} recorded for ${receipt.buyerName}.`);
      void loadHistory({ background: true });
      void loadCatalog({ background: true });
    } catch (submitError) {
      if (submitError instanceof BackendApiError && submitError.code === "WALK_IN_INSUFFICIENT_STOCK") {
        setStockConflict(userFacingErrorMessage(submitError, "Stock changed while checking out."));
        void loadCatalog({ background: true });
        void refreshCartInventory();
      } else {
        setSaleError(userFacingErrorMessage(submitError, "Unable to record the walk-in sale."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const confirmVoid = async () => {
    if (!voidTarget) return;
    setVoiding(true);
    setSaleError("");
    const sessionToken = token || getStoredStaffSession().token;
    if (!sessionToken) {
      setSaleError("Your staff session has expired. Refresh the page and sign in again.");
      setVoiding(false);
      return;
    }
    try {
      const updated = await voidWalkInSale(sessionToken, voidTarget.id, voidReason);
      setHistory((current) => current.map((receipt) => receipt.id === updated.id ? updated : receipt));
      setNotice(updated.treasuryReconciliationRequired
        ? `${updated.receiptCode} voided and stock restored. Settle the Treasury refund separately.`
        : `${updated.receiptCode} voided and stock restored.`);
      setVoidTarget(null);
      setVoidReason("");
      void loadCatalog({ background: true });
    } catch (voidError) {
      setSaleError(userFacingErrorMessage(voidError, "Unable to void the walk-in sale."));
    } finally {
      setVoiding(false);
    }
  };

  const filterChipClass = (active: boolean) => cn(
    "rounded-full border px-3 py-1.5 text-xs font-bold transition-colors",
    active ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-card text-muted-foreground hover:border-primary hover:text-primary"
  );
  const catalogFiltersActive = Boolean(catalogSearch || activeCategoryId || stockFilter !== "ALL");
  const cartQuantityByProduct = cart.reduce<Record<string, number>>((totals, row) => {
    totals[row.product.id] = (totals[row.product.id] ?? 0) + (Number.parseInt(row.quantity, 10) || 0);
    return totals;
  }, {});

  const cartPanel = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-extrabold text-foreground">Current sale</h3>
        <span className="text-xs font-semibold text-muted-foreground">
          {cart.length ? `${cart.length} line item${cart.length === 1 ? "" : "s"}` : "Cart is empty"}
        </span>
        {cart.length ? (
          <button type="button" onClick={() => (confirmClear ? clearCart() : setConfirmClear(true))} onBlur={() => setConfirmClear(false)} className={cn("ml-auto rounded-md border px-2 py-1 text-xs font-bold transition-colors", confirmClear ? "border-danger/40 bg-danger/5 text-danger" : "border-border-strong text-muted-foreground hover:border-danger/40 hover:text-danger")}>
            {confirmClear ? "Confirm clear?" : "Clear"}
          </button>
        ) : null}
      </div>
      {!cart.length ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong bg-card px-4 py-5 text-center text-xs font-semibold text-muted-foreground">
          <ShoppingCart className="size-5 text-muted-foreground" aria-hidden="true" />
          Choose products from the catalog to start the sale.
        </div>
      ) : null}
      {cart.map((row) => {
        const stock = rowStock(row);
        const lineTotal = rowLineTotal(row);
        const optionLabel = row.skuId && row.product.skus
          ? row.product.skus.find((sku) => sku.id === row.skuId)?.options.map((option) => option.optionValue).join(" / ")
          : row.variantId && row.product.variants
            ? row.product.variants.find((variant) => variant.id === row.variantId)?.optionValue
            : null;
        return (
          <div key={row.key} className="rounded-lg border bg-card p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold">{row.product.name}</p>
                <p className="truncate text-xs text-muted-foreground">{optionLabel ?? formatPeso(Number(row.product.price))}</p>
                {stock !== null ? <p className={`mt-1 text-[11px] font-semibold ${stock <= 0 ? "text-danger" : "text-muted-foreground"}`}>Available: {stock}</p> : null}
              </div>
              <p className="shrink-0 text-sm font-extrabold text-primary">{formatPeso(lineTotal)}</p>
              <button type="button" onClick={() => removeCartRow(row.key)} aria-label={`Remove ${row.product.name}`} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-danger/5 hover:text-danger"><Trash2 className="size-4" /></button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button type="button" variant="secondary" size="icon" className="size-8" aria-label={`Decrease ${row.product.name} quantity`} onClick={() => adjustCartRowQuantity(row, -1)}><Minus className="size-3.5" /></Button>
              <input type="number" min="1" max={stock ?? 10000000} step="1" inputMode="numeric" aria-label={`${row.product.name} quantity`} value={row.quantity} onChange={(event) => updateCartRow(row.key, { quantity: event.target.value })} className="h-8 w-16 rounded-md border border-border-strong bg-white px-2 text-center text-sm outline-none focus:border-primary" />
              <Button type="button" variant="secondary" size="icon" className="size-8" aria-label={`Increase ${row.product.name} quantity`} disabled={stock !== null && Number.parseInt(row.quantity, 10) >= stock} onClick={() => adjustCartRowQuantity(row, 1)}><Plus className="size-3.5" /></Button>
              <span className="ml-auto text-xs text-muted-foreground">{formatPeso(Number(row.product.price))} each</span>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="relative space-y-5">
      <PageHeading
        eyebrow="Walk-in sales"
        title="Record physical-store purchases"
        detail="Sell products over the counter, deduct stock immediately, and print a sales receipt."
        action={(
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setPrinterSettingsOpen(true)}>
              <Printer className="size-4" aria-hidden="true" />
              Printer: {printerSettings.paperWidthMm} mm
            </Button>
            <Button variant="secondary" onClick={() => { void loadHistory(); void loadCatalog(); }} disabled={historyLoading}>
              <RefreshCw className={cn("size-4", (historyLoading || catalogLoading) && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
              Refresh
            </Button>
          </div>
        )}
      />

      <nav className="grid w-full grid-cols-2 gap-1 rounded-xl border bg-card p-1 shadow-soft sm:inline-grid sm:w-auto" aria-label="Walk-in sales sections">
        <button type="button" onClick={() => setActiveView("SALE")} aria-current={activeView === "SALE" ? "page" : undefined} className={cn("inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition-colors sm:min-w-36", activeView === "SALE" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-primary")}>
          <ShoppingCart className="size-4" aria-hidden="true" />
          New sale
          {cart.length ? (
            <span className={cn("grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-extrabold tabular-nums", activeView === "SALE" ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground")}>
              {cart.length}<span className="sr-only"> in the current sale</span>
            </span>
          ) : null}
        </button>
        <button type="button" onClick={() => setActiveView("HISTORY")} aria-current={activeView === "HISTORY" ? "page" : undefined} className={cn("inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition-colors sm:min-w-36", activeView === "HISTORY" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-primary")}>
          <ReceiptText className="size-4" aria-hidden="true" />
          Sales history
        </button>
      </nav>

      {activeView === "SALE" ? <section className="rounded-xl border bg-card p-4 shadow-soft sm:p-5">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-foreground">
          <Plus className="size-5 text-primary" /> New walk-in sale
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Collect cash here, or release items already paid at the Treasury after checking the official receipt. Every item below is deducted from inventory when the sale is saved.</p>

        <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_430px]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-extrabold text-foreground">Product catalog</h3>
              {catalogLoading && !catalog.length ? (
                <span className="text-xs font-semibold text-muted-foreground">Loading active inventory...</span>
              ) : null}
            </div>

            <label className="flex h-11 items-center rounded-control border border-border-strong bg-card px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
              <Search className="mr-2 size-5 text-muted-foreground" />
              <input
                value={catalogSearch}
                onChange={(event) => setCatalogSearch(event.target.value)}
                placeholder="Search name, category, SKU, or option"
                aria-label="Search products"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:outline-none"
              />
            </label>

            <div className="flex flex-wrap gap-2" aria-label="Product categories">
              <button
                type="button"
                onClick={() => setActiveCategoryId("")}
                aria-pressed={activeCategoryId === ""}
                className={filterChipClass(activeCategoryId === "")}
              >
                All products
              </button>
              {catalogCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setActiveCategoryId(category.id === activeCategoryId ? "" : category.id)}
                  aria-pressed={activeCategoryId === category.id}
                  className={filterChipClass(activeCategoryId === category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2" aria-label="Stock filters">
              {(["ALL", "IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setStockFilter(filter)}
                  aria-pressed={stockFilter === filter}
                  className={filterChipClass(stockFilter === filter)}
                >
                  {filter === "ALL" ? "All stock" : filter === "IN_STOCK" ? "In stock" : filter === "LOW_STOCK" ? "Low stock" : "Out of stock"}
                </button>
              ))}
            </div>

            {catalogError ? <InlineAlert>{catalogError}</InlineAlert> : null}
            {stockConflict ? (
              <InlineAlert
                tone="warning"
                title="Stock changed while checking out"
                action={(
                  <Button type="button" variant="secondary" size="sm" onClick={() => { void loadCatalog(); void refreshCartInventory(); setStockConflict(""); }}>
                    Refresh stock & correct
                  </Button>
                )}
              >
                <p className="font-semibold">{stockConflict}</p>
                <p className="mt-1 text-xs">Review the affected item above, correct the quantity, and save again.</p>
              </InlineAlert>
            ) : null}

            {catalogLoading && !catalog.length ? (
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" role="status" aria-label="Loading product catalog...">
                {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-[5.5rem] rounded-lg" />)}
              </div>
            ) : (
              <>
                {visibleCatalog.length ? (
                  <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {visibleCatalog.map((product) => {
                    const sellableStock = productSellableStock(product);
                    const outOfStock = sellableStock <= 0;
                    const unpriced = Number(product.price) <= 0;
                    const lowStock = !outOfStock && productIsLowStock(product);
                    const inCart = cartQuantityByProduct[product.id] ?? 0;
                    return (
                      <article key={product.id} className={cn(
                        "flex gap-3 rounded-lg border p-3 transition-colors",
                        outOfStock ? "bg-surface-subtle opacity-70" : inCart ? "border-primary/40 bg-primary/5" : "bg-card hover:border-primary/40"
                      )}>
                        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md border bg-card">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={shopProductCardImage(resolveShopProductAsset(product.name, product.imageUrl).image)} alt="" className="size-full object-cover" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-extrabold">{product.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{product.category?.name ?? "General"}</p>
                          <p className="mt-1 text-sm font-extrabold text-primary">{formatPeso(Number(product.price))}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className={cn("text-xs font-semibold", outOfStock ? "text-danger" : lowStock ? "text-warning" : "text-muted-foreground")}>
                              {product.skuInventoryEnabled || product.variants?.length
                                ? `${sellableStock} pc(s) total`
                                : `${product.stock} pc(s) available`}
                            </span>
                            {outOfStock ? (
                              <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-danger">Out of stock</span>
                            ) : null}
                            {unpriced ? (
                              <span title="Set a selling price in Inventory before selling this item." className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-danger">Needs price</span>
                            ) : null}
                            {lowStock ? (
                              <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-warning">Low stock</span>
                            ) : null}
                            {inCart ? (
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-primary">In sale ×{inCart}</span>
                            ) : null}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="self-end"
                          disabled={outOfStock || unpriced}
                          aria-label={`Add ${product.name} to sale`}
                          onClick={() => handleProductClick(product)}
                        >
                          <Plus className="size-4" />
                          Add
                        </Button>
                      </article>
                    );
                  })}
                  </div>
                ) : (
                  <FeedbackState
                    kind="empty"
                    compact
                    title="No products match this view."
                    description={catalogFiltersActive ? "Clear the search or filters to see the full catalog." : "Active products will appear here once they are added to inventory."}
                    action={catalogFiltersActive ? (
                      <Button type="button" variant="secondary" size="sm" onClick={() => { setCatalogSearch(""); setActiveCategoryId(""); setStockFilter("ALL"); }}>Clear filters</Button>
                    ) : undefined}
                  />
                )}
                {catalogNextCursor ? (
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={catalogLoadingMore}
                      onClick={() => void loadCatalog({ cursor: catalogNextCursor })}
                    >
                      {catalogLoadingMore ? "Loading more..." : "Load more products"}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <aside className="space-y-4 rounded-xl border bg-surface-subtle p-4 xl:sticky xl:top-[calc(var(--workspace-header)+1rem)] xl:self-start" aria-label="Checkout">
            <div>
              <h3 className="text-base font-extrabold text-foreground">Checkout</h3>
              <p className="mt-1 text-xs text-muted-foreground">Enter any walk-in buyer name. Linking a WESCOMM student account is optional.</p>
            </div>
            <div className="relative">
              <label className="grid gap-1.5 text-xs font-semibold">
                Buyer name
                <input
                  id="walk-in-student-search"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls="walk-in-student-results"
                  aria-expanded={studentPickerOpen && studentResults.length > 0}
                  value={selectedStudent ? `${selectedStudent.fullName}${selectedStudent.studentNumber ? ` — ${selectedStudent.studentNumber}` : ""}` : studentSearch}
                  onChange={(event) => {
                    setSelectedStudent(null);
                    setStudentSearch(event.target.value);
                    setSaleError("");
                  }}
                  onFocus={() => studentResults.length && setStudentPickerOpen(true)}
                  placeholder="Enter buyer name"
                  className="h-11 rounded-md border border-border-strong bg-white px-3 font-normal outline-none focus:border-primary"
                />
              </label>
              {studentPickerOpen && studentResults.length ? (
                <ul id="walk-in-student-results" role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-md border border-border-strong bg-white shadow-lg">
                  {studentResults.map((student) => (
                    <li key={student.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected="false"
                        onClick={() => {
                          setSelectedStudent(student);
                          setStudentSearch("");
                          setStudentResults([]);
                          setStudentPickerOpen(false);
                          setStudentError("");
                          setSaleError("");
                        }}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{student.fullName}</span>
                          <span className="block text-xs text-muted-foreground">
                            {student.studentNumber ?? "No student number"}{student.department ? ` · ${student.department}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div aria-live="polite">
              {studentLoading ? <p className="mt-1 text-xs font-semibold text-muted-foreground">Searching students...</p> : null}
              {!studentLoading && !studentError && buyerNameValid && !selectedStudent ? (
                <p className="mt-1 text-xs font-semibold text-success">
                  This can be saved as a walk-in buyer. Select a result only if you want to link an existing student account.
                </p>
              ) : null}
              {studentError ? <p className="mt-1 text-xs font-semibold text-warning">Student lookup is unavailable, but you can still save this as a walk-in buyer.</p> : null}
              </div>
              {selectedStudent ? (
                <div className="mt-2 flex items-center gap-3 rounded-md border border-success/30 bg-success/10 px-3 py-2">
                  <Check className="size-4 shrink-0 text-success" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-extrabold text-success">Student account linked</p>
                    <p className="truncate text-xs text-success">{selectedStudent.fullName}{selectedStudent.studentNumber ? ` — ${selectedStudent.studentNumber}` : ""}</p>
                  </div>
                  <button type="button" className="text-xs font-bold text-success underline" onClick={() => { setSelectedStudent(null); setStudentSearch(""); }}>Change</button>
                </div>
              ) : null}
            </div>

            {cartPanel}

            <details className="rounded-lg border bg-card">
              <summary className="cursor-pointer px-3 py-2.5 text-xs font-bold text-muted-foreground">Optional receipt details</summary>
              <label className="grid gap-1.5 border-t border-border p-3 text-xs font-semibold">
                Manual receipt code
                <input
                  value={receiptCode}
                  onChange={(event) => setReceiptCode(event.target.value.toUpperCase())}
                  maxLength={64}
                  placeholder="Auto-generated when blank"
                  className="h-11 rounded-md border border-border-strong bg-white px-3 font-normal uppercase outline-none focus:border-primary"
                />
              </label>
            </details>

            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-xs font-semibold">Payment collected at</legend>
              <div className="grid grid-cols-2 gap-1 rounded-lg border bg-card p-1">
                {([
                  { value: "COMMISSARY", label: "Commissary cash" },
                  { value: "TREASURER", label: "Treasury" }
                ] as const).map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      "flex h-9 cursor-pointer items-center justify-center rounded-md px-2 text-xs font-bold transition-colors focus-within:ring-2 focus-within:ring-primary/30",
                      collectionChannel === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-primary"
                    )}
                  >
                    <input
                      type="radio"
                      name="walk-in-collection-channel"
                      value={option.value}
                      checked={collectionChannel === option.value}
                      onChange={() => { setCollectionChannel(option.value); setSaleError(""); }}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {treasurySale ? (
              <div className="space-y-3 rounded-lg border border-primary/30 bg-card p-3">
                <label className="grid gap-1.5 text-xs font-semibold">
                  Treasury OR number
                  <input
                    value={officialReceiptNumber}
                    onChange={(event) => { setOfficialReceiptNumber(event.target.value.toUpperCase()); setSaleError(""); }}
                    maxLength={100}
                    autoComplete="off"
                    placeholder="Example: OR-102938"
                    className="h-11 rounded-md border border-border-strong bg-white px-3 font-normal uppercase outline-none focus:border-primary"
                  />
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={treasuryInspected}
                    onChange={(event) => { setTreasuryInspected(event.target.checked); setSaleError(""); }}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>I inspected the Treasury official receipt. It matches this buyer and the {formatPeso(cartTotal)} total.</span>
                </label>
                <p className="text-xs text-muted-foreground">Do not collect cash here. Stock is deducted only after you confirm the official receipt.</p>
              </div>
            ) : (
              <>
                <label className="grid gap-1.5 text-xs font-semibold">
                  Cash received (PHP)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={cashReceived}
                    onChange={(event) => { setCashReceived(event.target.value); setSaleError(""); }}
                    placeholder="0.00"
                    className="h-11 rounded-md border border-border-strong bg-white px-3 font-normal outline-none focus:border-primary"
                  />
                </label>

                {quickCashAmounts.length ? (
                  <div className="flex flex-wrap gap-2" aria-label="Quick cash amounts">
                    {quickCashAmounts.map((amount) => (
                      <button key={amount} type="button" onClick={() => { setCashReceived(String(amount)); setSaleError(""); }} className="rounded-md border border-border-strong bg-card px-3 py-2 text-xs font-bold text-primary transition-colors hover:border-primary hover:bg-primary/5">
                        {amount === cartTotal ? "Exact" : formatPeso(amount)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}

            <dl className="grid grid-cols-[1fr_auto] items-baseline gap-y-2 rounded-lg border bg-card px-3 py-3 text-sm">
              <dt className="font-bold text-muted-foreground">Total</dt>
              <dd className="text-xl font-extrabold tabular-nums text-foreground">{formatPeso(cartTotal)}</dd>
              {!treasurySale && cashValid && changeDue !== null ? (
                <>
                  <dt className="text-muted-foreground">Change</dt>
                  <dd className="font-extrabold tabular-nums text-success">{formatPeso(changeDue)}</dd>
                </>
              ) : null}
            </dl>
            {!treasurySale && !cashValid && cashReceived.trim() ? (
              <p className="text-xs font-semibold text-danger">Cash received must cover the total.</p>
            ) : null}

            {saleError ? <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs font-semibold text-danger">{saleError}</p> : null}

            <ul className="space-y-2 rounded-lg border bg-card p-3 text-xs font-semibold" aria-label="Sale checklist">
              {[
                { done: cartValid, label: "Products and stock reviewed" },
                { done: buyerNameValid, label: "Buyer name entered" },
                treasurySale
                  ? { done: treasuryValid, label: "Treasury OR entered and inspected" }
                  : { done: cashValid, label: "Cash covers total" }
              ].map((step) => (
                <li key={step.label} className={cn("flex items-center gap-2", step.done ? "text-success" : "text-muted-foreground")}>
                  {step.done ? <Check className="size-4" aria-hidden="true" /> : <Circle className="size-4" aria-hidden="true" />}
                  {step.label}
                  <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                </li>
              ))}
            </ul>

            <Button
              type="button"
              className="w-full"
              size="lg"
              disabled={submitting}
              loading={submitting}
              onClick={() => void recordSale()}
            >
              Save sale & deduct stock
            </Button>
          </aside>
        </div>
      </section> : null}

      {activeView === "HISTORY" ? <section className="space-y-3">
        <h2 className="text-lg font-extrabold text-foreground">Recent walk-in sales</h2>
        <Toolbar
          search={historySearch}
          onSearch={setHistorySearch}
          status={historyStatus}
          onStatus={setHistoryStatus}
          placeholder="Search receipt code, buyer, or item"
          statuses={["Verified", "Voided"]}
        />
        {historyError ? <InlineAlert>{historyError}</InlineAlert> : null}
        {printError && !successReceipt ? <InlineAlert>{printError}</InlineAlert> : null}
        {historyLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading walk-in sales...">
            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-56 rounded-xl" />)}
          </div>
        ) : history.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {history.map((receipt) => (
              <article key={receipt.id} className={cn("flex flex-col rounded-xl border bg-card p-5 shadow-soft", receipt.status === "VOIDED" && "opacity-75")}>
                <div className="flex items-start gap-3">
                  <div>
                    <p className="font-extrabold">{receipt.receiptCode}</p>
                    <p className="text-xs text-muted-foreground">{formatStaffReceiptDate(receipt.issuedAt)}</p>
                  </div>
                  <span className="ml-auto"><StatusBadge statusKey={receipt.status} /></span>
                </div>
                <dl className="mt-5 grid grid-cols-[1fr_auto] gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Buyer</dt>
                  <dd className="font-bold">{receipt.buyerName}</dd>
                  <dt className="text-muted-foreground">Items</dt>
                  <dd className="text-right font-bold">
                    {receipt.items.length > 1
                      ? `${receipt.items[0].productName} + ${receipt.items.length - 1} more`
                      : receipt.items[0]?.productName ?? "Walk-in item"}
                  </dd>
                  <dt className="text-muted-foreground">Paid at</dt>
                  <dd className="text-right font-bold">{collectionLabel(receipt)}</dd>
                  {receipt.collectionChannel === "TREASURER" ? (
                    <>
                      <dt className="text-muted-foreground">Treasury OR</dt>
                      <dd className="break-all text-right font-bold">{receipt.officialReceiptNumber}</dd>
                    </>
                  ) : null}
                  <dt className="text-muted-foreground">Total</dt>
                  <dd className="font-extrabold text-primary">{formatPeso(Number(receipt.totalAmount))}</dd>
                </dl>
                {receipt.items.length ? (
                  <div className="mt-4 rounded-md bg-surface-subtle p-3">
                    {receipt.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-2 py-1 text-xs">
                        <span className="min-w-0 truncate font-semibold">
                          {item.quantity}× {item.productName}
                          {item.options.length ? ` (${item.options.map((option) => option.optionValue).join(" / ")})` : ""}
                        </span>
                        <span className="shrink-0 text-muted-foreground">{formatPeso(Number(item.subtotal))}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {receipt.treasuryReconciliationRequired ? (
                  <p className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
                    Treasury refund or reconciliation required.
                  </p>
                ) : null}
                <div className="mt-auto grid gap-2 pt-5">
                  <Button
                    variant="secondary"
                    disabled={printingReceiptId === receipt.id}
                    loading={printingReceiptId === receipt.id}
                    className="w-full"
                    aria-label={`Reprint receipt ${receipt.receiptCode}`}
                    onClick={() => void printReceipt(receipt, { reprint: true })}
                  >
                    <Printer className="size-4" aria-hidden="true" />
                    Reprint
                  </Button>
                  {receipt.status !== "VOIDED" ? (() => {
                    const voidWindow = voidWindowState(receipt.voidableUntil, user?.role);
                    return (
                      <>
                        <VoidWindowBadge state={voidWindow} className="justify-center" />
                        <Button
                          variant="ghost"
                          disabled={voiding || !voidWindow.canVoid}
                          title={voidWindow.canVoid ? undefined : "The 2-day void period has ended. Ask an admin."}
                          className="w-full border border-danger/30 text-danger hover:bg-danger/5"
                          onClick={() => {
                            setVoidReason("");
                            setVoidTarget(receipt);
                          }}
                        >
                          <Trash2 className="size-4" />
                          {voidWindow.canVoid ? "Void & restore stock" : "Void period ended"}
                        </Button>
                      </>
                    );
                  })() : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <FeedbackState
            kind="empty"
            title={historySearch.trim() || historyStatus !== "All" ? "No matching walk-in sales." : "No walk-in sales recorded yet."}
            description={historySearch.trim() || historyStatus !== "All" ? "Try another search or status." : "Sales you save from the New sale tab will appear here."}
            action={historySearch.trim() || historyStatus !== "All"
              ? <Button type="button" variant="secondary" size="sm" onClick={() => { setHistorySearch(""); setHistoryStatus("All"); }}>Clear filters</Button>
              : <Button type="button" size="sm" onClick={() => setActiveView("SALE")}><ShoppingCart className="size-4" /> Start a sale</Button>}
          />
        )}
        {historyNextCursor ? (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="secondary"
              disabled={historyLoadingMore}
              onClick={() => void loadHistory({ cursor: historyNextCursor })}
            >
              {historyLoadingMore ? "Loading more..." : "Load more sales"}
            </Button>
          </div>
        ) : null}
      </section> : null}

      {notice ? <Notice text={notice} onClose={() => setNotice("")} /> : null}
      <SaleSuccessModal
        receipt={successReceipt}
        printing={Boolean(successReceipt && printingReceiptId === successReceipt.id)}
        printed={Boolean(successReceipt && printedReceiptIds.has(successReceipt.id))}
        printError={printError}
        onPrint={() => {
          if (successReceipt) void printReceipt(successReceipt, { reprint: printedReceiptIds.has(successReceipt.id) });
        }}
        onClose={() => {
          setSuccessReceipt(null);
          setPrintError("");
        }}
      />
      <ThermalPrinterSettingsModal
        open={printerSettingsOpen}
        settings={printerSettings}
        onClose={() => setPrinterSettingsOpen(false)}
        onSave={(next) => {
          setPrinterSettings(next);
          setPrinterSettingsOpen(false);
          setNotice(saveThermalPrinterSettings(next)
            ? `Receipt printer set to ${next.paperWidthMm} mm paper on this computer.`
            : `Receipt printer set to ${next.paperWidthMm} mm paper for this session. This browser could not remember it.`);
        }}
      />
      <VoidWalkInSaleModal
        receipt={voidTarget}
        submitting={voiding}
        reason={voidReason}
        role={user?.role}
        onReasonChange={setVoidReason}
        onClose={() => {
          setVoidTarget(null);
          setVoidReason("");
        }}
        onConfirm={() => void confirmVoid()}
      />
      {skuPickerProduct ? (
        <ProductSkuPickerModal
          product={skuPickerProduct}
          onClose={() => setSkuPickerProduct(null)}
          onAdd={(skuId, quantity) => {
            addProductToCart(skuPickerProduct, skuId, "", quantity);
            setSkuPickerProduct(null);
          }}
        />
      ) : null}
      {variantPickerProduct ? (
        <ProductVariantPickerModal
          product={variantPickerProduct}
          onClose={() => setVariantPickerProduct(null)}
          onAdd={(variantId, quantity) => {
            addProductToCart(variantPickerProduct, "", variantId, quantity);
            setVariantPickerProduct(null);
          }}
        />
      ) : null}
    </div>
  );
}
