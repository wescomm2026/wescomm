"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  syncStaffProductVariants,
  type StaffProduct,
  type StaffProductVariant
} from "@/lib/staff-api";
import { sortProductOptionValues } from "@/lib/product-display";

type DraftValue = {
  key: string;
  id?: string;
  value: string;
  stock: number;
  lowStockThreshold: string;
};

export type ProductOptionsManagerProduct = {
  id: string;
  stock: number;
  skuInventoryEnabled: boolean;
  variants: StaffProductVariant[];
  skus: Array<{ variantIds: string[] }>;
};

type OptionGroup = {
  name: string;
  values: StaffProductVariant[];
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function draftKey() {
  return `option-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function groupVariants(product: ProductOptionsManagerProduct): OptionGroup[] {
  const groups = new Map<string, StaffProductVariant[]>();
  for (const variant of product.variants ?? []) {
    const values = groups.get(variant.optionName) ?? [];
    values.push(variant);
    groups.set(variant.optionName, values);
  }
  return Array.from(groups.entries()).map(([name, values]) => ({
    name,
    values: sortProductOptionValues(name, values.map((value) => value.optionValue))
      .map((optionValue) => values.find((entry) => entry.optionValue === optionValue)!)
  }));
}

function draftsForGroup(group?: OptionGroup): DraftValue[] {
  return (group?.values ?? []).map((variant) => ({
    key: variant.id ?? draftKey(),
    id: variant.id,
    value: variant.optionValue,
    stock: variant.stock,
    lowStockThreshold: String(variant.lowStockThreshold ?? 2)
  }));
}

export function ProductOptionsManager({
  token,
  product,
  onSaved,
  onDone
}: {
  token: string;
  product: ProductOptionsManagerProduct;
  onSaved: (product: StaffProduct) => void;
  onDone: () => void;
}) {
  const groups = useMemo(() => groupVariants(product), [product]);
  const [activeGroupName, setActiveGroupName] = useState(groups[0]?.name ?? "");
  const activeGroup = groups.find((group) => group.name === activeGroupName) ?? groups[0];
  const [drafts, setDrafts] = useState<DraftValue[]>(() => draftsForGroup(activeGroup));
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const linkedVariantIds = useMemo(
    () => new Set((product.skus ?? []).flatMap((sku) => sku.variantIds)),
    [product.skus]
  );
  const canCreateNewGroup = !product.skuInventoryEnabled;

  const selectGroup = (name: string) => {
    const group = groups.find((entry) => entry.name === name);
    setActiveGroupName(name);
    setDrafts(draftsForGroup(group));
    setCreatingGroup(false);
    setNewGroupName("");
    setError("");
  };

  const startNewGroup = () => {
    setCreatingGroup(true);
    setActiveGroupName("");
    setNewGroupName("");
    setDrafts([{ key: draftKey(), value: "", stock: 0, lowStockThreshold: "2" }]);
    setError("");
  };

  const save = async () => {
    const optionName = (creatingGroup ? newGroupName : activeGroup?.name ?? "").trim();
    if (!optionName) {
      setError("Enter an option name such as Size, Waist, Length, Color, or Clip Type.");
      return;
    }
    const cleaned = drafts.map((draft) => ({
      ...draft,
      value: draft.value.trim(),
      lowStockThreshold: Number(draft.lowStockThreshold)
    }));
    if (!cleaned.length) {
      setError("Add at least one option value, or use Remove group if the group is no longer needed.");
      return;
    }
    if (cleaned.some((draft) => !draft.value)) {
      setError("Every option value needs a label.");
      return;
    }
    const seen = new Set<string>();
    for (const draft of cleaned) {
      const key = normalize(draft.value);
      if (seen.has(key)) {
        setError(`${draft.value} is listed more than once.`);
        return;
      }
      seen.add(key);
      if (!Number.isInteger(draft.lowStockThreshold) || draft.lowStockThreshold < 0) {
        setError(`${draft.value}: warning level must be a whole number of 0 or more.`);
        return;
      }
    }

    setSaving(true);
    setError("");
    try {
      const updated = await syncStaffProductVariants(
        token,
        product.id,
        optionName,
        cleaned.map((draft) => ({
          ...(draft.id ? { id: draft.id } : {}),
          optionValue: draft.value,
          lowStockThreshold: draft.lowStockThreshold
        }))
      );
      onSaved(updated);
      onDone();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save product options.");
    } finally {
      setSaving(false);
    }
  };

  const removeGroup = async () => {
    if (!activeGroup) return;
    if (!window.confirm(`Remove the ${activeGroup.name} option group?`)) return;
    setSaving(true);
    setError("");
    try {
      const updated = await syncStaffProductVariants(token, product.id, activeGroup.name, []);
      onSaved(updated);
      onDone();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to remove this option group.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-extrabold text-[#253029]">Product options</p>
        <p className="mt-1 text-xs leading-5 text-[#68746d]">
          Options describe the physical item, such as Size, Waist, Length, Color, or Clip Type. Stock is managed separately by inventory combination.
        </p>
      </div>

      {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {groups.map((group) => (
          <button
            key={group.name}
            type="button"
            onClick={() => selectGroup(group.name)}
            className={`rounded-md border px-3 py-2 text-xs font-bold ${!creatingGroup && activeGroup?.name === group.name ? "border-primary bg-[#eef6ef] text-primary" : "border-[#dce5dd] bg-white text-[#59655d] hover:bg-[#f8fbf8]"}`}
          >
            {group.name} · {group.values.length}
          </button>
        ))}
        <Button type="button" variant="secondary" className="h-9 px-3" onClick={startNewGroup} disabled={!canCreateNewGroup || saving}>
          <Plus className="size-4" /> New option
        </Button>
      </div>

      {!canCreateNewGroup ? (
        <p className="rounded-md border border-[#dce5dd] bg-[#f8fbf8] px-3 py-2 text-xs leading-5 text-[#68746d]">
          {product.skuInventoryEnabled
            ? "Use Edit options and rebuild combinations under Update stock to add a completely new option group atomically. You can still add a value such as 3XL here; it starts at zero until included in a combination."
            : "Add the option groups you need, then use Inventory combinations to enter the exact physical stock. The current product total is preserved until reconciliation is saved."}
        </p>
      ) : null}

      {(activeGroup || creatingGroup) ? (
        <div className="overflow-hidden rounded-lg border border-[#dce5dd] bg-white">
          <div className="border-b border-[#e7ece8] bg-[#f6f9f6] px-4 py-3">
            {creatingGroup ? (
              <label className="grid max-w-xs gap-1 text-xs font-bold text-[#59655d]">
                Option name
                <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="e.g. Color" className="h-10 rounded-md border bg-white px-3 text-sm font-normal text-[#253029] outline-none focus:border-primary" />
              </label>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-sm font-extrabold text-[#253029]">{activeGroup?.name}</p><p className="mt-0.5 text-xs text-[#68746d]">Edit labels or add another value.</p></div>
                <button type="button" onClick={() => void removeGroup()} disabled={saving || Boolean(activeGroup?.values.some((variant) => variant.id && linkedVariantIds.has(variant.id)))} className="inline-flex items-center gap-1 text-xs font-bold text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40" title={activeGroup?.values.some((variant) => variant.id && linkedVariantIds.has(variant.id)) ? "This group is used by active inventory combinations. Rebuild combinations before removing it." : undefined}><Trash2 className="size-3.5" /> Remove group</button>
              </div>
            )}
          </div>

          <div className="divide-y divide-[#e7ece8]">
            {drafts.map((draft, index) => {
              const linked = Boolean(draft.id && linkedVariantIds.has(draft.id));
              return (
                <div key={draft.key} className="grid grid-cols-[1fr_78px_40px] items-center gap-2 px-3 py-3">
                  <div>
                    <input value={draft.value} onChange={(event) => setDrafts((current) => current.map((entry) => entry.key === draft.key ? { ...entry, value: event.target.value } : entry))} placeholder={`Value ${index + 1}`} className="h-10 w-full rounded-md border px-3 text-sm outline-none focus:border-primary" />
                    {draft.id ? <p className="mt-1 text-[10px] text-[#7a877f]">Current derived stock: {draft.stock}</p> : <p className="mt-1 text-[10px] text-[#7a877f]">New values start at 0 stock.</p>}
                  </div>
                  <input type="number" min="0" step="1" inputMode="numeric" value={draft.lowStockThreshold} disabled={product.skuInventoryEnabled} onChange={(event) => setDrafts((current) => current.map((entry) => entry.key === draft.key ? { ...entry, lowStockThreshold: event.target.value } : entry))} title={product.skuInventoryEnabled ? "Low-stock alerts are set per inventory combination." : "Low-stock warning"} className="h-10 rounded-md border px-2 text-center text-sm disabled:bg-[#f2f5f2] disabled:text-[#829087]" />
                  <button type="button" disabled={saving || linked || drafts.length === 1} onClick={() => setDrafts((current) => current.filter((entry) => entry.key !== draft.key))} aria-label={`Remove ${draft.value || `value ${index + 1}`}`} title={linked ? "This value is used by an active inventory combination." : undefined} className="grid size-10 place-items-center rounded-md text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-35"><Trash2 className="size-4" /></button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e7ece8] px-3 py-3">
            <Button type="button" variant="secondary" className="h-9 px-3" onClick={() => setDrafts((current) => [...current, { key: draftKey(), value: "", stock: 0, lowStockThreshold: "2" }])} disabled={saving}><Plus className="size-4" /> Add value</Button>
            <div className="flex gap-2"><Button type="button" variant="secondary" onClick={onDone} disabled={saving}>Cancel</Button><Button type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save options"}</Button></div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[#cddbd0] bg-[#f8fbf8] px-4 py-6 text-center text-sm text-[#68746d]">No options yet. Use New option to add Size, Waist, Length, Color, Clip Type, or another attribute, then set up the physical inventory combinations.</div>
      )}
    </div>
  );
}
