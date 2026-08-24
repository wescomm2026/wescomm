import { Prisma } from "@prisma/client";
import { getCache, invalidateByTag } from "@vercel/functions";
import { prisma } from "../lib/prisma.js";
import type { ProductStatus } from "../types/app.js";

export type ProductFilters = {
  query?: string;
  category?: string;
  status?: ProductStatus;
  sort?: string;
  candidateTerms?: string[];
  limit?: number;
};

type ProductListOptions = {
  bypassCache?: boolean;
};

const PUBLIC_PRODUCT_CACHE_TTL_MS = 30_000;
const PUBLIC_PRODUCT_CACHE_TTL_SECONDS = PUBLIC_PRODUCT_CACHE_TTL_MS / 1_000;
const PUBLIC_PRODUCT_CACHE_KEY = "catalog:v3";

const publicProductSelect = Prisma.validator<Prisma.ProductSelect>()({
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  price: true,
  oldPrice: true,
  status: true,
  stock: true,
  createdAt: true,
  saleMode: true,
  skuInventoryEnabled: true,
  inventoryReconciledAt: true,
  category: { select: { id: true, name: true, slug: true, iconUrl: true } },
  aliases: {
    select: { alias: true },
    orderBy: { alias: "asc" }
  },
  variants: {
    select: { id: true, optionName: true, optionValue: true, stock: true },
    orderBy: [{ optionName: "asc" }, { optionValue: "asc" }]
  },
  skus: {
    where: { isActive: true },
    select: {
      id: true,
      stock: true,
      lowStockThreshold: true,
      optionValues: {
        select: {
          variant: { select: { optionName: true, optionValue: true } }
        }
      }
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  }
});

type PublicProductRecord = Prisma.ProductGetPayload<{ select: typeof publicProductSelect }>;
type PublicProduct = ReturnType<typeof mapProduct>;

let cachedPublicCatalog: { value: PublicProduct[]; expiresAt: number } | null = null;
let publicCatalogRequest: Promise<PublicProduct[]> | null = null;
const productRuntimeCache = getCache({ namespace: "wescomm-products" });

function isPublicProductCatalog(value: unknown): value is PublicProduct[] {
  return Array.isArray(value) && value.every((product) => Boolean(
    product
    && typeof product === "object"
    && typeof (product as Partial<PublicProduct>).id === "string"
    && typeof (product as Partial<PublicProduct>).name === "string"
    && typeof (product as Partial<PublicProduct>).stock === "number"
    && Array.isArray((product as Partial<PublicProduct>).aliases)
    && Array.isArray((product as Partial<PublicProduct>).variants)
    && Array.isArray((product as Partial<PublicProduct>).skus)
  ));
}

function mapProduct(product: PublicProductRecord) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    imageUrl: product.imageUrl,
    price: product.price.toString(),
    oldPrice: product.oldPrice?.toString() ?? null,
    status: product.status,
    stock: product.stock,
    createdAt: product.createdAt.toISOString(),
    saleMode: product.saleMode,
    skuInventoryEnabled: product.skuInventoryEnabled,
    inventoryReconciledAt: product.inventoryReconciledAt?.toISOString() ?? null,
    inventorySetupRequired: product.saleMode === "OPTIONS" && !product.skuInventoryEnabled,
    category: product.category,
    aliases: product.aliases.map((entry) => entry.alias),
    variants: product.saleMode === "OPTIONS"
      ? product.variants.map((variant) => ({
          optionName: variant.optionName,
          optionValue: variant.optionValue,
          stock: product.skuInventoryEnabled ? variant.stock : 0
        }))
      : [],
    skus: product.saleMode === "OPTIONS" && product.skuInventoryEnabled
      ? product.skus.map((sku) => ({
          id: sku.id,
          stock: sku.stock,
          lowStockThreshold: sku.lowStockThreshold,
          options: sku.optionValues
            .map((link) => ({
              optionName: link.variant.optionName,
              optionValue: link.variant.optionValue
            }))
            .sort((left, right) => left.optionName.localeCompare(right.optionName))
        }))
      : []
  };
}

