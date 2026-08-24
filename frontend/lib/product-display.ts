export type ProductDisplayTarget = {
  name: string;
  category: string;
  saleMode?: "SIMPLE" | "CLOTH_ONLY" | "OPTIONS";
};

export type ProductStockTarget = {
  status: string;
  count: string | number;
  inventorySetupRequired?: boolean;
  options?: Array<{
    name: string;
    values: string[];
    stockByValue?: Record<string, number>;
  }>;
  skus?: Array<{
    id: string;
    stock: number;
    options: Record<string, string>;
  }>;
};

export const UNIFORM_CLOTH_NOTICE =
  "Sold as uniform cloth/material only. The image is a preview of the finished uniform, not a ready-to-wear item.";

const SIZE_RANK = new Map<string, number>([
  ["xxxxs", 0],
  ["4xs", 0],
  ["xxxs", 1],
  ["3xs", 1],
  ["xxs", 2],
  ["2xs", 2],
  ["xs", 3],
  ["extra small", 3],
  ["s", 4],
  ["small", 4],
  ["m", 5],
  ["medium", 5],
  ["l", 6],
  ["large", 6],
  ["xl", 7],
  ["extra large", 7],
  ["2xl", 8],
  ["xxl", 8],
  ["3xl", 9],
  ["xxxl", 9],
  ["4xl", 10],
  ["xxxxl", 10],
  ["5xl", 11],
  ["xxxxxl", 11]
]);

function normalizeOptionValue(value: string) {
  return value.trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
}

