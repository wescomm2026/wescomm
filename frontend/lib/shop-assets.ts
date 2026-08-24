import { WUP_ASSET_PRODUCT_TEMPLATES } from "@/lib/wup-default-catalog";

const SHOP_ASSET_BASE = "/assets/wup shop assets";

export const shopImageByProductName: Record<string, string> = Object.fromEntries(
  WUP_ASSET_PRODUCT_TEMPLATES.map((item) => [item.name, item.imageUrl])
);

type LegacyProductMatch = {
  name?: string;
  image: string;
};

const legacyProductMatches: Array<[RegExp, LegacyProductMatch]> = [
  [/^pe shirt$/i, { name: "PE Uniform Top", image: `${SHOP_ASSET_BASE}/pe-uniform-top.png` }],
  [/^pe uniform set$/i, { name: "PE Uniform Set", image: `${SHOP_ASSET_BASE}/pe-uniform-set.png` }],
  [/^id lace$/i, { name: "Wesleyan ID Lace", image: `${SHOP_ASSET_BASE}/wesleyan-id-lace-new.png` }],
  [/wesleyan id lace/i, { name: "Wesleyan ID Lace", image: `${SHOP_ASSET_BASE}/wesleyan-id-lace-new.png` }],
  [/black.*id.*lace/i, { name: "WUP Black ID Lace", image: `${SHOP_ASSET_BASE}/wup-black-id-lace.png` }],
  [/elementary.*pe.*shirt|elem.*pe.*shirt/i, { name: "Elementary PE Shirt", image: `${SHOP_ASSET_BASE}/elem pe shirt.png` }],
  [/elementary.*pe.*pants|elem.*pe.*pants|elementary.*jogging/i, { name: "Elementary PE Jogging Pants", image: `${SHOP_ASSET_BASE}/elem pe pants.png` }],
  [/elementary.*pe.*set|elem.*pe.*set/i, { name: "Elementary PE Uniform Set", image: `${SHOP_ASSET_BASE}/elem pe set.png` }],

  // Senior High legacy names. Keep accepting Boys/Girls records from the DB,
  // but show the current Men's/Women's product wording and use the local assets directly.
  [/senior.*(?:boys|men(?:'s)?).*polo|shs.*boys.*polo/i, {
    name: "Senior High Men's Polo",
    image: `${SHOP_ASSET_BASE}/senior high boys polo.png`
  }],
  [/senior.*(?:boys|men(?:'s)?).*pants|shs.*boys.*pants/i, {
    name: "Senior High Men's Pants",
    image: `${SHOP_ASSET_BASE}/senior high boys pants.png`
  }],
  [/senior.*(?:boys|men(?:'s)?).*(?:set|uniform)|shs.*boys.*set/i, {
    name: "Senior High Men's Uniform Set",
    image: `${SHOP_ASSET_BASE}/senior high boys set.png`
  }],
  [/senior.*(?:girls|women(?:'s)?).*(?:top|blouse)|shs.*girls.*top/i, {
    name: "Senior High Women's Top",
    image: `${SHOP_ASSET_BASE}/senior high top girl.png`
  }],
  [/senior.*(?:girls|women(?:'s)?).*(?:skirt|palda)|senior.*palda|shs.*girls.*skirt/i, {
    name: "Senior High Women's Skirt",
    image: `${SHOP_ASSET_BASE}/senior high palda girl.png`
  }],
  [/senior.*(?:girls|women(?:'s)?).*(?:set|uniform)|shs.*girls.*set/i, {
    name: "Senior High Women's Uniform Set",
    image: `${SHOP_ASSET_BASE}/senior high uniform set girl.png`
  }],

  // WUP college uniform legacy names.
  [/^(?:boys wup uniform|wup men(?:'s)? uniform top)$/i, {
    name: "WUP Men's Uniform Top",
    image: `${SHOP_ASSET_BASE}/boys-wup-uniform.png`
  }],
  [/^(?:boys wup uniform set|wup men(?:'s)? uniform set)$/i, {
    name: "WUP Men's Uniform Set",
    image: `${SHOP_ASSET_BASE}/boys-wup-uniform-set.png`
  }],
  [/^wup (?:girls|women(?:'s)?) uniform set$/i, {
    name: "WUP Women's Uniform Set",
    image: `${SHOP_ASSET_BASE}/wup-girls-uniform-set.png`
  }],
  [/^wup girls blouse$|^wup women(?:'s)? blouse with ribbon$/i, {
    name: "WUP Women's Blouse with Ribbon",
    image: `${SHOP_ASSET_BASE}/wup-girls-blouse-ribbon.png`
  }],
  [/^wup (?:girls blouse classic|women(?:'s)? blouse)$/i, {
    name: "WUP Women's Blouse",
    image: `${SHOP_ASSET_BASE}/wup-girls-blouse.png`
  }],
  [/^wup (?:girls|women(?:'s)?) skirt$/i, {
    name: "WUP Women's Skirt",
    image: `${SHOP_ASSET_BASE}/wup-girls-skirt.png`
  }],

  [/crim|criminology/i, { name: "WUP Criminology Uniform", image: `${SHOP_ASSET_BASE}/wup crim uniform.png` }],
  [/nursing.*(?:boys|men(?:'s)?)/i, { name: "Nursing Men's Uniform Set", image: `${SHOP_ASSET_BASE}/nursing-boys-uniform-set.png` }],
  [/nursing.*(?:girls|girl|women(?:'s)?)/i, { name: "Nursing Women's Uniform", image: `${SHOP_ASSET_BASE}/chtm-dress-uniform.png` }],
  [/nursing.*set/i, { name: "Nursing Uniform Set", image: `${SHOP_ASSET_BASE}/nursing-uniform-set.png` }],
  [/nursing.*smock|smock/i, { name: "Nursing Smock Gown", image: `${SHOP_ASSET_BASE}/nursing-smock-gown.png` }],
  [/nursing.*slacks/i, { name: "Nursing Slacks", image: `${SHOP_ASSET_BASE}/nursing-slacks.png` }],
  [/nursing/i, { name: "Nursing Clinical Top", image: `${SHOP_ASSET_BASE}/nursing-clinical-top.png` }],

  [/bsba.*(?:girls|women(?:'s)?).*set/i, { name: "BSBA Women's Uniform Set", image: `${SHOP_ASSET_BASE}/BSBA GIRL UNIFORM SET.png` }],
  [/bsba.*skirt/i, { name: "BSBA Skirt", image: `${SHOP_ASSET_BASE}/BSBA SKIRT.png` }],
  [/bsba.*(?:girls|women(?:'s)?|uniform|blouse)/i, { name: "BSBA Women's Blouse", image: `${SHOP_ASSET_BASE}/BSBA GIRL UNIFORM.png` }],

  [/med.*tech.*set/i, { name: "Med Tech Uniform Set", image: `${SHOP_ASSET_BASE}/MED TECH UNIFORM SET.png` }],
  [/med.*tech.*pants/i, { name: "Med Tech Uniform Pants", image: `${SHOP_ASSET_BASE}/MED TECH UNIFORM PANTS.png` }],
  [/med.*tech/i, { name: "Med Tech Uniform Top", image: `${SHOP_ASSET_BASE}/MED TECH UNIFORM.png` }],

  [/drug.*guide|nurses.*clinicians/i, { name: "Drug Guide for Nurses and Clinicians", image: shopImageByProductName["Drug Guide for Nurses and Clinicians"] }],
  [/fundamentals.*nursing.*1|nursing.*volume.*1/i, { name: "Fundamentals of Nursing Volume 1", image: shopImageByProductName["Fundamentals of Nursing Volume 1"] }],
  [/fundamentals.*nursing.*2|nursing.*volume.*2/i, { name: "Fundamentals of Nursing Volume 2", image: shopImageByProductName["Fundamentals of Nursing Volume 2"] }],
  [/medical.*laboratory|med.*lab/i, { name: "Principles of Medical Laboratory Science 1", image: shopImageByProductName["Principles of Medical Laboratory Science 1"] }],
  [/kozier|erb/i, { name: "Kozier and Erb's Nursing Methods Reference", image: shopImageByProductName["Kozier and Erb's Nursing Methods Reference"] }],
  [/slacks/i, { name: "WUP Slacks", image: `${SHOP_ASSET_BASE}/wup-slacks.png` }],
  [/uniform/i, { image: `${SHOP_ASSET_BASE}/boys-wup-uniform-set.png` }]
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
    image: cleanFallbackImage || fallbackImageByCategory[categoryName ?? ""] || "/assets/others.svg"
  };
}