function isDefaultPublicCatalog(filters: ProductFilters) {
  return !filters.query
    && !filters.category
    && !filters.status
    && !filters.sort
    && !(filters.candidateTerms?.length)
    && filters.limit === undefined;
}

async function queryProducts(filters: ProductFilters) {
  const where: Prisma.ProductWhereInput = { isActive: true };
  const query = filters.query?.trim();
  const candidateTerms = (filters.candidateTerms ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 6);
  const searchTerms = Array.from(new Set([...(query ? [query] : []), ...candidateTerms]));

  if (searchTerms.length) {
    where.OR = searchTerms.flatMap((term) => [
      { name: { contains: term, mode: "insensitive" as const } },
      { description: { contains: term, mode: "insensitive" as const } },
      { category: { name: { contains: term, mode: "insensitive" as const } } },
      {
        aliases: {
          some: {
            normalizedAlias: {
              contains: term.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
            }
          }
        }
      }
    ]);
  }
  if (filters.category) where.category = { slug: filters.category };
  if (filters.status) where.status = filters.status;

  const orderBy: Prisma.ProductOrderByWithRelationInput[] = filters.sort === "price-low"
    ? [{ price: "asc" }, { id: "asc" }]
    : filters.sort === "price-high"
      ? [{ price: "desc" }, { id: "asc" }]
      : filters.sort === "name"
        ? [{ name: "asc" }, { id: "asc" }]
        : [{ createdAt: "desc" }, { id: "desc" }];

  const rows = await prisma.product.findMany({
    where,
    select: publicProductSelect,
    relationLoadStrategy: "join",
    orderBy,
    ...(filters.limit ? { take: Math.min(Math.max(filters.limit, 1), 50) } : {})
  });

  return rows.map(mapProduct);
}

export async function listProducts(filters: ProductFilters, options: ProductListOptions = {}) {
  if (options.bypassCache || !isDefaultPublicCatalog(filters)) return queryProducts(filters);

  if (cachedPublicCatalog && cachedPublicCatalog.expiresAt > Date.now()) {
    return cachedPublicCatalog.value;
  }
  if (publicCatalogRequest) return publicCatalogRequest;

  publicCatalogRequest = (async () => {
    const regionalValue = await productRuntimeCache.get(PUBLIC_PRODUCT_CACHE_KEY).catch(() => null);
    if (isPublicProductCatalog(regionalValue)) {
      cachedPublicCatalog = {
        value: regionalValue,
        expiresAt: Date.now() + PUBLIC_PRODUCT_CACHE_TTL_MS
      };
      return regionalValue;
    }

    const products = await queryProducts(filters);
    cachedPublicCatalog = {
      value: products,
      expiresAt: Date.now() + PUBLIC_PRODUCT_CACHE_TTL_MS
    };
    await productRuntimeCache.set(PUBLIC_PRODUCT_CACHE_KEY, products, {
      ttl: PUBLIC_PRODUCT_CACHE_TTL_SECONDS,
      tags: ["products"],
      name: "WESCOMM public catalog"
    }).catch(() => undefined);
    return products;
  })()
    .finally(() => {
      publicCatalogRequest = null;
    });

  return publicCatalogRequest;
}

export async function invalidatePublicProductCache() {
  cachedPublicCatalog = null;
  await Promise.all([
    productRuntimeCache.delete(PUBLIC_PRODUCT_CACHE_KEY),
    productRuntimeCache.expireTag("products"),
    invalidateByTag("products")
  ]).catch(() => undefined);
}

export async function getProduct(productId: string) {
  const row = await prisma.product.findUnique({
    where: { id: productId },
    select: publicProductSelect,
    relationLoadStrategy: "join"
  });
  return row ? mapProduct(row) : null;
}
