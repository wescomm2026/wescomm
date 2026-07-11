import { WUP_ASSET_PRODUCT_TEMPLATES } from "@/lib/wup-default-catalog";

export const shopImageByProductName: Record<string, string> = Object.fromEntries(
  WUP_ASSET_PRODUCT_TEMPLATES.map((item) => [item.name, item.imageUrl])
);

const legacyProductMatches: Array<[RegExp, { name?: string; image: string }]> = [
  [/^pe shirt$/i, { name: "PE Uniform Top", image: shopImageByProductName["PE Uniform Top"] }],
  [/^pe uniform set$/i, { image: shopImageByProductName["PE Uniform Set"] }],
  [/^id lace$/i, { name: "Wesleyan ID Lace", image: shopImageByProductName["Wesleyan ID Lace"] }],
  [/wesleyan id lace/i, { image: shopImageByProductName["Wesleyan ID Lace"] }],
  [/black.*id.*lace/i, { name: "WUP Black ID Lace", image: shopImageByProductName["WUP Black ID Lace"] }],
  [/elementary.*pe.*shirt|elem.*pe.*shirt/i, { name: "Elementary PE Shirt", image: shopImageByProductName["Elementary PE Shirt"] }],
  [/elementary.*pe.*pants|elem.*pe.*pants|elementary.*jogging/i, { name: "Elementary PE Jogging Pants", image: shopImageByProductName["Elementary PE Jogging Pants"] }],
  [/elementary.*pe.*set|elem.*pe.*set/i, { name: "Elementary PE Uniform Set", image: shopImageByProductName["Elementary PE Uniform Set"] }],
  [/senior.*boys.*polo|shs.*boys.*polo/i, { name: "Senior High Boys Polo", image: shopImageByProductName["Senior High Boys Polo"] }],
  [/senior.*boys.*pants|shs.*boys.*pants/i, { name: "Senior High Boys Pants", image: shopImageByProductName["Senior High Boys Pants"] }],
  [/senior.*boys.*set|shs.*boys.*set/i, { name: "Senior High Boys Uniform Set", image: shopImageByProductName["Senior High Boys Uniform Set"] }],
  [/senior.*girls.*top|shs.*girls.*top/i, { name: "Senior High Girls Top", image: shopImageByProductName["Senior High Girls Top"] }],
  [/senior.*girls.*skirt|senior.*palda|shs.*girls.*skirt/i, { name: "Senior High Girls Skirt", image: shopImageByProductName["Senior High Girls Skirt"] }],
  [/senior.*girls.*set|shs.*girls.*set/i, { name: "Senior High Girls Uniform Set", image: shopImageByProductName["Senior High Girls Uniform Set"] }],
  [/crim|criminology/i, { name: "WUP Criminology Uniform", image: shopImageByProductName["WUP Criminology Uniform"] }],
  [/nursing.*boys/i, { image: shopImageByProductName["Nursing Boys Uniform Set"] }],
  [/nursing.*girls|nursing.*girl/i, { name: "Nursing Girls Uniform", image: shopImageByProductName["Nursing Girls Uniform"] }],
  [/nursing.*set/i, { name: "Nursing Uniform Set", image: shopImageByProductName["Nursing Uniform Set"] }],
  [/nursing.*smock|smock/i, { name: "Nursing Smock Gown", image: shopImageByProductName["Nursing Smock Gown"] }],
  [/nursing.*slacks/i, { name: "Nursing Slacks", image: shopImageByProductName["Nursing Slacks"] }],
  [/nursing/i, { name: "Nursing Clinical Top", image: shopImageByProductName["Nursing Clinical Top"] }],
  [/bsba.*set/i, { name: "BSBA Girls Uniform Set", image: shopImageByProductName["BSBA Girls Uniform Set"] }],
  [/bsba.*skirt/i, { name: "BSBA Skirt", image: shopImageByProductName["BSBA Skirt"] }],
  [/bsba/i, { name: "BSBA Girls Uniform", image: shopImageByProductName["BSBA Girls Uniform"] }],
  [/med.*tech.*set/i, { name: "Med Tech Uniform Set", image: shopImageByProductName["Med Tech Uniform Set"] }],
  [/med.*tech.*pants/i, { name: "Med Tech Uniform Pants", image: shopImageByProductName["Med Tech Uniform Pants"] }],
  [/med.*tech/i, { name: "Med Tech Uniform Top", image: shopImageByProductName["Med Tech Uniform Top"] }],
  [/drug.*guide|nurses.*clinicians/i, { name: "Drug Guide for Nurses and Clinicians", image: shopImageByProductName["Drug Guide for Nurses and Clinicians"] }],
  [/fundamentals.*nursing.*1|nursing.*volume.*1/i, { name: "Fundamentals of Nursing Volume 1", image: shopImageByProductName["Fundamentals of Nursing Volume 1"] }],
  [/fundamentals.*nursing.*2|nursing.*volume.*2/i, { name: "Fundamentals of Nursing Volume 2", image: shopImageByProductName["Fundamentals of Nursing Volume 2"] }],
  [/medical.*laboratory|med.*lab/i, { name: "Principles of Medical Laboratory Science 1", image: shopImageByProductName["Principles of Medical Laboratory Science 1"] }],
  [/kozier|erb/i, { name: "Kozier and Erb's Nursing Methods Reference", image: shopImageByProductName["Kozier and Erb's Nursing Methods Reference"] }],
  [/slacks/i, { image: shopImageByProductName["WUP Slacks"] }],
  [/uniform/i, { image: shopImageByProductName["Boys WUP Uniform Set"] }]
];

export function resolveShopProductAsset(productName: string, fallbackImage?: string | null) {
  const cleanFallbackImage = fallbackImage?.trim();
  if (cleanFallbackImage && /^https?:\/\//i.test(cleanFallbackImage)) {
    return { name: productName, image: cleanFallbackImage };
  }

  const directImage = shopImageByProductName[productName];
  if (directImage) return { name: productName, image: directImage };

  const match = legacyProductMatches.find(([pattern]) => pattern.test(productName));
  if (match) return { name: match[1].name ?? productName, image: match[1].image };

  return {
    name: productName,
    image: cleanFallbackImage || "/assets/others.svg"
  };
}
