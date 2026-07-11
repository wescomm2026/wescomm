import { supabaseAdmin } from "../lib/supabase.js";
import type { ProductStatus } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";

export type ProductFilters = {
  query?: string;
  category?: string;
  status?: ProductStatus;
  sort?: string;
};

type RawCategory = {
  id: string;
  name: string;
  slug: string;
  icon_url: string | null;
};

type RawVariant = {
  option_name: string;
  option_value: string;
  stock: number;
};

type RawProduct = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: string | number;
  old_price: string | number | null;
  status: ProductStatus;
  stock: number;
  created_at?: string;
  category: RawCategory | RawCategory[] | null;
  variants: RawVariant[] | null;
};

function firstCategory(category: RawProduct["category"]) {
  return Array.isArray(category) ? (category[0] ?? null) : category;
}

function mapProduct(product: RawProduct) {
  const category = firstCategory(product.category);

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    imageUrl: product.image_url,
    price: product.price,
    oldPrice: product.old_price,
    status: product.status,
    stock: product.stock,
    createdAt: product.created_at,
    category: category
      ? {
          id: category.id,
          name: category.name,
          slug: category.slug,
          iconUrl: category.icon_url
        }
      : null,
    variants: (product.variants ?? []).map((variant) => ({
      optionName: variant.option_name,
      optionValue: variant.option_value,
      stock: variant.stock
    }))
  };
}

export async function listProducts(filters: ProductFilters) {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select(
      "id,name,description,image_url,price,old_price,status,stock,is_active,created_at,category:categories(id,name,slug,icon_url),variants:product_variants(option_name,option_value,stock)"
    )
    .eq("is_active", true);

  if (error) throw new HttpError(500, error.message);

  const query = filters.query?.trim().toLowerCase();
  const products = ((data ?? []) as RawProduct[])
    .map(mapProduct)
    .filter((product) => {
      const matchesQuery =
        !query ||
        `${product.name} ${product.description ?? ""} ${product.category?.name ?? ""}`
          .toLowerCase()
          .includes(query);
      const matchesCategory = !filters.category || product.category?.slug === filters.category;
      const matchesStatus = !filters.status || product.status === filters.status;
      return matchesQuery && matchesCategory && matchesStatus;
    });

  return products.sort((left, right) => {
    if (filters.sort === "price-low") return Number(left.price) - Number(right.price);
    if (filters.sort === "price-high") return Number(right.price) - Number(left.price);
    if (filters.sort === "name") return left.name.localeCompare(right.name);
    return String(right.createdAt).localeCompare(String(left.createdAt));
  });
}

export async function getProduct(productId: string) {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select(
      "id,name,description,image_url,price,old_price,status,stock,is_active,created_at,category:categories(id,name,slug,icon_url),variants:product_variants(option_name,option_value,stock)"
    )
    .eq("id", productId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new HttpError(500, error.message);
  }

  return mapProduct(data as RawProduct);
}
