import { supabaseAdmin } from "../lib/supabase.js";
import type { ProductStatus } from "../types/app.js";

const SHOP_ASSET_BASE = "/assets/wup shop assets";

type ProductSeed = {
  name: string;
  categoryName: string;
  categorySlug: string;
  categoryIconUrl: string;
  description: string;
  imageUrl: string;
  price: number;
  stock: number;
  lowStockThreshold: number;
  status?: ProductStatus;
};

const assetProducts: ProductSeed[] = [
  {
    name: "Elementary PE Shirt",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Elementary PE T-shirt, all sizes",
    imageUrl: `${SHOP_ASSET_BASE}/elem pe shirt.png`,
    price: 300,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Elementary PE Jogging Pants",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Elementary PE jogging pants, all sizes",
    imageUrl: `${SHOP_ASSET_BASE}/elem pe pants.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Elementary PE Uniform Set",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Elementary PE shirt and jogging pants set",
    imageUrl: `${SHOP_ASSET_BASE}/elem pe set.png`,
    price: 650,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "PE Uniform Top",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "College PE T-shirt, all sizes",
    imageUrl: `${SHOP_ASSET_BASE}/pe-uniform-top.png`,
    price: 350,
    stock: 30,
    lowStockThreshold: 10
  },
  {
    name: "PE Uniform Pants",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "College PE jogging pants, all sizes",
    imageUrl: `${SHOP_ASSET_BASE}/pe-uniform-pants.png`,
    price: 400,
    stock: 30,
    lowStockThreshold: 10
  },
  {
    name: "PE Uniform Set",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "College PE shirt and jogging pants set",
    imageUrl: `${SHOP_ASSET_BASE}/pe-uniform-set.png`,
    price: 750,
    stock: 30,
    lowStockThreshold: 10,
    status: "ON_SALE"
  },
  {
    name: "Senior High Boys Polo",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Senior High boys uniform polo",
    imageUrl: `${SHOP_ASSET_BASE}/senior high boys polo.png`,
    price: 300,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Senior High Boys Pants",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Senior High boys uniform pants",
    imageUrl: `${SHOP_ASSET_BASE}/senior high boys pants.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Senior High Boys Uniform Set",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Senior High boys polo and pants set",
    imageUrl: `${SHOP_ASSET_BASE}/senior high boys set.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Senior High Girls Top",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Senior High girls uniform top",
    imageUrl: `${SHOP_ASSET_BASE}/senior high top girl.png`,
    price: 300,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Senior High Girls Skirt",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Senior High girls uniform skirt",
    imageUrl: `${SHOP_ASSET_BASE}/senior high palda girl.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Senior High Girls Uniform Set",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Senior High girls top and skirt set",
    imageUrl: `${SHOP_ASSET_BASE}/senior high uniform set girl.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Boys WUP Uniform",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "WUP boys uniform top",
    imageUrl: `${SHOP_ASSET_BASE}/boys-wup-uniform.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Boys WUP Uniform Set",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "WUP boys uniform set",
    imageUrl: `${SHOP_ASSET_BASE}/boys-wup-uniform-set.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "WUP Girls Uniform Set",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "WUP girls blouse and skirt set",
    imageUrl: `${SHOP_ASSET_BASE}/wup-girls-uniform-set.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "WUP Girls Blouse",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "WUP girls blouse with ribbon",
    imageUrl: `${SHOP_ASSET_BASE}/wup-girls-blouse-ribbon.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "WUP Girls Blouse Classic",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "WUP girls classic blouse",
    imageUrl: `${SHOP_ASSET_BASE}/wup-girls-blouse.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "WUP Girls Skirt",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "WUP girls uniform skirt",
    imageUrl: `${SHOP_ASSET_BASE}/wup-girls-skirt.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "WUP Slacks",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "WUP uniform slacks",
    imageUrl: `${SHOP_ASSET_BASE}/wup-slacks.png`,
    price: 400,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "BSBA Girls Uniform Set",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "BSBA blouse and skirt set",
    imageUrl: `${SHOP_ASSET_BASE}/BSBA GIRL UNIFORM SET.png`,
    price: 700,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "BSBA Girls Uniform",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "BSBA blouse uniform",
    imageUrl: `${SHOP_ASSET_BASE}/BSBA GIRL UNIFORM.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "BSBA Skirt",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "BSBA green skirt",
    imageUrl: `${SHOP_ASSET_BASE}/BSBA SKIRT.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Nursing Girls Uniform",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Nursing girls yellow uniform dress",
    imageUrl: `${SHOP_ASSET_BASE}/chtm-dress-uniform.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "WUP Criminology Uniform",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "WUP criminology uniform",
    imageUrl: `${SHOP_ASSET_BASE}/wup crim uniform.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Nursing Uniform Set",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Nursing uniform set",
    imageUrl: `${SHOP_ASSET_BASE}/nursing-uniform-set.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Nursing Boys Uniform Set",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Nursing boys uniform set",
    imageUrl: `${SHOP_ASSET_BASE}/nursing-boys-uniform-set.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Nursing Clinical Top",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Nursing clinical uniform top",
    imageUrl: `${SHOP_ASSET_BASE}/nursing-clinical-top.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Nursing Slacks",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Nursing uniform slacks",
    imageUrl: `${SHOP_ASSET_BASE}/nursing-slacks.png`,
    price: 400,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Nursing Smock Gown",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Nursing clinical smock gown",
    imageUrl: `${SHOP_ASSET_BASE}/nursing-smock-gown.png`,
    price: 600,
    stock: 18,
    lowStockThreshold: 10
  },
  {
    name: "Med Tech Uniform Set",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Med Tech top and pants set",
    imageUrl: `${SHOP_ASSET_BASE}/MED TECH UNIFORM SET.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Med Tech Uniform Top",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Med Tech white uniform top",
    imageUrl: `${SHOP_ASSET_BASE}/MED TECH UNIFORM.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Med Tech Uniform Pants",
    categoryName: "Uniforms",
    categorySlug: "uniforms",
    categoryIconUrl: "/assets/uniforms.svg",
    description: "Med Tech uniform pants",
    imageUrl: `${SHOP_ASSET_BASE}/MED TECH UNIFORM PANTS.png`,
    price: 400,
    stock: 24,
    lowStockThreshold: 10
  },
  {
    name: "Wesleyan ID Lace",
    categoryName: "ID Accessories",
    categorySlug: "id-accessories",
    categoryIconUrl: "/assets/id-accessories.svg",
    description: "University ID lace",
    imageUrl: `${SHOP_ASSET_BASE}/wesleyan-id-lace-new.png`,
    price: 175,
    stock: 50,
    lowStockThreshold: 10
  },
  {
    name: "WUP Black ID Lace",
    categoryName: "ID Accessories",
    categorySlug: "id-accessories",
    categoryIconUrl: "/assets/id-accessories.svg",
    description: "Black WUP ID lace",
    imageUrl: `${SHOP_ASSET_BASE}/wup-black-id-lace.png`,
    price: 175,
    stock: 50,
    lowStockThreshold: 10
  },
  {
    name: "Principles of Medical Laboratory Science 1",
    categoryName: "Textbooks",
    categorySlug: "textbooks",
    categoryIconUrl: "/assets/textbooks.svg",
    description: "Medical Laboratory Science textbook",
    imageUrl: `${SHOP_ASSET_BASE}/ChatGPT Image Jul 10, 2026, 12_06_22 PM (1).png`,
    price: 645,
    stock: 12,
    lowStockThreshold: 5
  },
  {
    name: "Drug Guide for Nurses and Clinicians",
    categoryName: "Textbooks",
    categorySlug: "textbooks",
    categoryIconUrl: "/assets/textbooks.svg",
    description: "Nursing drug guide reference book",
    imageUrl: `${SHOP_ASSET_BASE}/ChatGPT Image Jul 10, 2026, 12_06_22 PM (2).png`,
    price: 900,
    stock: 12,
    lowStockThreshold: 5
  },
  {
    name: "Fundamentals of Nursing Volume 1",
    categoryName: "Textbooks",
    categorySlug: "textbooks",
    categoryIconUrl: "/assets/textbooks.svg",
    description: "Fundamentals of Nursing textbook, volume 1",
    imageUrl: `${SHOP_ASSET_BASE}/ChatGPT Image Jul 10, 2026, 12_06_23 PM (3).png`,
    price: 1070,
    stock: 12,
    lowStockThreshold: 5
  },
  {
    name: "Fundamentals of Nursing Volume 2",
    categoryName: "Textbooks",
    categorySlug: "textbooks",
    categoryIconUrl: "/assets/textbooks.svg",
    description: "Fundamentals of Nursing textbook, volume 2",
    imageUrl: `${SHOP_ASSET_BASE}/ChatGPT Image Jul 10, 2026, 12_06_23 PM (4).png`,
    price: 1070,
    stock: 12,
    lowStockThreshold: 5
  },
  {
    name: "Kozier and Erb's Nursing Methods Reference",
    categoryName: "Textbooks",
    categorySlug: "textbooks",
    categoryIconUrl: "/assets/textbooks.svg",
    description: "Nursing methods reference book",
    imageUrl: `${SHOP_ASSET_BASE}/ChatGPT Image Jul 10, 2026, 12_06_23 PM (5).png`,
    price: 1070,
    stock: 12,
    lowStockThreshold: 5
  }
];

