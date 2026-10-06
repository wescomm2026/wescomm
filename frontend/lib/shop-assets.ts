import { productDisplayName, resolveProductImage } from "@/lib/product-image";
import { WUP_ASSET_PRODUCT_TEMPLATES } from "@/lib/wup-default-catalog";

export const shopImageByProductName: Record<string, string> = Object.fromEntries(
  WUP_ASSET_PRODUCT_TEMPLATES.map((item) => [item.name, item.imageUrl])
);

const localShopAssetNames = new Set(
  WUP_ASSET_PRODUCT_TEMPLATES
    .map((item) => item.imageUrl.split("/").pop()?.replace(/\.webp$/i, ""))
    .filter((name): name is string => Boolean(name))
);

function localShopImageParts(image: string) {
  const match = image.match(/^(\/assets\/wup(?: |%20)shop(?: |%20)assets\/)([^?#]+?)\.(png|webp)([?#].*)?$/i);
  if (!match) return null;

  let name = match[2];
  try {
    name = decodeURIComponent(name);
  } catch {
    return null;
  }
  if (!localShopAssetNames.has(name)) return null;
  return { base: match[1], encodedName: match[2], extension: match[3].toLowerCase(), suffix: match[4] ?? "" };
}

// Existing product rows can still contain the original local PNG path.
export function optimizeShopProductImage(image: string) {
  const local = localShopImageParts(image);
  return local ? `${local.base}${local.encodedName}.webp${local.suffix}` : image;
}

export function shopProductCardImage(image: string) {
  const optimized = optimizeShopProductImage(image);
  const local = localShopImageParts(optimized);
  return local ? `${local.base}${local.encodedName}-card.webp${local.suffix}` : optimized;
}

export { PRODUCT_PLACEHOLDER_IMAGE, isMissingProductPhoto } from "@/lib/product-image";

export function resolveShopProductAsset(productName: string, ownImage?: string | null) {
  const name = productDisplayName(productName);
  return {
    name,
    image: resolveProductImage({
      displayName: name,
      ownImage,
      templateImageByName: shopImageByProductName,
      optimizeLocalImage: optimizeShopProductImage
    })
  };
}
