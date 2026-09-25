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
  type StaffProduct
} from "@/lib/staff-api";
import { getStaffInventoryBatches, verifyStaffOpeningBatchCost, type StaffInventoryBatchResult } from "@/lib/inventory-batch-api";
import { sortProductOptionValues } from "@/lib/product-display";
import { shopProductCardImage } from "@/lib/shop-assets";

export type SkuInventoryDialogProduct = {
  id: string;
  name: string;
  imageUrl: string;
  stock: number;
  price: number;
  skuInventoryEnabled: boolean;
  inventoryReconciledAt?: string | null;
  variants: Array<{
    id: string;
    optionName: string;
    optionValue: string;
    stock: number;
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
  returnFocus
}: {
  token: string;
  product: SkuInventoryDialogProduct;
  onClose: () => void;
  onSaved: (product: StaffProduct) => void;
  returnFocus?: HTMLElement | null;
}) {
  const dialog = useAccessibleDialog<HTMLElement>(true, onClose, { returnFocus });
  const confirm = useConfirmationDialog();
  const [initialStructure] = useState(() => {
    const groups = initialOptionGroups(product);
    return { groups, rows: initialReconcileRows(product, groups) };
  });
  const [mode, setMode] = useState<"restock" | "reconcile">(product.skuInventoryEnabled ? "restock" : "reconcile");
  const [stockMode, setStockMode] = useState<"add" | "set">("add");
  const [groups, setGroups] = useState<OptionGroupDraft[]>(initialStructure.groups);
  const [rows, setRows] = useState<ReconcileRow[]>(initialStructure.rows);
  const [skuQuantities, setSkuQuantities] = useState<Record<string, string>>(
    () => Object.fromEntries(product.skus.map((sku) => [sku.id, "0"]))
  );
  const [unitCost, setUnitCost] = useState("");
  const [sellingPrice, setSellingPrice] = useState(() => product.price.toFixed(2));
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [supplierNote, setSupplierNote] = useState("");
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
  const resultingTotal = stockMode === "set" ? restockAmount : product.stock + restockAmount;
  const enteredUnitCost = unitCost.trim() ? Number(unitCost) : null;
  const enteredSellingPrice = sellingPrice.trim() ? Number(sellingPrice) : null;
  const estimatedUnitProfit = enteredSellingPrice !== null && Number.isFinite(enteredSellingPrice) && enteredUnitCost !== null && Number.isFinite(enteredUnitCost) ? enteredSellingPrice - enteredUnitCost : null;
  const estimatedMargin = estimatedUnitProfit !== null && enteredSellingPrice !== null && enteredSellingPrice > 0 ? estimatedUnitProfit / enteredSellingPrice * 100 : null;

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

  const changeStockMode = (next: "add" | "set") => {
    setStockMode(next);
    setSkuQuantities(Object.fromEntries(product.skus.map((sku) => [
      sku.id,
      next === "set" ? String(sku.stock) : "0"
    ])));
    setError("");
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
          lowStockThreshold: requiredInventoryInteger(row.threshold, `Combination ${index + 1} alert level`)
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
        optionGroups
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
    try {
      const quantities = product.skus.map((sku, index) => ({
        skuId: sku.id,
        quantity: requiredInventoryInteger(
          skuQuantities[sku.id] ?? "",
          `Combination ${index + 1} quantity`
        )
      }));
      if (stockMode === "add" && !quantities.some((entry) => entry.quantity > 0)) {
        throw new Error("Enter at least one new item before saving.");
      }
      const parsedUnitCost = Number(unitCost);
      if (stockMode === "add" && (!unitCost.trim() || !Number.isFinite(parsedUnitCost) || parsedUnitCost < 0 || Math.round(parsedUnitCost * 100) !== parsedUnitCost * 100)) {
        throw new Error("Enter the unit acquisition cost with up to two decimal places.");
      }
      const parsedSellingPrice = Number(sellingPrice);
      if (stockMode === "add" && (!sellingPrice.trim() || !Number.isFinite(parsedSellingPrice) || parsedSellingPrice < 0 || parsedSellingPrice > 10_000_000 || Math.round(parsedSellingPrice * 100) !== parsedSellingPrice * 100)) {
        throw new Error("Enter a selling price from PHP 0.00 to PHP 10,000,000.00 with up to two decimal places.");
      }
      if (stockMode === "add" && !receivedAt) throw new Error("Choose the date the stock was received.");
      const totalQuantity = quantities.reduce((total, entry) => total + entry.quantity, 0);
      const sellingPriceChanged = stockMode === "add" && parsedSellingPrice !== product.price;
      const confirmed = await confirm({
        title: stockMode === "add" ? "Add this inventory stock?" : "Save these corrected stock counts?",
        description: stockMode === "add"
          ? `${totalQuantity} new item${totalQuantity === 1 ? "" : "s"} will be added across ${product.skus.length} physical combination${product.skus.length === 1 ? "" : "s"} for ${product.name}.${sellingPriceChanged ? ` Its selling price will change from PHP ${product.price.toFixed(2)} to PHP ${parsedSellingPrice.toFixed(2)} for future sales.` : ""}`
          : `The exact available counts for all ${product.skus.length} physical combination${product.skus.length === 1 ? "" : "s"} of ${product.name} will be replaced by the values shown.`,
        confirmLabel: stockMode === "add" ? "Add stock" : "Save corrected counts",
        tone: stockMode === "add" ? "default" : "warning"
      });
      if (!confirmed) return;

      setSubmitting(true);
      const updated = await restockStaffProductSkus(token, product.id, {
        mode: stockMode,
        quantities,
        notes: stockMode === "add" ? "New stock received." : "Available stock count corrected.",
        ...(stockMode === "add" ? {
          unitCost: parsedUnitCost,
          sellingPrice: parsedSellingPrice,
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
      setError("Enter a valid opening unit cost with up to two decimal places.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      setBatchResult(await verifyStaffOpeningBatchCost(token, product.id, batchId, parsed));
    } catch (saveError) {
      setError(userFacingErrorMessage(saveError, "Unable to verify the opening batch cost."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10020] grid place-items-center overflow-hidden bg-[#101820]/50 p-2 sm:p-4">
      <section ref={dialog.dialogRef} {...dialog.dialogProps} className="flex max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
        <header className="flex shrink-0 items-start gap-3 border-b border-[#e1e8e2] p-4 sm:p-5">
          <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-[#f8fbf8]">
            <Image src={shopProductCardImage(product.imageUrl)} alt={product.name} fill sizes="64px" unoptimized className="object-contain p-1" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={dialog.titleId} className="text-xl font-extrabold text-foreground">{mode === "reconcile" ? "Set up inventory" : "Update stock"}</h2>
            <p className="mt-1 truncate text-sm font-bold text-foreground">{product.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Current available total: {product.stock} items</p>
          </div>
          <button type="button" data-dialog-autofocus onClick={onClose} disabled={submitting} aria-label="Close inventory dialog" className="grid size-9 place-items-center rounded-md hover:bg-[#eef3ee] disabled:opacity-50"><X /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {error ? <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}

          {mode === "reconcile" ? (
            <>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <div className="flex gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0" /><div><p className="font-extrabold">Atomic option and inventory setup</p><p className="mt-1 text-xs leading-5">Edit the complete option structure, then enter the combinations physically available. The structure, combinations, and totals save together or not at all.</p></div></div>
              </div>

              <section className="mt-5 rounded-lg border border-border bg-[#fbfdfb] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><h3 className="font-extrabold text-foreground">Option structure</h3><p className="mt-1 text-xs text-muted-foreground">Add Size, Color, Waist, Length, Clip Type, or another physical attribute.</p></div>
                  <Button type="button" variant="secondary" className="h-9 px-3" onClick={addGroup} disabled={submitting || groups.length >= 12}><Plus className="size-4" /> Add group</Button>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  {groups.map((group, groupIndex) => (
                    <div key={group.key} className="rounded-lg border border-border bg-white p-3">
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
                <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-[#f6f9f6] text-left text-xs font-bold text-muted-foreground"><tr>{groups.map((group) => <th key={group.key} className="px-3 py-3">{group.name || "Unnamed option"}</th>)}<th className="px-3 py-3">Exact available</th><th className="px-3 py-3">Warn at</th><th className="w-12 px-3 py-3" /></tr></thead>
                    <tbody className="divide-y divide-[#e7ece8]">
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
                          <td className="px-3 py-3"><input type="number" min="0" max="10000000" step="1" inputMode="numeric" value={row.threshold} onChange={(event) => setRows((current) => current.map((entry, index) => index === rowIndex ? { ...entry, threshold: event.target.value } : entry))} aria-label={`Combination ${rowIndex + 1} low stock alert`} className="h-10 w-20 rounded-md border px-2 text-center outline-none focus:border-primary" /></td>
                          <td className="px-3 py-3"><button type="button" disabled={rows.length === 1 || submitting} onClick={() => setRows((current) => current.filter((_, index) => index !== rowIndex))} aria-label={`Remove combination ${rowIndex + 1}`} className="grid size-8 place-items-center rounded-md text-red-600 hover:bg-red-50 disabled:opacity-30"><X className="size-4" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" onClick={() => setRows((current) => [...current, { key: draftKey("row"), selections: Object.fromEntries(groups.map((group) => [group.key, ""])), stock: "0", threshold: "2" }])} disabled={submitting || rows.length >= 500} className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline disabled:opacity-40"><Plus className="size-4" /> Add combination</button>
                <div className="mt-5 rounded-lg bg-primary/10 px-4 py-3"><p className="font-extrabold text-foreground">New available total: {exactTotal} items</p><p className="mt-0.5 text-xs text-muted-foreground">Calculated from the physical combinations above.</p></div>
              </section>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="text-sm font-extrabold text-foreground">{stockMode === "add" ? "Add newly received stock" : "Correct available stock"}</p><p className="mt-1 text-xs text-muted-foreground">{stockMode === "add" ? "Enter only the pieces that arrived for each combination." : "Enter the exact stock still available for new reservations. Exact correction is blocked while this product has active reservations."}</p></div>
                <button type="button" onClick={() => changeStockMode(stockMode === "add" ? "set" : "add")} className="text-xs font-bold text-primary hover:underline">{stockMode === "add" ? "Need to correct the count?" : "Back to adding stock"}</button>
              </div>
              {batchResult?.summary.unverifiedQuantity ? <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4"><h3 className="text-sm font-extrabold text-amber-900">Opening costs need verification</h3><p className="mt-1 text-xs text-amber-800">Set each migrated combination’s acquisition cost before it can be released through FIFO.</p><div className="mt-3 space-y-2">{batchResult.batches.filter((batch) => !batch.costVerified).map((batch) => <div key={batch.id} className="grid gap-2 rounded-md bg-white p-3 sm:grid-cols-[1fr_150px_auto] sm:items-center"><div><p className="text-xs font-bold text-foreground">{batch.sku?.optionSnapshot?.map((option) => option.optionValue).join(" · ") || batch.batchCode}</p><p className="text-xs text-muted-foreground">{batch.quantityRemaining} item(s)</p></div><div className="flex h-10 items-center rounded-md border px-2"><span className="mr-1 text-xs font-bold text-muted-foreground">PHP</span><input type="number" min="0" step="0.01" inputMode="decimal" value={openingCostDrafts[batch.id] ?? ""} onChange={(event) => setOpeningCostDrafts((current) => ({ ...current, [batch.id]: event.target.value }))} className="min-w-0 flex-1 outline-none" placeholder="0.00" /></div><Button type="button" className="h-10" disabled={submitting || !openingCostDrafts[batch.id]} onClick={() => void saveOpeningCost(batch.id)}>Verify</Button></div>)}</div></section> : null}
              {batchResult ? <details className="mt-4 rounded-lg border border-border bg-muted/40 p-4"><summary className="cursor-pointer text-sm font-bold text-primary">View FIFO batch history ({batchResult.batches.length})</summary><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="text-muted-foreground"><tr><th className="py-2 pr-3">Combination</th><th className="py-2 pr-3">Batch</th><th className="py-2 pr-3">Cost</th><th className="py-2 pr-3">Received</th><th className="py-2">Remaining</th></tr></thead><tbody className="divide-y divide-border">{batchResult.batches.map((batch) => <tr key={batch.id}><td className="py-2 pr-3 font-bold">{batch.sku?.optionSnapshot?.map((option) => option.optionValue).join(" / ") || "Product total"}</td><td className="py-2 pr-3">{batch.batchCode}</td><td className="py-2 pr-3">{batch.costVerified ? `PHP ${Number(batch.unitCost).toFixed(2)}` : "Needs verification"}</td><td className="py-2 pr-3">{batch.quantityReceived}</td><td className="py-2 font-bold">{batch.quantityRemaining}</td></tr>)}</tbody></table></div></details> : null}
              <div className="mt-5 overflow-hidden rounded-lg border border-border">
                <div className="hidden grid-cols-[1fr_100px_120px] gap-3 bg-[#f6f9f6] px-4 py-3 text-xs font-bold text-muted-foreground sm:grid"><span>Inventory combination</span><span>Current</span><span>{stockMode === "add" ? "Add" : "Exact available"}</span></div>
                <div className="divide-y divide-[#e7ece8]">
                  {product.skus.map((sku, index) => (
                    <div key={sku.id} className="grid gap-2 px-4 py-3 [content-visibility:auto] sm:grid-cols-[1fr_100px_120px] sm:items-center">
                      <div><p className="text-sm font-bold text-foreground">{skuLabel(sku)}</p>{sku.stock <= sku.lowStockThreshold ? <p className="mt-0.5 text-xs font-semibold text-amber-700">Low stock · alert at {sku.lowStockThreshold}</p> : null}</div>
                      <p className="text-sm"><span className="text-muted-foreground sm:hidden">Current: </span><span className="font-extrabold">{sku.stock}</span></p>
                      <input type="number" min="0" max="10000000" step="1" inputMode="numeric" value={skuQuantities[sku.id] ?? "0"} onChange={(event) => setSkuQuantities((current) => ({ ...current, [sku.id]: event.target.value }))} aria-label={`Combination ${index + 1} ${stockMode === "add" ? "new quantity" : "exact available quantity"}`} className="h-10 rounded-md border px-2 text-center outline-none focus:border-primary" />
                    </div>
                  ))}
                </div>
              </div>
              {stockMode === "add" ? (
                <section className="mt-5 rounded-lg border border-border bg-muted/40 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-sm font-semibold">Unit acquisition cost<div className="flex h-11 items-center rounded-md border bg-white px-3 focus-within:border-primary"><span className="mr-2 text-xs font-bold text-muted-foreground">PHP</span><input type="number" min="0" max="10000000" step="0.01" inputMode="decimal" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} placeholder="0.00" className="min-w-0 flex-1 bg-transparent outline-none" /></div></label>
                    <label className="grid gap-1.5 text-sm font-semibold">Selling price<div className="flex h-11 items-center rounded-md border bg-white px-3 focus-within:border-primary"><span className="mr-2 text-xs font-bold text-muted-foreground">PHP</span><input aria-label="Selling price" type="number" min="0" max="10000000" step="0.01" inputMode="decimal" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} placeholder="0.00" className="min-w-0 flex-1 bg-transparent outline-none" /></div><span className="text-xs font-normal leading-4 text-muted-foreground">Applies to the whole product and future sales.</span></label>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold">Date received<input type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} className="h-11 rounded-md border bg-white px-3 outline-none focus:border-primary" /></label><label className="grid gap-1.5 text-sm font-semibold">Supplier reference <span className="font-normal text-muted-foreground">(optional)</span><input type="text" maxLength={500} value={supplierNote} onChange={(event) => setSupplierNote(event.target.value)} placeholder="Invoice or delivery receipt" className="h-11 rounded-md border bg-white px-3 font-normal outline-none focus:border-primary" /></label></div>
                  <div className="mt-4 grid gap-2 rounded-md border border-border bg-white p-3 sm:grid-cols-3"><div><p className="text-xs font-bold text-muted-foreground">Selling price after saving</p><p className="mt-1 font-extrabold">{enteredSellingPrice === null || !Number.isFinite(enteredSellingPrice) ? "Enter price" : `PHP ${enteredSellingPrice.toFixed(2)}`}</p></div><div><p className="text-xs font-bold text-muted-foreground">New unit cost</p><p className="mt-1 font-extrabold">{enteredUnitCost === null || !Number.isFinite(enteredUnitCost) ? "Enter cost" : `PHP ${enteredUnitCost.toFixed(2)}`}</p></div><div><p className="text-xs font-bold text-muted-foreground">Estimated gross profit</p><p className={estimatedUnitProfit !== null && estimatedUnitProfit < 0 ? "mt-1 font-extrabold text-red-700" : "mt-1 font-extrabold text-primary"}>{estimatedUnitProfit === null ? "—" : `PHP ${estimatedUnitProfit.toFixed(2)} / item${estimatedMargin === null ? "" : ` (${estimatedMargin.toFixed(1)}%)`}`}</p></div></div>
                  {estimatedUnitProfit !== null && estimatedUnitProfit < 0 ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">Warning: this acquisition cost is higher than the current selling price.</p> : null}
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">The selling price applies to the whole product and future sales. The same acquisition cost applies to this delivery; completed historical sales keep their original price and FIFO cost allocation.</p>
                </section>
              ) : null}
              <div className="mt-5 flex items-center gap-3 rounded-lg bg-primary/10 px-4 py-3"><RefreshCw className="size-5 text-primary" /><div><p className="font-extrabold text-foreground">{stockMode === "add" ? `Total items to add: ${restockAmount}` : `Corrected available total: ${resultingTotal}`}</p><p className="mt-0.5 text-xs text-muted-foreground">{stockMode === "add" ? `After saving: ${resultingTotal} available items` : "The product total will be recalculated from these exact available counts."}</p></div></div>
              <button type="button" onClick={() => { setGroups(initialStructure.groups); setRows(initialStructure.rows); setMode("reconcile"); setError(""); }} className="mt-4 text-xs font-bold text-primary hover:underline">Edit options and rebuild combinations</button>
            </>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-[#e1e8e2] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="button" onClick={() => void (mode === "reconcile" ? saveReconciliation() : saveRestock())} disabled={submitting}>{submitting ? "Saving..." : mode === "reconcile" ? "Save structure & inventory" : stockMode === "add" ? "Confirm & add" : "Save corrected stock"}</Button>
        </footer>
      </section>
    </div>
  );
}
