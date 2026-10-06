/**
 * Builds the printable inventory report (the system's version of the paper
 * "ending inventory" sheets): every active product grouped by category, with one
 * line per size/option combination and category and grand totals.
 */

export type InventoryReportProductRow = {
  id: string;
  name: string;
  saleMode: "SIMPLE" | "CLOTH_ONLY" | "OPTIONS";
  skuInventoryEnabled: boolean;
  price: number;
  stock: number;
  unverifiedCostQuantity: number;
  category: { name: string; slug: string };
  skus: Array<{ stock: number; options: Array<{ optionName: string; optionValue: string }> }>;
};

export type InventoryReportLine = { label: string; stock: number };

export type InventoryReportItem = {
  productId: string;
  name: string;
  saleMode: InventoryReportProductRow["saleMode"];
  unitPrice: number;
  total: number;
  /** Size/option lines; empty for items counted as a single quantity. */
  lines: InventoryReportLine[];
  needsPrice: boolean;
  unverifiedCostQuantity: number;
  /** Sold with options but stock is not yet tracked per combination. */
  setupRequired: boolean;
};

export type InventoryReportCategory = { name: string; slug: string; total: number; items: InventoryReportItem[] };

export type InventoryReport = {
  generatedAt: string;
  generatedBy: string | null;
  filters: { categorySlug: string | null; includeZeroStock: boolean };
  categories: InventoryReportCategory[];
  totals: { products: number; lines: number; units: number; needsPrice: number; unverifiedCostUnits: number };
};

const LETTER_RANK = new Map<string, number>([
  ["xxxs", 0], ["3xs", 0], ["xxs", 1], ["2xs", 1], ["xs", 2], ["s", 3], ["small", 3], ["m", 4], ["medium", 4],
  ["l", 5], ["large", 5], ["xl", 6], ["2xl", 7], ["xxl", 7], ["3xl", 8], ["xxxl", 8], ["4xl", 9], ["xxxxl", 9], ["5xl", 10]
]);

/** Children's numbered sizes (#8, #10 ...) first, then XS to 5XL, then anything else alphabetically. */
export function compareSizeLabels(left: string, right: string) {
  const rank = (value: string) => {
    const key = value.trim().toLowerCase();
    const numbered = key.match(/^#?\s*(\d{1,3})$/);
    if (numbered) return Number(numbered[1]) - 1000;
    return LETTER_RANK.get(key);
  };
  const leftRank = rank(left);
  const rightRank = rank(right);
  if (leftRank !== undefined && rightRank !== undefined && leftRank !== rightRank) return leftRank - rightRank;
  if (leftRank !== undefined && rightRank === undefined) return -1;
  if (leftRank === undefined && rightRank !== undefined) return 1;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

// Size reads first ("M / Red"); other option groups follow alphabetically.
function sizeFirst(left: { optionName: string }, right: { optionName: string }) {
  const leftIsSize = /size/i.test(left.optionName);
  const rightIsSize = /size/i.test(right.optionName);
  if (leftIsSize !== rightIsSize) return leftIsSize ? -1 : 1;
  return left.optionName.localeCompare(right.optionName);
}

function skuLabel(options: InventoryReportProductRow["skus"][number]["options"]) {
  return options.map((option) => option.optionValue).join(" / ") || "Standard";
}

function compareSkuOptions(
  left: InventoryReportProductRow["skus"][number],
  right: InventoryReportProductRow["skus"][number]
) {
  const length = Math.max(left.options.length, right.options.length);
  for (let index = 0; index < length; index += 1) {
    const leftOption = left.options[index];
    const rightOption = right.options[index];
    if (!leftOption || !rightOption) return left.options.length - right.options.length;
    const isSize = /size/i.test(leftOption.optionName);
    const order = isSize
      ? compareSizeLabels(leftOption.optionValue, rightOption.optionValue)
      : leftOption.optionValue.localeCompare(rightOption.optionValue, undefined, { numeric: true, sensitivity: "base" });
    if (order !== 0) return order;
  }
  return 0;
}

// Like the paper sheets: cloth sets first, then items with sizes, then single items.
const SALE_MODE_ORDER: Record<InventoryReportItem["saleMode"], number> = { CLOTH_ONLY: 0, OPTIONS: 1, SIMPLE: 2 };

function compareReportItems(left: InventoryReportItem, right: InventoryReportItem) {
  return SALE_MODE_ORDER[left.saleMode] - SALE_MODE_ORDER[right.saleMode]
    || left.name.localeCompare(right.name, undefined, { numeric: true });
}

export function buildInventoryReport(
  rows: InventoryReportProductRow[],
  options: { generatedAt: Date; generatedBy: string | null; categorySlug?: string | null; includeZeroStock?: boolean }
): InventoryReport {
  const includeZeroStock = options.includeZeroStock ?? true;
  const categories = new Map<string, InventoryReportCategory>();

  for (const row of rows) {
    if (options.categorySlug && row.category.slug !== options.categorySlug) continue;
    const tracksSkus = row.saleMode === "OPTIONS" && row.skuInventoryEnabled;
    const lines = tracksSkus
      ? [...row.skus]
          .map((sku) => ({ ...sku, options: [...sku.options].sort(sizeFirst) }))
          .sort(compareSkuOptions)
          .map((sku) => ({ label: skuLabel(sku.options), stock: sku.stock }))
      : [];
    const total = tracksSkus ? lines.reduce((sum, line) => sum + line.stock, 0) : row.stock;
    if (!includeZeroStock && total <= 0) continue;

    const category = categories.get(row.category.slug) ?? { name: row.category.name, slug: row.category.slug, total: 0, items: [] };
    category.items.push({
      productId: row.id,
      name: row.name,
      saleMode: row.saleMode,
      unitPrice: row.price,
      total,
      lines: includeZeroStock ? lines : lines.filter((line) => line.stock > 0),
      needsPrice: row.price <= 0,
      unverifiedCostQuantity: row.unverifiedCostQuantity,
      setupRequired: row.saleMode === "OPTIONS" && !row.skuInventoryEnabled
    });
    category.total += total;
    categories.set(row.category.slug, category);
  }

  const sortedCategories = Array.from(categories.values())
    .map((category) => ({ ...category, items: category.items.sort(compareReportItems) }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const items = sortedCategories.flatMap((category) => category.items);

  return {
    generatedAt: options.generatedAt.toISOString(),
    generatedBy: options.generatedBy,
    filters: { categorySlug: options.categorySlug ?? null, includeZeroStock },
    categories: sortedCategories,
    totals: {
      products: items.length,
      lines: items.reduce((sum, item) => sum + Math.max(1, item.lines.length), 0),
      units: items.reduce((sum, item) => sum + item.total, 0),
      needsPrice: items.filter((item) => item.needsPrice).length,
      unverifiedCostUnits: items.reduce((sum, item) => sum + item.unverifiedCostQuantity, 0)
    }
  };
}
