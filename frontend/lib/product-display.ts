export type ProductDisplayTarget = {
  name: string;
  category: string;
};

export type ProductStockTarget = {
  status: string;
  count: string | number;
};

export const UNIFORM_CLOTH_NOTICE =
  "Sold as uniform cloth/material only. The image is a preview of the finished uniform, not a ready-to-wear item.";

export function productStockCount(product: ProductStockTarget) {
  const count = Number(product.count);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

export function isProductUnavailable(product: ProductStockTarget) {
  return product.status.trim().toLowerCase() === "out of stock" || productStockCount(product) === 0;
}

export function productPurchaseLimit(product: ProductStockTarget, maximum = 10) {
  if (isProductUnavailable(product)) return 0;
  return Math.min(productStockCount(product), Math.max(1, Math.floor(maximum)));
}

export function isPeUniformProduct(product: ProductDisplayTarget) {
  return product.category === "Uniforms" && /\bP\.?E\.?\b|physical education|elementary pe/i.test(product.name);
}

export function isUniformClothOnly(product: ProductDisplayTarget) {
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
