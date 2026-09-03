export type VariantStockOption = {
  id: string;
  optionName: string;
  optionValue: string;
  stock: number;
};

export type VariantSelectionIssue =
  | { code: "MISSING_OPTION"; optionName: string }
  | { code: "DUPLICATE_OPTION"; optionName: string }
  | { code: "UNKNOWN_OPTION"; optionName: string }
  | { code: "UNKNOWN_VALUE"; optionName: string; optionValue: string }
  | { code: "UNEXPECTED_OPTION"; optionName: string };

export type VariantAllocationIssue =
  | { code: "DUPLICATE_VARIANT"; optionName: string; optionValue: string }
  | { code: "TOTAL_MISMATCH"; optionName: string; expectedTotal: number; actualTotal: number };

export function normalizeVariantPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseVariantSelections(summary?: string | null) {
  if (!summary?.trim()) return [];

  return summary
    .split("|")
    .map((section) => section.trim())
    .filter((section) => section && !section.toLowerCase().startsWith("note:"))
    .flatMap((section) => section.split(","))
    .map((part) => part.trim())
    .map((part) => {
      const separatorIndex = part.indexOf(":");
      if (separatorIndex === -1) return null;

      const optionName = part.slice(0, separatorIndex).trim();
      const optionValue = part.slice(separatorIndex + 1).trim();
      if (!optionName || !optionValue) return null;

      return { optionName, optionValue };
    })
    .filter((selection): selection is { optionName: string; optionValue: string } => Boolean(selection));
}

function groupVariants<T extends Pick<VariantStockOption, "optionName">>(variants: T[]) {
  const groups = new Map<string, { optionName: string; variants: T[] }>();
  for (const variant of variants) {
    const key = normalizeVariantPart(variant.optionName);
    const group = groups.get(key) ?? { optionName: variant.optionName.trim(), variants: [] };
    group.variants.push(variant);
    groups.set(key, group);
  }
  return groups;
}

export function selectStockVariantGroup<T extends Pick<VariantStockOption, "optionName">>(variants: T[]): T[] {
  if (!variants.length) return [];

  const groups = groupVariants(variants);
  const entries = Array.from(groups.entries());
  const exact = (name: string) => entries.find(([key]) => key === normalizeVariantPart(name));
  const contains = (part: string) => entries.find(([key]) => key.includes(normalizeVariantPart(part)));

  const selected =
    exact("size")
    ?? contains("size")
    ?? exact("waist")
    ?? exact("length")
    ?? entries[0];

  return selected?.[1].variants ?? [];
}

export function stockVariantOptionName<T extends Pick<VariantStockOption, "optionName">>(variants: T[]) {
  return selectStockVariantGroup(variants)[0]?.optionName?.trim() ?? null;
}

export function resolveReservationVariantSelections<T extends VariantStockOption>(input: {
  variants: T[];
  summary?: string | null;
  strict?: boolean;
}): { selected: T[]; issue: VariantSelectionIssue | null } {
  const selections = parseVariantSelections(input.summary);
  const strict = input.strict !== false;
  const stockVariants = selectStockVariantGroup(input.variants);
  const groups = groupVariants(stockVariants);

  if (!groups.size) {
    return selections.length && strict
      ? { selected: [], issue: { code: "UNEXPECTED_OPTION", optionName: selections[0].optionName } }
      : { selected: [], issue: null };
  }

  if (!strict) {
    const selected = selections.flatMap((selection) => {
      const group = groups.get(normalizeVariantPart(selection.optionName));
      const variant = group?.variants.find(
        (entry) => normalizeVariantPart(entry.optionValue) === normalizeVariantPart(selection.optionValue)
      );
      return variant ? [variant] : [];
    });
    return { selected, issue: null };
  }

  const selectionsByGroup = new Map<string, typeof selections>();
  for (const selection of selections) {
    const groupKey = normalizeVariantPart(selection.optionName);
    const group = groups.get(groupKey);
    if (!group) {
      continue;
    }

    const groupSelections = selectionsByGroup.get(groupKey) ?? [];
    groupSelections.push(selection);
    selectionsByGroup.set(groupKey, groupSelections);
    if (groupSelections.length > 1) {
      return { selected: [], issue: { code: "DUPLICATE_OPTION", optionName: group.optionName } };
    }
  }

  for (const [groupKey, group] of groups) {
    const selection = selectionsByGroup.get(groupKey)?.[0];
    if (!selection) {
      return { selected: [], issue: { code: "MISSING_OPTION", optionName: group.optionName } };
    }

    const variant = group.variants.find(
      (entry) => normalizeVariantPart(entry.optionValue) === normalizeVariantPart(selection.optionValue)
    );
    if (!variant) {
      return {
        selected: [],
        issue: {
          code: "UNKNOWN_VALUE",
          optionName: group.optionName,
          optionValue: selection.optionValue
        }
      };
    }
  }

  return {
    selected: Array.from(groups.keys()).map((groupKey) => {
      const group = groups.get(groupKey)!;
      const selection = selectionsByGroup.get(groupKey)![0];
      return group.variants.find(
        (entry) => normalizeVariantPart(entry.optionValue) === normalizeVariantPart(selection.optionValue)
      )!;
    }),
    issue: null
  };
}

export function validateVariantGroupTotals<T extends Pick<VariantStockOption, "optionName" | "optionValue" | "stock">>(
  variants: T[],
  expectedTotal: number
): VariantAllocationIssue | null {
  const seen = new Set<string>();
  for (const variant of variants) {
    const key = `${normalizeVariantPart(variant.optionName)}:${normalizeVariantPart(variant.optionValue)}`;
    if (seen.has(key)) {
      return {
        code: "DUPLICATE_VARIANT",
        optionName: variant.optionName,
        optionValue: variant.optionValue
      };
    }
    seen.add(key);
  }

  const stockVariants = selectStockVariantGroup(variants);
  if (stockVariants.length) {
    const actualTotal = stockVariants.reduce((total, variant) => total + variant.stock, 0);
    const optionName = stockVariants[0]?.optionName ?? "Option";
    if (actualTotal !== expectedTotal) {
      return {
        code: "TOTAL_MISMATCH",
        optionName,
        expectedTotal,
        actualTotal
      };
    }
  }

  return null;
}

export function optionGroupsHaveAvailableStock<T extends Pick<VariantStockOption, "optionName" | "stock">>(variants: T[]) {
  const stockVariants = selectStockVariantGroup(variants);
  if (!stockVariants.length) return true;
  return stockVariants.some((variant) => variant.stock > 0);
}
