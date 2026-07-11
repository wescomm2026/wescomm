export type ProductDisplayTarget = {
  name: string;
  category: string;
};

export const UNIFORM_CLOTH_NOTICE =
  "Sold as uniform cloth/material only. The image is a preview of the finished uniform, not a ready-to-wear item.";

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
