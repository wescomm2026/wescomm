import { WUP_ASSET_PRODUCT_TEMPLATES } from "@/lib/wup-default-catalog";

const SHOP_ASSET_BASE = "/assets/wup shop assets";

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

type LegacyProductMatch = {
  name?: string;
  image: string;
};

const legacyProductMatches: Array<[RegExp, LegacyProductMatch]> = [
  [/^pe shirt$/i, { name: "PE Uniform Top", image: `${SHOP_ASSET_BASE}/pe-uniform-top.webp` }],
  [/^pe uniform set$/i, { name: "PE Uniform Set", image: `${SHOP_ASSET_BASE}/pe-uniform-set.webp` }],
  [/^id lace$/i, { name: "Wesleyan ID Lace", image: `${SHOP_ASSET_BASE}/wesleyan-id-lace-new.webp` }],
  [/wesleyan id lace/i, { name: "Wesleyan ID Lace", image: `${SHOP_ASSET_BASE}/wesleyan-id-lace-new.webp` }],
  [/black.*id.*lace/i, { name: "WUP Black ID Lace", image: `${SHOP_ASSET_BASE}/wup-black-id-lace.webp` }],
  [/elementary.*pe.*shirt|elem.*pe.*shirt/i, { name: "Elementary PE Shirt", image: `${SHOP_ASSET_BASE}/elem pe shirt.webp` }],
  [/elementary.*pe.*pants|elem.*pe.*pants|elementary.*jogging/i, { name: "Elementary PE Jogging Pants", image: `${SHOP_ASSET_BASE}/elem pe pants.webp` }],
  [/elementary.*pe.*set|elem.*pe.*set/i, { name: "Elementary PE Uniform Set", image: `${SHOP_ASSET_BASE}/elem pe set.webp` }],

  // Senior High legacy names. Keep accepting Boys/Girls records from the DB,
  // but show the current Men's/Women's product wording and use the local assets directly.
  [/senior.*(?:boys|men(?:'s)?).*polo|shs.*boys.*polo/i, {
    name: "Senior High Men's Polo",
    image: `${SHOP_ASSET_BASE}/senior high boys polo.webp`
  }],
  [/senior.*(?:boys|men(?:'s)?).*pants|shs.*boys.*pants/i, {
    name: "Senior High Men's Pants",
    image: `${SHOP_ASSET_BASE}/senior high boys pants.webp`
  }],
  [/senior.*(?:boys|men(?:'s)?).*(?:set|uniform)|shs.*boys.*set/i, {
    name: "Senior High Men's Uniform Set",
    image: `${SHOP_ASSET_BASE}/senior high boys set.webp`
  }],
  [/senior.*(?:girls|women(?:'s)?).*(?:top|blouse)|shs.*girls.*top/i, {
    name: "Senior High Women's Top",
    image: `${SHOP_ASSET_BASE}/senior high top girl.webp`
  }],
  [/senior.*(?:girls|women(?:'s)?).*(?:skirt|palda)|senior.*palda|shs.*girls.*skirt/i, {
    name: "Senior High Women's Skirt",
    image: `${SHOP_ASSET_BASE}/senior high palda girl.webp`
  }],
  [/senior.*(?:girls|women(?:'s)?).*(?:set|uniform)|shs.*girls.*set/i, {
    name: "Senior High Women's Uniform Set",
    image: `${SHOP_ASSET_BASE}/senior high uniform set girl.webp`
  }],

  // WUP college uniform legacy names.
  [/^(?:boys wup uniform|wup men(?:'s)? uniform top)$/i, {
    name: "WUP Men's Uniform Top",
    image: `${SHOP_ASSET_BASE}/boys-wup-uniform.webp`
  }],
  [/^(?:boys wup uniform set|wup men(?:'s)? uniform set)$/i, {
    name: "WUP Men's Uniform Set",
    image: `${SHOP_ASSET_BASE}/boys-wup-uniform-set.webp`
  }],
  [/^wup (?:girls|women(?:'s)?) uniform set$/i, {
    name: "WUP Women's Uniform Set",
    image: `${SHOP_ASSET_BASE}/wup-girls-uniform-set.webp`
  }],
  [/^wup girls blouse$|^wup women(?:'s)? blouse with ribbon$/i, {
    name: "WUP Women's Blouse with Ribbon",
    image: `${SHOP_ASSET_BASE}/wup-girls-blouse-ribbon.webp`
  }],
  [/^wup (?:girls blouse classic|women(?:'s)? blouse)$/i, {
    name: "WUP Women's Blouse",
    image: `${SHOP_ASSET_BASE}/wup-girls-blouse.webp`
  }],
  [/^wup (?:girls|women(?:'s)?) skirt$/i, {
    name: "WUP Women's Skirt",
    image: `${SHOP_ASSET_BASE}/wup-girls-skirt.webp`
  }],

  [/crim|criminology/i, { name: "WUP Criminology Uniform", image: `${SHOP_ASSET_BASE}/wup crim uniform.webp` }],
  [/nursing.*(?:boys|men(?:'s)?)/i, { name: "Nursing Men's Uniform Set", image: `${SHOP_ASSET_BASE}/nursing-boys-uniform-set.webp` }],
  [/nursing.*(?:girls|girl|women(?:'s)?)/i, { name: "Nursing Women's Uniform", image: `${SHOP_ASSET_BASE}/chtm-dress-uniform.webp` }],
  [/nursing.*set/i, { name: "Nursing Uniform Set", image: `${SHOP_ASSET_BASE}/nursing-uniform-set.webp` }],
  [/nursing.*smock|smock/i, { name: "Nursing Smock Gown", image: `${SHOP_ASSET_BASE}/nursing-smock-gown.webp` }],
  [/nursing.*slacks/i, { name: "Nursing Slacks", image: `${SHOP_ASSET_BASE}/nursing-slacks.webp` }],
  [/nursing/i, { name: "Nursing Clinical Top", image: `${SHOP_ASSET_BASE}/nursing-clinical-top.webp` }],

  [/bsba.*(?:girls|women(?:'s)?).*set/i, { name: "BSBA Women's Uniform Set", image: `${SHOP_ASSET_BASE}/BSBA GIRL UNIFORM SET.webp` }],
  [/bsba.*skirt/i, { name: "BSBA Skirt", image: `${SHOP_ASSET_BASE}/BSBA SKIRT.webp` }],
  [/bsba.*(?:girls|women(?:'s)?|uniform|blouse)/i, { name: "BSBA Women's Blouse", image: `${SHOP_ASSET_BASE}/BSBA GIRL UNIFORM.webp` }],

  [/med.*tech.*set/i, { name: "Med Tech Uniform Set", image: `${SHOP_ASSET_BASE}/MED TECH UNIFORM SET.webp` }],
  [/med.*tech.*pants/i, { name: "Med Tech Uniform Pants", image: `${SHOP_ASSET_BASE}/MED TECH UNIFORM PANTS.webp` }],
  [/med.*tech/i, { name: "Med Tech Uniform Top", image: `${SHOP_ASSET_BASE}/MED TECH UNIFORM.webp` }],

  [/drug.*guide|nurses.*clinicians/i, { name: "Drug Guide for Nurses and Clinicians", image: shopImageByProductName["Drug Guide for Nurses and Clinicians"] }],
  [/fundamentals.*nursing.*1|nursing.*volume.*1/i, { name: "Fundamentals of Nursing Volume 1", image: shopImageByProductName["Fundamentals of Nursing Volume 1"] }],
  [/fundamentals.*nursing.*2|nursing.*volume.*2/i, { name: "Fundamentals of Nursing Volume 2", image: shopImageByProductName["Fundamentals of Nursing Volume 2"] }],
  [/medical.*laboratory|med.*lab/i, { name: "Principles of Medical Laboratory Science 1", image: shopImageByProductName["Principles of Medical Laboratory Science 1"] }],
  [/kozier|erb/i, { name: "Kozier and Erb's Nursing Methods Reference", image: shopImageByProductName["Kozier and Erb's Nursing Methods Reference"] }],
  [/slacks/i, { name: "WUP Slacks", image: `${SHOP_ASSET_BASE}/wup-slacks.webp` }],
  [/uniform/i, { image: `${SHOP_ASSET_BASE}/boys-wup-uniform-set.webp` }]
];

const fallbackImageByCategory: Record<string, string> = {
  Uniforms: "/assets/uniforms.svg",
  "ID Accessories": "/assets/id-accessories.svg",
  "School Supplies": "/assets/school-supplies.svg",
  Textbooks: "/assets/textbooks.svg",
  Others: "/assets/others.svg"
};

export function resolveShopProductAsset(
  productName: string,
  fallbackImage?: string | null,
  categoryName?: string | null
) {
  const cleanFallbackImage = fallbackImage?.trim();

  // Remote images from Supabase Storage or another trusted backend value take precedence.
  if (cleanFallbackImage && /^https?:\/\//i.test(cleanFallbackImage)) {
    const legacyMatch = legacyProductMatches.find(([pattern]) => pattern.test(productName));
    return {
      name: legacyMatch?.[1].name ?? productName,
      image: cleanFallbackImage
    };
  }

  const directImage = shopImageByProductName[productName];
  if (directImage) return { name: productName, image: directImage };

  const match = legacyProductMatches.find(([pattern]) => pattern.test(productName));
  if (match) return { name: match[1].name ?? productName, image: match[1].image };

  return {
    name: productName,
    image: cleanFallbackImage ? optimizeShopProductImage(cleanFallbackImage) : fallbackImageByCategory[categoryName ?? ""] || "/assets/others.svg"
  };
}
