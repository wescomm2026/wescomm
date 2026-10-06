/** Shown wherever a product has no photo of its own. */
export const PRODUCT_PLACEHOLDER_IMAGE = "/assets/product-placeholder.svg";

// Category icons (for example /assets/uniforms.svg) were stored as product images when
// no photo existed. They are icons, not product photos.
const CATEGORY_ICON_IMAGE = /^\/assets\/[a-z0-9-]+\.svg$/i;

// Older catalog rows still use Boys/Girls wording; they are shown with the current
// Men's/Women's names. Exact names only: guessing from partial names renamed
// unrelated products and replaced their photos.
const LEGACY_DISPLAY_NAMES: Record<string, string> = {
  "boys wup uniform": "WUP Men's Uniform Top",
  "boys wup uniform set": "WUP Men's Uniform Set",
  "bsba girls uniform": "BSBA Women's Blouse",
  "bsba girls uniform set": "BSBA Women's Uniform Set",
  "nursing boys uniform set": "Nursing Men's Uniform Set",
  "nursing girls uniform": "Nursing Women's Uniform",
  "senior high boys pants": "Senior High Men's Pants",
  "senior high boys polo": "Senior High Men's Polo",
  "senior high boys uniform set": "Senior High Men's Uniform Set",
  "senior high girls skirt": "Senior High Women's Skirt",
  "senior high girls top": "Senior High Women's Top",
  "senior high girls uniform set": "Senior High Women's Uniform Set",
  "wesleyan slacks": "WUP Slacks",
  "wup girls blouse": "WUP Women's Blouse with Ribbon",
  "wup girls blouse classic": "WUP Women's Blouse",
  "wup girls skirt": "WUP Women's Skirt",
  "wup girls uniform set": "WUP Women's Uniform Set"
};

export function isMissingProductPhoto(image?: string | null) {
  const value = image?.trim();
  return !value || CATEGORY_ICON_IMAGE.test(value);
}

export function productDisplayName(name: string) {
  return LEGACY_DISPLAY_NAMES[name.trim().toLowerCase()] ?? name;
}

/**
 * The product's own photo always wins. Without one, a bundled catalog photo is used
 * only when the display name is exactly a catalog template name; otherwise the
 * generic "No photo yet" placeholder is shown.
 */
export function resolveProductImage(input: {
  displayName: string;
  ownImage?: string | null;
  templateImageByName: Record<string, string>;
  optimizeLocalImage: (image: string) => string;
}) {
  const ownImage = input.ownImage?.trim();
  if (ownImage && !isMissingProductPhoto(ownImage)) {
    return /^https?:\/\//i.test(ownImage) ? ownImage : input.optimizeLocalImage(ownImage);
  }
  return input.templateImageByName[input.displayName] ?? PRODUCT_PLACEHOLDER_IMAGE;
}