const categorySeeds = [
  { name: "Uniforms", slug: "uniforms", iconUrl: "/assets/uniforms.svg" },
  { name: "ID Accessories", slug: "id-accessories", iconUrl: "/assets/id-accessories.svg" },
  { name: "Textbooks", slug: "textbooks", iconUrl: "/assets/textbooks.svg" }
];

function deriveStatus(stock: number, lowStockThreshold: number, explicitStatus?: ProductStatus): ProductStatus {
  if (explicitStatus) return explicitStatus;
  if (stock <= 0) return "OUT_OF_STOCK";
  if (stock <= lowStockThreshold) return "RESTOCK_SOON";
  return "IN_STOCK";
}

function variantGroupsForProduct(product: ProductSeed) {
  if (product.categorySlug === "textbooks") {
    return [{ optionName: "Copy", values: ["Standard"], stock: product.stock }];
  }

  if (product.categorySlug === "id-accessories") {
    return [{ optionName: "Color", values: product.name.includes("Black") ? ["Black"] : ["Green"], stock: product.stock }];
  }

  if (product.name.includes("Pants") || product.name.includes("Slacks") || product.name.includes("Skirt")) {
    return [{ optionName: "Size", values: ["Small", "Medium", "Large", "XL", "2XL"], stock: Math.max(1, Math.floor(product.stock / 5)) }];
  }

  if (product.name.includes("Set")) {
    return [{ optionName: "Set Size", values: ["Small", "Medium", "Large", "XL", "2XL"], stock: Math.max(1, Math.floor(product.stock / 5)) }];
  }

  return [{ optionName: "Size", values: ["Small", "Medium", "Large", "XL", "2XL"], stock: Math.max(1, Math.floor(product.stock / 5)) }];
}

