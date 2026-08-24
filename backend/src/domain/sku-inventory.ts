export function normalizeSkuOptionName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function canonicalSkuVariantKey(variantIds: string[]) {
  return [...variantIds].sort().join("|");
}

export function sameSkuVariantSelection(leftVariantIds: string[], rightVariantIds: string[]) {
  if (leftVariantIds.length !== rightVariantIds.length) return false;
  return canonicalSkuVariantKey(leftVariantIds) === canonicalSkuVariantKey(rightVariantIds);
}
