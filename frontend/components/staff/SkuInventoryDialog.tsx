"use client";

import { userFacingErrorMessage } from "@/lib/user-facing-error";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirmationDialog } from "@/components/ui/ConfirmationDialogProvider";
import { useAccessibleDialog } from "@/components/ui/useAccessibleDialog";
import {
  reconcileStaffProductSkuInventory,
  restockStaffProductSkus,
  updateStaffProduct,
  type StaffProduct
} from "@/lib/staff-api";
import { getStaffInventoryBatches, verifyStaffOpeningBatchCost, type StaffInventoryBatchResult } from "@/lib/inventory-batch-api";
import { sortProductOptionValues } from "@/lib/product-display";
import { shopProductCardImage } from "@/lib/shop-assets";
import {
  ADJUSTMENT_REASONS,
  AdjustmentReasonFields,
  CostHistory,
  MarginNote,
  MoneyInput,
  ReorderAlertSelect,
  SellingPriceFields,
  StockActionIntro,
  StockActionTabs,
  SubmitHint,
  SummaryPanel,
  UnitCostNeeded,
  Variance,
  adjustmentNote,
  formatPhp,
  isMoneyInput,
  todayInManila,
  type StockAction
} from "@/components/staff/stock-dialog-parts";

export type SkuInventoryDialogProduct = {
  id: string;
  name: string;
  imageUrl: string;
  stock: number;
  stockTarget: number;
  lowStockPercent: number;
  price: number;
  oldPrice?: number | null;
  skuInventoryEnabled: boolean;
  inventoryReconciledAt?: string | null;
  variants: Array<{
    id: string;
    optionName: string;
    optionValue: string;
    stock: number;
    stockTarget: number;
    lowStockPercent: number;
    lowStockThreshold: number;
  }>;
  skus: Array<{
    id: string;
    code?: string | null;
    stock: number;
    lowStockThreshold: number;
    variantIds: string[];
    options: Array<{ optionName: string; optionValue: string }>;
  }>;
};

type OptionValueDraft = {
  key: string;
  id?: string;
  value: string;
  lowStockThreshold: string;
};

type OptionGroupDraft = {
  key: string;
  name: string;
  values: OptionValueDraft[];
};

type ReconcileRow = {
  key: string;
  selections: Record<string, string>;
  stock: string;
  threshold: string;
};