async function ensureCategory(slug: string) {
  const seed = categorySeeds.find((category) => category.slug === slug);
  if (!seed) throw new Error(`Missing category seed for ${slug}.`);

  const { data: existingCategory, error: categoryError } = await supabaseAdmin
    .from("categories")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (categoryError) throw categoryError;
  if (existingCategory?.id) {
    const { error } = await supabaseAdmin
      .from("categories")
      .update({
        name: seed.name,
        icon_url: seed.iconUrl,
        is_active: true,
        updated_at: new Date().toISOString()
      })
      .eq("id", existingCategory.id);

    if (error) throw error;
    return String(existingCategory.id);
  }

  const { data: createdCategory, error: createError } = await supabaseAdmin
    .from("categories")
    .insert({
      name: seed.name,
      slug: seed.slug,
      icon_url: seed.iconUrl,
      is_active: true
    })
    .select("id")
    .single();

  if (createError) throw createError;
  return String(createdCategory.id);
}

async function upsertProduct(categoryId: string, product: ProductSeed) {
  const { data: existingProduct, error: existingError } = await supabaseAdmin
    .from("products")
    .select("id,stock,low_stock_threshold,status")
    .ilike("name", product.name)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existingProduct?.id) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .update({
        category_id: categoryId,
        name: product.name,
        description: product.description,
        image_url: product.imageUrl,
        price: product.price,
        is_active: true,
        updated_at: new Date().toISOString()
      })
      .eq("id", existingProduct.id)
      .select("id")
      .single();

    if (error) throw error;
    return String(data.id);
  }

  const { data, error } = await supabaseAdmin
    .from("products")
    .insert({
      category_id: categoryId,
      name: product.name,
      description: product.description,
      image_url: product.imageUrl,
      price: product.price,
      old_price: null,
      status: deriveStatus(product.stock, product.lowStockThreshold, product.status),
      stock: product.stock,
      low_stock_threshold: product.lowStockThreshold,
      is_active: true
    })
    .select("id")
    .single();

  if (error) throw error;
  return String(data.id);
}

async function syncVariants(productId: string, product: ProductSeed) {
  const variants = variantGroupsForProduct(product).flatMap((group) =>
    group.values.map((value) => ({
      product_id: productId,
      option_name: group.optionName,
      option_value: value,
      stock: group.stock
    }))
  );

  for (const variant of variants) {
    const { data: existingVariant, error: existingError } = await supabaseAdmin
      .from("product_variants")
      .select("id")
      .eq("product_id", variant.product_id)
      .ilike("option_name", variant.option_name)
      .ilike("option_value", variant.option_value)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existingVariant?.id) {
      continue;
    }

    const { error } = await supabaseAdmin.from("product_variants").insert(variant);
    if (error) throw error;
  }
}

async function main() {
  const categoryIds = new Map<string, string>();
  for (const category of categorySeeds) {
    categoryIds.set(category.slug, await ensureCategory(category.slug));
  }

  for (const product of assetProducts) {
    const categoryId = categoryIds.get(product.categorySlug);
    if (!categoryId) throw new Error(`Missing category id for ${product.categorySlug}.`);

    const productId = await upsertProduct(categoryId, product);
    await syncVariants(productId, product);
    console.log(`Seeded ${product.name}`);
  }

  console.log(`Done. Added or updated ${assetProducts.length} WUP default shop products.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown seed error";
  console.error(message);
  process.exitCode = 1;
});