export function sortProductOptionValues(optionName: string, values: string[]) {
  if (!/size/i.test(optionName)) return [...values];
  return [...values].sort((left, right) => {
    const leftKey = normalizeOptionValue(left);
    const rightKey = normalizeOptionValue(right);
    const leftRank = SIZE_RANK.get(leftKey);
    const rightRank = SIZE_RANK.get(rightKey);
    if (leftRank !== undefined || rightRank !== undefined) {
      if (leftRank === undefined) return 1;
      if (rightRank === undefined) return -1;
      if (leftRank !== rightRank) return leftRank - rightRank;
    }
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function hasCompleteProductSelections(
  product: ProductStockTarget,
  selectedOptions: Record<string, string>
) {
  return (product.options ?? []).every((option) => {
    const selectedValue = selectedOptions[option.name];
    return Boolean(selectedValue && option.values.includes(selectedValue));
  });
}

export function selectedProductAvailability(
  product: ProductStockTarget,
  selectedOptions: Record<string, string>
) {
  if (!hasCompleteProductSelections(product, selectedOptions)) return 0;
  return productPurchaseLimit(product, Number.MAX_SAFE_INTEGER, selectedOptions);
}

export function productStockCount(product: ProductStockTarget) {
  const count = Number(product.count);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

export function productOptionValueStock(
  product: ProductStockTarget,
  optionName: string,
  optionValue: string,
  selectedOptions: Record<string, string> = {}
) {
  if (product.skus?.length) {
    const compatibleStock = product.skus.reduce((total, sku) => {
      if (sku.options[optionName] !== optionValue) return total;
      const compatible = Object.entries(selectedOptions).every(([selectedName, selectedValue]) =>
        selectedName === optionName || !selectedValue || sku.options[selectedName] === selectedValue
      );
      return compatible ? total + Math.max(0, Math.floor(Number(sku.stock) || 0)) : total;
    }, 0);
    return compatibleStock;
  }

  const option = product.options?.find((entry) => entry.name === optionName);
  const stock = option?.stockByValue?.[optionValue];
  if (stock === undefined) return null;
  const numericStock = Number(stock);
  return Number.isFinite(numericStock) ? Math.max(0, Math.floor(numericStock)) : 0;
}

export function firstAvailableOptionValue(
  product: ProductStockTarget,
  option: NonNullable<ProductStockTarget["options"]>[number]
) {
  return option.values.find((value) => {
    const stock = productOptionValueStock(product, option.name, value);
    return stock === null || stock > 0;
  }) ?? "";
}

function hasAvailableValue(product: ProductStockTarget, option: NonNullable<ProductStockTarget["options"]>[number]) {
  return option.values.some((value) => {
    const stock = productOptionValueStock(product, option.name, value);
    return stock === null || stock > 0;
  });
}

export function isProductUnavailable(product: ProductStockTarget) {
  if (product.inventorySetupRequired) return true;
  if (product.status.trim().toLowerCase() === "out of stock" || productStockCount(product) === 0) return true;
  if (product.skus?.length) return !product.skus.some((sku) => Math.max(0, Math.floor(Number(sku.stock) || 0)) > 0);
  return Boolean(product.options?.some((option) => !hasAvailableValue(product, option)));
}

export function selectedProductSkuId(
  product: ProductStockTarget,
  selectedOptions: Record<string, string>
) {
  if (!product.skus?.length || !hasCompleteProductSelections(product, selectedOptions)) return undefined;
  const expectedOptionCount = product.options?.length ?? 0;
  const matching = product.skus.filter((sku) => {
    const skuEntries = Object.entries(sku.options);
    return skuEntries.length === expectedOptionCount
      && skuEntries.every(([name, value]) => selectedOptions[name] === value);
  });
  return matching.length === 1 ? matching[0].id : undefined;
}

export function productPurchaseLimit(
  product: ProductStockTarget,
  maximum = 10,
  selectedOptions: Record<string, string> = {}
) {
  if (isProductUnavailable(product)) return 0;
  if (!hasCompleteProductSelections(product, selectedOptions)) return 0;

  if (product.skus?.length) {
    const matchingSkuId = selectedProductSkuId(product, selectedOptions);
    const matchingSku = matchingSkuId ? product.skus.find((sku) => sku.id === matchingSkuId) : undefined;
    if (!matchingSku) return 0;
    return Math.min(
      Math.max(0, Math.floor(Number(matchingSku.stock) || 0)),
      productStockCount(product),
      Math.max(1, Math.floor(maximum))
    );
  }

  const selectedStocks: number[] = [];
  for (const option of product.options ?? []) {
    const selectedValue = selectedOptions[option.name];
    if (!selectedValue || !option.values.includes(selectedValue)) return 0;
    const stock = productOptionValueStock(product, option.name, selectedValue);
    if (stock === 0) return 0;
    if (stock !== null) selectedStocks.push(stock);
  }
  return Math.min(
    productStockCount(product),
    ...selectedStocks,
    Math.max(1, Math.floor(maximum))
  );
}

export function isPeUniformProduct(product: ProductDisplayTarget) {
  return product.category === "Uniforms" && /\bP\.?E\.?\b|physical education|elementary pe/i.test(product.name);
}

export function isUniformClothOnly(product: ProductDisplayTarget) {
  if (product.saleMode) return product.saleMode === "CLOTH_ONLY";
  return product.category === "Uniforms" && !isPeUniformProduct(product);
}

export function uniformClothGroupKey(product: ProductDisplayTarget) {
  if (!isUniformClothOnly(product)) return "";

  const name = product.name.toLowerCase();
  if (name.includes("senior high") || /\bshs\b/.test(name)) return "senior-high-cloth";
  if (name.includes("nursing")) return "nursing-cloth";
  if (name.includes("med tech") || name.includes("medtech")) return "med-tech-cloth";
  if (name.includes("bsba")) return "bsba-cloth";
  if (name.includes("criminology") || name.includes("crim")) return "criminology-cloth";
  if (name.includes("wup") || name.includes("boys wup")) return "wup-college-cloth";
  if (name.includes("cba")) return "cba-cloth";
  if (name.includes("cloth")) return "uniform-cloth";

  return "uniform-cloth";
}