function draftKey(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function normalizedLabel(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function displayInventoryInteger(value: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function requiredInventoryInteger(value: string, label: string) {
  if (!value.trim()) {
    throw new Error(`${label} is required.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000_000) {
    throw new Error(`${label} must be a whole number from 0 to 10,000,000.`);
  }
  return parsed;
}

function initialOptionGroups(product: SkuInventoryDialogProduct): OptionGroupDraft[] {
  const grouped = new Map<string, SkuInventoryDialogProduct["variants"]>();
  for (const variant of product.variants) {
    const values = grouped.get(variant.optionName) ?? [];
    values.push(variant);
    grouped.set(variant.optionName, values);
  }

  const groups = Array.from(grouped.entries()).map(([name, variants]) => ({
    key: `group:${variants[0].id}`,
    name,
    values: sortProductOptionValues(name, variants.map((variant) => variant.optionValue)).map((optionValue) => {
      const variant = variants.find((entry) => entry.optionValue === optionValue)!;
      return {
        key: variant.id,
        id: variant.id,
        value: variant.optionValue,
        lowStockThreshold: String(variant.lowStockThreshold)
      };
    })
  }));

  return groups.length
    ? groups
    : [{
        key: "group:new:0",
        name: "Size",
        values: [{ key: "value:new:0:0", value: "", lowStockThreshold: "2" }]
      }];
}

function initialReconcileRows(product: SkuInventoryDialogProduct, groups: OptionGroupDraft[]): ReconcileRow[] {
  if (product.skuInventoryEnabled && product.skus.length) {
    return product.skus.map((sku) => ({
      key: `row:${sku.id}`,
      selections: Object.fromEntries(groups.map((group) => [
        group.key,
        group.values.find((value) => value.id && sku.variantIds.includes(value.id))?.key ?? ""
      ])),
      stock: String(sku.stock),
      threshold: String(sku.lowStockThreshold)
    }));
  }

  if (groups.length === 1) {
    return groups[0].values.map((value, index) => {
      const legacy = value.id
        ? product.variants.find((variant) => variant.id === value.id)
        : undefined;
      return {
        key: `row:legacy:${value.id ?? index}`,
        selections: { [groups[0].key]: value.key },
        stock: String(legacy?.stock ?? 0),
        threshold: String(legacy?.lowStockThreshold ?? 2)
      };
    });
  }

  return [{
    key: "row:new:0",
    selections: Object.fromEntries(groups.map((group) => [group.key, ""])),
    stock: "0",
    threshold: "2"
  }];
}

function skuShortLabel(sku: SkuInventoryDialogProduct["skus"][number]) {
  return sku.options.length ? sku.options.map((option) => option.optionValue).join(" \u00b7 ") : "Standard";
}

function skuLabel(sku: SkuInventoryDialogProduct["skus"][number]) {
  return sku.options.length
    ? sku.options.map((option) => `${option.optionName}: ${option.optionValue}`).join(" · ")
    : "Standard item";
}

export function SkuInventoryDialog({
  token,
  product,
  onClose,
  onSaved,
  returnFocus,
  initialAction = "receive"
}: {
  token: string;
  product: SkuInventoryDialogProduct;
  onClose: () => void;
  onSaved: (product: StaffProduct) => void;
  returnFocus?: HTMLElement | null;
  initialAction?: StockAction;
}) {
  const dialog = useAccessibleDialog<HTMLElement>(true, onClose, { returnFocus });
  const confirm = useConfirmationDialog();
  const [initialStructure] = useState(() => {
    const groups = initialOptionGroups(product);
    return { groups, rows: initialReconcileRows(product, groups) };
  });
  const [mode, setMode] = useState<"restock" | "reconcile">(product.skuInventoryEnabled ? "restock" : "reconcile");
  const [stockAction, setStockAction] = useState<StockAction>(initialAction);
  const [groups, setGroups] = useState<OptionGroupDraft[]>(initialStructure.groups);
  const [rows, setRows] = useState<ReconcileRow[]>(initialStructure.rows);
  const [skuQuantities, setSkuQuantities] = useState<Record<string, string>>(
    () => Object.fromEntries(product.skus.map((sku) => [sku.id, initialAction === "adjust" ? String(sku.stock) : "0"]))
  );
  const [unitCost, setUnitCost] = useState("");
  const [newPrice, setNewPrice] = useState(() => product.price > 0 ? product.price.toFixed(2) : "");
  const [adjustmentReason, setAdjustmentReason] = useState<string>(ADJUSTMENT_REASONS[0]);
  const [adjustmentRemarks, setAdjustmentRemarks] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => todayInManila());
  const [supplierNote, setSupplierNote] = useState("");
  const [lowStockPercent, setLowStockPercent] = useState(() => product.lowStockPercent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [batchResult, setBatchResult] = useState<StaffInventoryBatchResult | null>(null);
  const [openingCostDrafts, setOpeningCostDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!product.skuInventoryEnabled) return;
    void getStaffInventoryBatches(token, product.id).then((result) => {
      setBatchResult(result);
      setOpeningCostDrafts(Object.fromEntries(result.batches.filter((batch) => !batch.costVerified).map((batch) => [batch.id, ""])));
    }).catch(() => undefined);
  }, [product.id, product.skuInventoryEnabled, token]);

  const valueByKey = useMemo(
    () => new Map(groups.flatMap((group) => group.values.map((value) => [value.key, value] as const))),
    [groups]
  );
  const exactTotal = rows.reduce((sum, row) => sum + displayInventoryInteger(row.stock), 0);
  const restockAmount = product.skus.reduce(
    (sum, sku) => sum + displayInventoryInteger(skuQuantities[sku.id] ?? "0"),
    0
  );
  const resultingTotal = stockAction === "adjust" ? restockAmount : product.stock + restockAmount;
  const variance = resultingTotal - product.stock;
  const enteredUnitCost = isMoneyInput(unitCost) ? Number(unitCost) : null;
  const invalidQuantity = product.skus.some((sku) => {
    const value = skuQuantities[sku.id] ?? "";
    const parsed = Number(value);
    return !value.trim() || !Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000_000;
  });
  // The first missing input, shown beside the disabled save button so staff know what is left.
  const missingInput = stockAction === "price"
    ? (!isMoneyInput(newPrice) || Number(newPrice) <= 0
      ? "Enter the new selling price."
      : Number(newPrice) === product.price ? "Enter a price different from the current one." : "")
    : invalidQuantity
      ? "Every quantity must be a whole number of 0 or more."
      : stockAction === "receive"
        ? (restockAmount <= 0 ? "Enter the quantity received for at least one size."
          : enteredUnitCost === null ? "Enter the unit cost."
          : !receivedAt ? "Choose the date received." : "")
        : product.skus.every((sku) => Number(skuQuantities[sku.id]) === sku.stock)
          ? "No variance yet \u2014 every count matches the system." : "";

  const updateGroup = (groupKey: string, update: (group: OptionGroupDraft) => OptionGroupDraft) => {
    setGroups((current) => current.map((group) => group.key === groupKey ? update(group) : group));
  };

  const addGroup = () => {
    const key = draftKey("group");
    setGroups((current) => [
      ...current,
      {
        key,
        name: "",
        values: [{ key: draftKey("value"), value: "", lowStockThreshold: "2" }]
      }
    ]);
    setRows((current) => current.map((row) => ({
      ...row,
      selections: { ...row.selections, [key]: "" }
    })));
    setError("");
  };

  const removeGroup = (groupKey: string) => {
    if (groups.length === 1) return;
    setGroups((current) => current.filter((group) => group.key !== groupKey));
    setRows((current) => current.map((row) => {
      const selections = { ...row.selections };
      delete selections[groupKey];
      return { ...row, selections };
    }));
    setError("");
  };

  const removeValue = (groupKey: string, valueKey: string) => {
    updateGroup(groupKey, (group) => ({
      ...group,
      values: group.values.filter((value) => value.key !== valueKey)
    }));
    setRows((current) => current.map((row) => ({
      ...row,
      selections: row.selections[groupKey] === valueKey
        ? { ...row.selections, [groupKey]: "" }
        : row.selections
    })));
    setError("");
  };

  const generateAllCombinations = () => {
    setError("");
    try {
      if (groups.some((group) => !group.name.trim() || group.values.length === 0 || group.values.some((value) => !value.value.trim()))) {
        throw new Error("Complete every option group and value before generating combinations.");
      }
      const combinationCount = groups.reduce((total, group) => total * group.values.length, 1);
      if (combinationCount > 500) {
        throw new Error(`This structure creates ${combinationCount} combinations. Reduce it to 500 or fewer.`);
      }

      let combinations: Array<Record<string, string>> = [{}];
      for (const group of groups) {
        combinations = combinations.flatMap((selection) => group.values.map((value) => ({
          ...selection,
          [group.key]: value.key
        })));
      }
      const existingByCombination = new Map(rows.map((row) => [
        groups.map((group) => row.selections[group.key] ?? "").join("|"),
        row
      ]));
      setRows(combinations.map((selections) => {
        const key = groups.map((group) => selections[group.key]).join("|");
        const existing = existingByCombination.get(key);
        return existing ?? {
          key: draftKey("row"),
          selections,
          stock: "0",
          threshold: "2"
        };
      }));
    } catch (generateError) {
      setError(userFacingErrorMessage(generateError, "Unable to prepare the stock combinations."));
    }
  };

  const changeStockAction = (next: StockAction) => {
    setStockAction(next);
    setSkuQuantities(Object.fromEntries(product.skus.map((sku) => [
      sku.id,
      next === "adjust" ? String(sku.stock) : "0"
    ])));
    setError("");
  };

  const saveSellingPrice = async () => {
    setError("");
    if (!isMoneyInput(newPrice) || Number(newPrice) <= 0) {
      setError("Enter a selling price above PHP 0.00 with up to two decimal places.");
      return;
    }
    const price = Number(newPrice);
    const confirmed = await confirm({
      title: "Update the selling price?",
      description: `${product.name}: ${product.price > 0 ? formatPhp(product.price) : "no price"} \u2192 ${formatPhp(price)}. Applies to every size and to all future reservations and walk-in sales.`,
      confirmLabel: "Update price",
      tone: "warning"
    });
    if (!confirmed) return;
    setSubmitting(true);
    try {
      onSaved(await updateStaffProduct(token, product.id, { price, notes: "Selling price updated from Update stock." }));
    } catch (saveError) {
      setError(userFacingErrorMessage(saveError, "Unable to update the selling price."));
    } finally {
      setSubmitting(false);
    }
  };

  const saveReconciliation = async () => {
    setError("");
    try {
      const seenGroupNames = new Set<string>();
      const optionGroups = groups.map((group, groupIndex) => {
        const optionName = group.name.trim();
        const normalizedName = normalizedLabel(optionName);
        if (!optionName) throw new Error(`Option group ${groupIndex + 1} needs a name.`);
        if (seenGroupNames.has(normalizedName)) throw new Error(`${optionName} is listed more than once.`);
        seenGroupNames.add(normalizedName);
        if (!group.values.length) throw new Error(`${optionName} needs at least one value.`);

        const seenValues = new Set<string>();
        return {
          key: group.key,
          optionName,
          values: group.values.map((value, valueIndex) => {
            const optionValue = value.value.trim();
            const normalizedValue = normalizedLabel(optionValue);
            if (!optionValue) throw new Error(`${optionName} value ${valueIndex + 1} cannot be blank.`);
            if (seenValues.has(normalizedValue)) throw new Error(`${optionName}: ${optionValue} is listed more than once.`);
            seenValues.add(normalizedValue);
            return {
              key: value.key,
              id: value.id,
              optionValue,
              lowStockThreshold: requiredInventoryInteger(value.lowStockThreshold, `${optionName}: ${optionValue} alert level`)
            };
          })
        };
      });
      if (optionGroups.reduce((total, group) => total + group.values.length, 0) > 100) {
        throw new Error("Inventory structure may contain at most 100 option values.");
      }

      const seen = new Set<string>();
      const skus = rows.map((row, index) => {
        const optionValueKeys = groups.map((group) => row.selections[group.key] ?? "");
        if (optionValueKeys.some((value) => !value || !valueByKey.has(value))) {
          throw new Error(`Combination ${index + 1}: choose one value for every option.`);
        }
        const combinationKey = [...optionValueKeys].sort().join("|");
        if (seen.has(combinationKey)) throw new Error(`Combination ${index + 1} is duplicated.`);
        seen.add(combinationKey);
        return {
          optionValueKeys,
          stock: requiredInventoryInteger(row.stock, `Combination ${index + 1} stock`),
          lowStockThreshold: Math.ceil(requiredInventoryInteger(row.stock, `Combination ${index + 1} stock`) * lowStockPercent / 100)
        };
      });

      const confirmed = await confirm({
        title: "Save inventory structure?",
        description: product.skuInventoryEnabled
          ? "This will rebuild every inventory combination using the exact available counts shown. The structure and counts save together."
          : "Confirm these option groups, physical combinations, and exact available counts. Student ordering will resume after this save.",
        confirmLabel: product.skuInventoryEnabled ? "Save and rebuild" : "Confirm and save",
        tone: "warning"
      });
      if (!confirmed) return;

      setSubmitting(true);
      const updated = await reconcileStaffProductSkuInventory(
        token,
        product.id,
        skus,
        "Atomic option structure and physical inventory reconciliation from staff dashboard.",
        optionGroups,
        lowStockPercent
      );
      onSaved(updated);
    } catch (saveError) {
      setError(userFacingErrorMessage(saveError, "Unable to save the stock combinations."));
    } finally {
      setSubmitting(false);
    }
  };

  const saveRestock = async () => {
    setError("");
    const restockMode = stockAction === "receive" ? "add" : "set";
    try {
      const quantities = product.skus.map((sku) => ({
        skuId: sku.id,
        quantity: requiredInventoryInteger(
          skuQuantities[sku.id] ?? "",
          `${skuLabel(sku)} quantity`
        )
      }));
      if (restockMode === "add" && !quantities.some((entry) => entry.quantity > 0)) {
        throw new Error("Enter the quantity received for at least one size.");
      }
      const parsedUnitCost = Number(unitCost);
      if (restockMode === "add" && !isMoneyInput(unitCost)) {
        throw new Error("Enter the unit cost with up to two decimal places.");
      }
      if (restockMode === "add" && !receivedAt) throw new Error("Choose the date the stock was received.");
      const totalQuantity = quantities.reduce((total, entry) => total + entry.quantity, 0);
      const changedLines = product.skus.filter((sku, index) => quantities[index].quantity !== sku.stock).length;
      const confirmed = await confirm({
        title: restockMode === "add" ? "Receive this stock?" : "Post this stock adjustment?",
        description: restockMode === "add"
          ? `Receive ${totalQuantity} unit${totalQuantity === 1 ? "" : "s"} of ${product.name} at ${formatPhp(parsedUnitCost)} per unit. Stock on hand: ${product.stock} → ${product.stock + totalQuantity}.`
          : `${product.name}: ${changedLines} size${changedLines === 1 ? "" : "s"} changed. System stock ${product.stock} → physical count ${totalQuantity} (variance ${totalQuantity - product.stock >= 0 ? "+" : "−"}${Math.abs(totalQuantity - product.stock)}). Reason: ${adjustmentReason}.`,
        confirmLabel: restockMode === "add" ? "Receive stock" : "Post adjustment",
        tone: restockMode === "add" ? "default" : "warning"
      });
      if (!confirmed) return;

      setSubmitting(true);
      const updated = await restockStaffProductSkus(token, product.id, {
        mode: restockMode,
        quantities,
        lowStockPercent,
        notes: restockMode === "add" ? "Stock received." : adjustmentNote(adjustmentReason, adjustmentRemarks),
        ...(restockMode === "add" ? {
          unitCost: parsedUnitCost,
          receivedAt: `${receivedAt}T00:00:00+08:00`,
          supplierNote: supplierNote.trim() || undefined
        } : {})
      });
      onSaved(updated);
    } catch (saveError) {
      setError(userFacingErrorMessage(saveError, "Unable to update stock."));
    } finally {
      setSubmitting(false);
    }
  };

  const saveOpeningCost = async (batchId: string) => {
    const parsed = Number(openingCostDrafts[batchId]);
    if (!Number.isFinite(parsed) || parsed < 0 || Math.round(parsed * 100) !== parsed * 100) {
      setError("Enter the unit cost with up to two decimal places.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      setBatchResult(await verifyStaffOpeningBatchCost(token, product.id, batchId, parsed));
    } catch (saveError) {
      setError(userFacingErrorMessage(saveError, "Unable to save the unit cost."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10020] grid place-items-center overflow-hidden bg-foreground/50 p-2 sm:p-4">
      <section ref={dialog.dialogRef} {...dialog.dialogProps} className="flex max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
        <header className="flex shrink-0 items-start gap-3 border-b border-border p-4 sm:p-5">
          <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border bg-surface-subtle">
            <Image src={shopProductCardImage(product.imageUrl)} alt={product.name} fill sizes="64px" unoptimized className="object-contain p-1" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={dialog.titleId} className="text-xl font-extrabold text-foreground">{mode === "reconcile" ? "Set up inventory" : "Update stock"}</h2>
            <p className="mt-1 truncate text-sm font-bold text-foreground">{product.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Stock on hand: <strong className="text-foreground">{product.stock}</strong> units · Selling price: <strong className="text-foreground">{product.price > 0 ? formatPhp(product.price) : "not set"}</strong></p>
          </div>
          <button type="button" data-dialog-autofocus onClick={onClose} disabled={submitting} aria-label="Close inventory dialog" className="grid size-9 place-items-center rounded-md hover:bg-muted disabled:opacity-50"><X /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {error ? <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}

          {mode === "reconcile" ? (
            <>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <div className="flex gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0" /><div><p className="font-extrabold">Atomic option and inventory setup</p><p className="mt-1 text-xs leading-5">Edit the complete option structure, then enter the combinations physically available. The structure, combinations, and totals save together or not at all.</p></div></div>
              </div>

              <section className="mt-5 rounded-lg border bg-surface-subtle p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><h3 className="font-extrabold text-foreground">Option structure</h3><p className="mt-1 text-xs text-muted-foreground">Add Size, Color, Waist, Length, Clip Type, or another physical attribute.</p></div>
                  <Button type="button" variant="secondary" className="h-9 px-3" onClick={addGroup} disabled={submitting || groups.length >= 12}><Plus className="size-4" /> Add group</Button>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  {groups.map((group, groupIndex) => (
                    <div key={group.key} className="rounded-lg border bg-white p-3">
                      <div className="flex items-center gap-2">
                        <input value={group.name} onChange={(event) => updateGroup(group.key, (current) => ({ ...current, name: event.target.value }))} placeholder="Option name, e.g. Color" aria-label={`Option group ${groupIndex + 1} name`} className="h-10 min-w-0 flex-1 rounded-md border px-3 text-sm font-bold outline-none focus:border-primary" />
                        <button type="button" onClick={() => removeGroup(group.key)} disabled={groups.length === 1 || submitting} aria-label={`Remove option group ${groupIndex + 1}`} className="grid size-10 place-items-center rounded-md text-red-600 hover:bg-red-50 disabled:opacity-30"><Trash2 className="size-4" /></button>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {group.values.map((value, valueIndex) => (
                          <div key={value.key} className="flex items-center gap-2">
                            <input value={value.value} onChange={(event) => updateGroup(group.key, (current) => ({ ...current, values: current.values.map((entry) => entry.key === value.key ? { ...entry, value: event.target.value } : entry) }))} placeholder={`Value ${valueIndex + 1}`} aria-label={`${group.name || `Group ${groupIndex + 1}`} value ${valueIndex + 1}`} className="h-9 min-w-0 flex-1 rounded-md border px-2 text-sm outline-none focus:border-primary" />
                            <button type="button" onClick={() => removeValue(group.key, value.key)} disabled={group.values.length === 1 || submitting} aria-label={`Remove value ${valueIndex + 1}`} className="grid size-9 place-items-center rounded-md text-red-600 hover:bg-red-50 disabled:opacity-30"><X className="size-4" /></button>
                          </div>
                        ))}
                      </div>
                      <button type="button" onClick={() => updateGroup(group.key, (current) => ({ ...current, values: [...current.values, { key: draftKey("value"), value: "", lowStockThreshold: "2" }] }))} disabled={submitting} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"><Plus className="size-3.5" /> Add value</button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><h3 className="font-extrabold text-foreground">Physical inventory combinations</h3><p className="mt-1 text-xs text-muted-foreground">Keep only combinations that can physically exist. Zero-stock combinations are allowed.</p></div>
                  <Button type="button" variant="secondary" className="h-9 px-3" onClick={generateAllCombinations} disabled={submitting}><RefreshCw className="size-4" /> Generate all</Button>
                </div>
                <div className="mt-3 overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-surface-subtle text-left text-xs font-bold text-muted-foreground"><tr>{groups.map((group) => <th key={group.key} className="px-3 py-3">{group.name || "Unnamed option"}</th>)}<th className="px-3 py-3">Exact available</th><th className="px-3 py-3">Auto alert</th><th className="w-12 px-3 py-3" /></tr></thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((row, rowIndex) => (
                        <tr key={row.key} className="[content-visibility:auto]">
                          {groups.map((group) => (
                            <td key={group.key} className="px-3 py-3">
                              <select value={row.selections[group.key] ?? ""} onChange={(event) => setRows((current) => current.map((entry, index) => index === rowIndex ? { ...entry, selections: { ...entry.selections, [group.key]: event.target.value } } : entry))} aria-label={`Combination ${rowIndex + 1} ${group.name || "option"}`} className="h-10 w-full rounded-md border px-2 outline-none focus:border-primary">
                                <option value="">Choose {group.name || "option"}</option>
                                {group.values.map((value) => <option key={value.key} value={value.key}>{value.value || "Unnamed value"}</option>)}
                              </select>
                            </td>
                          ))}
                          <td className="px-3 py-3"><input type="number" min="0" max="10000000" step="1" inputMode="numeric" value={row.stock} onChange={(event) => setRows((current) => current.map((entry, index) => index === rowIndex ? { ...entry, stock: event.target.value } : entry))} aria-label={`Combination ${rowIndex + 1} exact available stock`} className="h-10 w-28 rounded-md border px-2 text-center outline-none focus:border-primary" /></td>
                          <td className="px-3 py-3"><div aria-label={`Combination ${rowIndex + 1} automatic low stock alert`} className="grid h-10 w-20 place-items-center rounded-md border bg-surface-subtle px-2 text-center text-xs font-bold text-muted-foreground">≤ {Math.ceil(displayInventoryInteger(row.stock) * lowStockPercent / 100)}</div></td>
                          <td className="px-3 py-3"><button type="button" disabled={rows.length === 1 || submitting} onClick={() => setRows((current) => current.filter((_, index) => index !== rowIndex))} aria-label={`Remove combination ${rowIndex + 1}`} className="grid size-8 place-items-center rounded-md text-red-600 hover:bg-red-50 disabled:opacity-30"><X className="size-4" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" onClick={() => setRows((current) => [...current, { key: draftKey("row"), selections: Object.fromEntries(groups.map((group) => [group.key, ""])), stock: "0", threshold: "2" }])} disabled={submitting || rows.length >= 500} className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline disabled:opacity-40"><Plus className="size-4" /> Add combination</button>
                <div className="mt-5 grid gap-3 rounded-lg border bg-surface-subtle p-4 sm:grid-cols-[minmax(0,280px)_1fr] sm:items-end"><ReorderAlertSelect value={lowStockPercent} onChange={setLowStockPercent} stockLevel={exactTotal} /><div><p className="font-extrabold text-foreground">New stock on hand: {exactTotal} units</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The same {lowStockPercent}% reorder alert applies to every combination automatically.</p></div></div>
              </section>
            </>
          ) : (
            <>
              <StockActionTabs value={stockAction} onChange={changeStockAction} disabled={submitting} />
              <StockActionIntro action={stockAction} />

              {stockAction !== "price" && batchResult ? (
                <UnitCostNeeded
                  batches={batchResult.batches}
                  drafts={openingCostDrafts}
                  onDraft={(batchId, value) => setOpeningCostDrafts((current) => ({ ...current, [batchId]: value }))}
                  onSave={(batchId) => void saveOpeningCost(batchId)}
                  submitting={submitting}
                />
              ) : null}

              {stockAction === "price" ? (
                <SellingPriceFields
                  currentPrice={product.price}
                  oldPrice={product.oldPrice ?? null}
                  value={newPrice}
                  onChange={setNewPrice}
                  latestCost={batchResult?.summary.latestCost ?? null}
                />
              ) : (
                <>
                  <div className="mt-5 overflow-hidden rounded-lg border">
                    <div className="grid grid-cols-[1fr_64px_96px_64px] items-center gap-2 bg-surface-subtle px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground sm:grid-cols-[1fr_90px_130px_90px] sm:px-4">
                      <span className="truncate">{product.skus[0]?.options.map((option) => option.optionName).join(" \u00b7 ") || "Size / option"}</span>
                      <span className="text-right">System</span>
                      <span className="text-center">{stockAction === "receive" ? "Qty received" : "Physical count"}</span>
                      <span className="text-center">{stockAction === "receive" ? "New total" : "Variance"}</span>
                    </div>
                    <div className="divide-y divide-border">
                      {product.skus.map((sku) => {
                        const entered = Math.max(0, Number(skuQuantities[sku.id]) || 0);
                        return (
                          <div key={sku.id} className="grid grid-cols-[1fr_64px_96px_64px] items-center gap-2 px-3 py-2 [content-visibility:auto] sm:grid-cols-[1fr_90px_130px_90px] sm:px-4">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-foreground" title={skuLabel(sku)}>{skuShortLabel(sku)}</p>
                              {sku.stock <= sku.lowStockThreshold ? <p className="text-[11px] font-semibold text-amber-700">At or below reorder alert ({sku.lowStockThreshold})</p> : null}
                            </div>
                            <span className="text-right text-sm tabular-nums text-muted-foreground">{sku.stock}</span>
                            <input
                              type="number"
                              min="0"
                              max="10000000"
                              step="1"
                              inputMode="numeric"
                              value={skuQuantities[sku.id] ?? "0"}
                              onFocus={(event) => event.currentTarget.select()}
                              onChange={(event) => setSkuQuantities((current) => ({ ...current, [sku.id]: event.target.value }))}
                              aria-label={`${skuLabel(sku)} ${stockAction === "receive" ? "quantity received" : "physical count"}`}
                              className="h-10 min-w-0 rounded-md border px-2 text-center text-base outline-none focus:border-primary"
                            />
                            <span className="text-center">
                              {stockAction === "receive"
                                ? <span className="text-sm font-bold tabular-nums">{sku.stock + entered}</span>
                                : <Variance value={entered - sku.stock} />}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {stockAction === "receive" ? (
                    <>
                      <div className="mt-5 grid items-start gap-4 sm:grid-cols-3">
                        <MoneyInput label="Unit cost" value={unitCost} onChange={setUnitCost} hint="Amount paid per unit; applies to every size in this delivery." />
                        <label className="grid gap-1.5 text-sm font-semibold">Date received<input type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} className="h-12 rounded-md border bg-white px-3 outline-none focus:border-primary" /></label>
                        <label className="grid gap-1.5 text-sm font-semibold">Supplier / Reference no. <span className="sr-only">(optional)</span><input type="text" maxLength={500} value={supplierNote} onChange={(event) => setSupplierNote(event.target.value)} placeholder="Optional, e.g. DR-1024" className="h-12 rounded-md border bg-white px-3 font-normal outline-none focus:border-primary" /></label>
                      </div>
                      <MarginNote price={product.price} unitCost={enteredUnitCost} />
                    </>
                  ) : (
                    <div className="mt-5">
                      <AdjustmentReasonFields reason={adjustmentReason} remarks={adjustmentRemarks} onReason={setAdjustmentReason} onRemarks={setAdjustmentRemarks} />
                    </div>
                  )}

                  <SummaryPanel rows={stockAction === "receive" ? [
                    { label: "Stock on hand", value: product.stock },
                    { label: "Quantity received", value: `+${restockAmount}` },
                    { label: "New stock on hand", value: resultingTotal, emphasis: true }
                  ] : [
                    { label: "System stock", value: product.stock },
                    { label: "Physical count", value: resultingTotal },
                    { label: "Variance", value: <Variance value={variance} className="text-base" />, emphasis: true }
                  ]} />
                  <p className="mt-3 text-xs text-muted-foreground">Reorder alert: {lowStockPercent}% of each size&apos;s stock level. Change it under Manage &gt; Edit details.</p>
                </>
              )}

              <CostHistory batchResult={batchResult} sellingPrice={product.price} />
              <button type="button" onClick={() => { setGroups(initialStructure.groups); setRows(initialStructure.rows); setMode("reconcile"); setError(""); }} className="mt-4 text-xs font-bold text-primary hover:underline">Edit options and rebuild combinations</button>
            </>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {mode === "restock" ? <SubmitHint text={submitting ? "" : missingInput} /> : null}
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="button" onClick={() => void (mode === "reconcile" ? saveReconciliation() : stockAction === "price" ? saveSellingPrice() : saveRestock())} disabled={submitting || (mode === "restock" && Boolean(missingInput))}>{submitting ? "Saving..." : mode === "reconcile" ? "Save structure & inventory" : stockAction === "receive" ? "Receive stock" : stockAction === "adjust" ? "Post adjustment" : "Update price"}</Button>
        </footer>
      </section>
    </div>
  );
}
