import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../lib/supabase.js";
import { prisma } from "../lib/prisma.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";
import { createNotificationsForRoles } from "./notification.service.js";
import { createBackInStockNotificationsInTransaction } from "./wishlist-notification.service.js";
import { type ProductSaleMode, type ProductStatus } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import { requireNoActiveInventoryReservations } from "../utils/inventory-reservation.js";
import { lockProductForUpdate } from "../utils/product-transaction.js";
import { createPage, decodeCursor, normalizePageLimit } from "../utils/cursor-pagination.js";
import {
  normalizeVariantPart,
  optionGroupsHaveAvailableStock,
  validateVariantGroupTotals
} from "../domain/variant-stock.js";

type RawCategory = {
  id: string;
  name: string;
  slug: string;
  icon_url: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};


type CategoryInput = {
  categoryId?: string;
  categorySlug?: string;
  categoryName?: string;
  categoryIconUrl?: string | null;
};

export type ProductVariantInput = {
  optionName: string;
  optionValue: string;
  stock?: number;
  lowStockThreshold?: number;
};

export type ProductVariantDefinitionInput = {
  id?: string;
  optionValue: string;
  lowStockThreshold: number;
};

export type ProductVariantQuantityInput = {
  variantId: string;
  quantity: number;
};

export type ProductCreateInput = CategoryInput & {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  imageStoragePath?: string | null;
  price: number;
  oldPrice?: number | null;
  status?: ProductStatus;
  saleMode?: ProductSaleMode;
  stock?: number;
  lowStockThreshold?: number;
  variants?: ProductVariantInput[];
  notes?: string;
};

export type ProductUpdateInput = Partial<Omit<ProductCreateInput, "variants" | "saleMode">> & {
  isActive?: boolean;
};


const inventoryRecordSelect = Prisma.validator<Prisma.ProductSelect>()({
  id: true,
  categoryId: true,
  name: true,
  description: true,
  imageUrl: true,
  imageStoragePath: true,
  price: true,
  oldPrice: true,
  status: true,
  stock: true,
  lowStockThreshold: true,
  isActive: true,
  saleMode: true,
  skuInventoryEnabled: true,
  inventoryReconciledAt: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: { id: true, name: true, slug: true, iconUrl: true }
  },
  variants: {
    select: { id: true, optionName: true, optionValue: true, stock: true, lowStockThreshold: true },
    orderBy: [{ optionName: "asc" }, { optionValue: "asc" }]
  },
  skus: {
    where: { isActive: true },
    select: {
      id: true,
      code: true,
      stock: true,
      lowStockThreshold: true,
      isActive: true,
      optionValues: {
        select: {
          variantId: true,
          variant: { select: { id: true, optionName: true, optionValue: true } }
        }
      }
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  }
});

type InventoryRecord = Prisma.ProductGetPayload<{ select: typeof inventoryRecordSelect }>;

export type InventoryListOptions = {
  limit?: number;
  cursor?: string;
  query?: string;
  categoryId?: string;
  productId?: string;
  status?: ProductStatus;
  visibility?: "ACTIVE" | "ARCHIVED";
};

function mapCategory(row: RawCategory) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    iconUrl: row.icon_url,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}


function mapInventoryRecord(row: InventoryRecord) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl,
    imageStoragePath: row.imageStoragePath,
    price: row.price,
    oldPrice: row.oldPrice,
    status: row.status,
    stock: row.stock,
    lowStockThreshold: row.lowStockThreshold,
    isActive: row.isActive,
    saleMode: row.saleMode,
    skuInventoryEnabled: row.skuInventoryEnabled,
    inventoryReconciledAt: row.inventoryReconciledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    category: row.category,
    variants: row.variants,
    skus: row.skus.map((sku) => ({
      id: sku.id,
      code: sku.code,
      stock: sku.stock,
      lowStockThreshold: sku.lowStockThreshold,
      isActive: sku.isActive,
      variantIds: sku.optionValues.map((link) => link.variantId),
      options: sku.optionValues
        .map((link) => ({ optionName: link.variant.optionName, optionValue: link.variant.optionValue }))
        .sort((left, right) => left.optionName.localeCompare(right.optionName))
    }))
  };
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "category";
}

function deriveProductStatus(stock: number, lowStockThreshold: number, currentStatus?: ProductStatus) {
  if (stock <= 0) return "OUT_OF_STOCK";
  if (currentStatus === "ON_SALE") return "ON_SALE";
  if (stock <= lowStockThreshold) return "RESTOCK_SOON";
  return "IN_STOCK";
}

export const INVENTORY_WRITE_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 10_000,
  timeout: 20_000
});

function mapInventoryTransactionError(error: unknown) {
  if (error instanceof HttpError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return new HttpError(409, "A product with this name already exists.");
    }
    if (error.code === "P2034") {
      return new HttpError(
        409,
        "Inventory changed while processing. Please try again.",
        "INVENTORY_WRITE_CONFLICT",
        { retryable: true }
      );
    }
    if (error.code === "P2024" || error.code === "P2028") {
      return new HttpError(
        503,
        "Inventory is temporarily unavailable. Please try again.",
        "INVENTORY_TRANSACTION_UNAVAILABLE",
        { retryable: true }
      );
    }
  }
  return error;
}

async function notifyLowStockIfNeeded(input: {
  productId: string;
  productName: string;
  previousStock: number;
  newStock: number;
  previousLowStockThreshold?: number;
  lowStockThreshold: number;
}) {
  const wasLowStock = input.previousStock <= (input.previousLowStockThreshold ?? input.lowStockThreshold);
  const isLowStock = input.newStock <= input.lowStockThreshold;
  const crossedIntoLowStock = isLowStock && !wasLowStock;

  if (!crossedIntoLowStock) return;

  await createNotificationsForRoles(["STAFF", "ADMIN"], {
    type: "LOW_STOCK",
    title: `Low stock: ${input.productName}`,
    message: `${input.productName} is now at ${input.newStock} pcs. Minimum stock is ${input.lowStockThreshold} pcs.`,
    actionUrl: `/staff/inventory?productId=${encodeURIComponent(input.productId)}`
  });
}

async function notifyVariantLowStockIfNeeded(input: {
  productId: string;
  productName: string;
  optionName: string;
  optionValue: string;
  previousStock: number;
  newStock: number;
  previousLowStockThreshold?: number;
  lowStockThreshold: number;
}) {
  const wasLowStock = input.previousStock <= (input.previousLowStockThreshold ?? input.lowStockThreshold);
  const isLowStock = input.newStock <= input.lowStockThreshold;
  if (!isLowStock || wasLowStock) return;

  await createNotificationsForRoles(["STAFF", "ADMIN"], {
    type: "LOW_STOCK",
    title: `Low stock: ${input.productName} — ${input.optionValue}`,
    message: `${input.optionName} ${input.optionValue} is now at ${input.newStock} pcs. Alert level is ${input.lowStockThreshold} pcs.`,
    actionUrl: `/staff/inventory?productId=${encodeURIComponent(input.productId)}`
  });
}

async function getCategoryById(categoryId: string) {
  const { data, error } = await supabaseAdmin
    .from("categories")
    .select("id,name,slug,icon_url,is_active,created_at,updated_at")
    .eq("id", categoryId)
    .maybeSingle();

  if (error) throw HttpError.fromSupabase(error);
  return data ? mapCategory(data as RawCategory) : null;
}

async function getCategoryBySlug(slug: string) {
  const { data, error } = await supabaseAdmin
    .from("categories")
    .select("id,name,slug,icon_url,is_active,created_at,updated_at")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw HttpError.fromSupabase(error);
  return data ? mapCategory(data as RawCategory) : null;
}

async function resolveCategory(input: CategoryInput) {
  if (input.categoryId) {
    const category = await getCategoryById(input.categoryId);
    if (!category) throw new HttpError(400, "Category was not found.");
    return category;
  }

  const categorySlug = input.categorySlug?.trim() || (input.categoryName ? slugify(input.categoryName) : "");
  if (!categorySlug) throw new HttpError(400, "Product category is required.");

  const existingCategory = await getCategoryBySlug(categorySlug);
  if (existingCategory) return existingCategory;

  if (!input.categoryName?.trim()) throw new HttpError(400, "Category name is required when creating a new category.");

  const { data, error } = await supabaseAdmin
    .from("categories")
    .insert({
      name: input.categoryName.trim(),
      slug: categorySlug,
      icon_url: input.categoryIconUrl ?? null,
      is_active: true
    })
    .select("id,name,slug,icon_url,is_active,created_at,updated_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      const category = await getCategoryBySlug(categorySlug);
      if (category) return category;
    }
    throw HttpError.fromSupabase(error);
  }

  return mapCategory(data as RawCategory);
}

async function requireInventoryProduct(productId: string) {
  const product = await getInventoryProduct(productId);
  if (!product) throw new HttpError(404, "Product not found.");
  return product;
}

async function assertUniqueActiveProductName(name: string, ignoreProductId?: string) {
  const trimmedName = name.trim();
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("is_active", true)
    .ilike("name", trimmedName);

  if (error) throw HttpError.fromSupabase(error);

  const duplicate = (data ?? []).find((row) => row.id !== ignoreProductId);
  if (duplicate) throw new HttpError(409, "An active product with this name already exists.");
}

async function recordInventoryMovement(input: {
  productId: string;
  type: "RESTOCK" | "ADJUSTMENT";
  quantity: number;
  previousStock: number;
  newStock: number;
  performedById: string;
  notes?: string | null;
}) {
  if (input.quantity === 0) return;

  const { error } = await supabaseAdmin.from("inventory_movements").insert({
    product_id: input.productId,
    type: input.type,
    quantity: input.quantity,
    previous_stock: input.previousStock,
    new_stock: input.newStock,
    performed_by_id: input.performedById,
    notes: input.notes ?? null
  });

  if (error) throw HttpError.fromSupabase(error);
}

export async function listCategories() {
  const { data, error } = await supabaseAdmin
    .from("categories")
    .select("id,name,slug,icon_url,is_active,created_at,updated_at")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw HttpError.fromSupabase(error);
  return ((data ?? []) as RawCategory[]).map(mapCategory);
}

export async function listInventory(input: InventoryListOptions = {}) {
  const limit = normalizePageLimit(input.limit);
  const cursorId = decodeCursor(input.cursor);
  const query = input.query?.trim();
  const rows = await prisma.product.findMany({
    where: {
      isActive: input.visibility === "ARCHIVED" ? false : true,
      ...(input.productId ? { id: input.productId } : {}),
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(query ? {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          { category: { name: { contains: query, mode: "insensitive" } } }
        ]
      } : {})
    },
    select: inventoryRecordSelect,
    relationLoadStrategy: "join",
    orderBy: [{ name: "asc" }, { id: "asc" }],
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    take: limit + 1
  });

  return createPage(rows.map(mapInventoryRecord), limit);
}

export async function getInventoryProduct(productId: string) {
  const row = await prisma.product.findUnique({
    where: { id: productId },
    select: inventoryRecordSelect,
    relationLoadStrategy: "join"
  });
  return row ? mapInventoryRecord(row) : null;
}

export async function createProduct(input: ProductCreateInput, performedById: string) {
  const category = await resolveCategory(input);
  await assertUniqueActiveProductName(input.name);

  const stock = input.stock ?? 0;
  const lowStockThreshold = input.lowStockThreshold ?? 10;
  const status = input.status ?? deriveProductStatus(stock, lowStockThreshold);
  const saleMode = input.saleMode ?? "SIMPLE";
  const canonicalOptionNames = new Map<string, string>();
  const variants = (input.variants ?? []).map((variant, index) => {
    const enteredOptionName = variant.optionName.trim();
    const optionKey = normalizeVariantPart(enteredOptionName);
    const optionName = canonicalOptionNames.get(optionKey) ?? enteredOptionName;
    canonicalOptionNames.set(optionKey, optionName);
    return {
      id: `new-${index}`,
      optionName,
      optionValue: variant.optionValue.trim(),
      stock: variant.stock ?? 0,
      lowStockThreshold: variant.lowStockThreshold ?? 2
    };
  });
  if (saleMode !== "OPTIONS" && variants.length > 0) {
    throw new HttpError(400, "Simple and cloth-only products cannot have selectable inventory options.", "SALE_MODE_OPTIONS_NOT_ALLOWED");
  }
  if (saleMode === "OPTIONS" && variants.length === 0 && stock > 0) {
    throw new HttpError(400, "Add at least one option before opening stock for an option-based product.", "OPTIONS_REQUIRE_VARIANTS");
  }
  const optionGroupCount = new Set(variants.map((variant) => normalizeVariantPart(variant.optionName))).size;
  if (saleMode === "OPTIONS" && optionGroupCount > 1 && stock > 0) {
    throw new HttpError(
      400,
      "Products with multiple option groups must start at zero and use Set up inventory to enter exact physical combinations.",
      "MULTI_OPTION_OPENING_STOCK_REQUIRES_RECONCILIATION"
    );
  }

  const allocationIssue = saleMode === "OPTIONS" ? validateVariantGroupTotals(variants, stock) : null;
  if (allocationIssue?.code === "DUPLICATE_VARIANT") {
    throw new HttpError(
      400,
      `${allocationIssue.optionName}: ${allocationIssue.optionValue} is listed more than once.`,
      "DUPLICATE_VARIANT_STOCK"
    );
  }
  if (allocationIssue?.code === "TOTAL_MISMATCH") {
    throw new HttpError(
      400,
      `${allocationIssue.optionName} quantities must total the opening stock of ${allocationIssue.expectedTotal}.`,
      "VARIANT_STOCK_TOTAL_MISMATCH",
      allocationIssue
    );
  }

  const created = await prisma.$transaction(async (transaction) => {
    const product = await transaction.product.create({
      data: {
        categoryId: category.id,
        name: input.name.trim(),
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        imageStoragePath: input.imageStoragePath ?? null,
        price: input.price,
        oldPrice: input.oldPrice ?? null,
        status,
        stock,
        lowStockThreshold,
        isActive: true,
        saleMode,
        ...(variants.length ? {
          variants: {
            create: variants.map((variant) => ({
              optionName: variant.optionName,
              optionValue: variant.optionValue,
              stock: variant.stock,
              lowStockThreshold: variant.lowStockThreshold
            }))
          }
        } : {})
      },
      select: {
        id: true,
        variants: { select: { id: true, stock: true, optionName: true, optionValue: true, lowStockThreshold: true } }
      }
    });

    await transaction.inventoryMovement.create({
      data: {
        productId: product.id,
        type: "RESTOCK",
        quantity: stock,
        previousStock: 0,
        newStock: stock,
        performedById,
        notes: input.notes ?? "Initial product stock."
      },
      select: { id: true }
    });
    if (product.variants.length) {
      await transaction.inventoryMovement.createMany({
        data: product.variants.map((variant) => ({
          productId: product.id,
          variantId: variant.id,
          type: "RESTOCK" as const,
          quantity: variant.stock,
          previousStock: 0,
          newStock: variant.stock,
          performedById,
          notes: input.notes ?? `Initial ${variant.optionName}: ${variant.optionValue} stock.`
        }))
      });

      // A product with exactly one option group (for example Size) has an
      // unambiguous physical SKU per option value. Build those SKUs in the
      // same database transaction as product creation so a network failure
      // cannot leave a half-created product that still needs a second API call.
      const optionGroupKeys = new Set(
        product.variants.map((variant) => normalizeVariantPart(variant.optionName))
      );
      if (saleMode === "OPTIONS" && optionGroupKeys.size === 1) {
        for (const variant of product.variants) {
          const sku = await transaction.productSku.create({
            data: {
              productId: product.id,
              code: `SKU-${randomUUID().slice(0, 8).toUpperCase()}`,
              stock: variant.stock,
              lowStockThreshold: variant.lowStockThreshold,
              isActive: true,
              optionSnapshot: [{
                variantId: variant.id,
                optionName: variant.optionName,
                optionValue: variant.optionValue
              }],
              optionValues: { create: [{ variantId: variant.id }] }
            },
            select: { id: true }
          });

          await transaction.inventoryMovement.create({
            data: {
              productId: product.id,
              skuId: sku.id,
              type: "RESTOCK",
              quantity: variant.stock,
              previousStock: 0,
              newStock: variant.stock,
              performedById,
              notes: input.notes ?? `Initial ${variant.optionName}: ${variant.optionValue} SKU stock.`
            },
            select: { id: true }
          });
        }

        await transaction.product.update({
          where: { id: product.id },
          data: {
            skuInventoryEnabled: true,
            inventoryReconciledAt: new Date(),
            updatedAt: new Date()
          },
          select: { id: true }
        });
      }
    }
    return product;
  }, INVENTORY_WRITE_TRANSACTION_OPTIONS).catch((error) => {
    throw mapInventoryTransactionError(error);
  });

  await notifyLowStockIfNeeded({
    productId: created.id,
    productName: input.name.trim(),
    previousStock: Number.POSITIVE_INFINITY,
    newStock: stock,
    lowStockThreshold
  });

  const createdProduct = await requireInventoryProduct(created.id);

  await safelyRecordAuditLog({
    actorId: performedById,
    action: "PRODUCT_CREATED",
    entityType: "product",
    entityId: createdProduct.id,
    summary: `Created product ${createdProduct.name}.`,
    metadata: {
      name: createdProduct.name,
      category: createdProduct.category?.name,
      stock: createdProduct.stock,
      price: createdProduct.price
    }
  });

  return createdProduct;
}

export async function updateProduct(productId: string, input: ProductUpdateInput, performedById: string) {
  const initialProduct = await requireInventoryProduct(productId);
  let categoryId: string | undefined;
  if (input.categoryId || input.categorySlug || input.categoryName) {
    categoryId = (await resolveCategory(input)).id;
  }
  if (input.name !== undefined) await assertUniqueActiveProductName(input.name, productId);
  if (initialProduct.skuInventoryEnabled && input.stock !== undefined) {
    throw new HttpError(400, "Use Update stock to change SKU inventory totals.", "SKU_AWARE_STOCK_UPDATE_REQUIRED");
  }

  const hasProductChanges = Boolean(
    categoryId ||
    input.name !== undefined ||
    input.description !== undefined ||
    input.imageUrl !== undefined ||
    input.imageStoragePath !== undefined ||
    input.price !== undefined ||
    input.oldPrice !== undefined ||
    input.status !== undefined ||
    input.stock !== undefined ||
    input.lowStockThreshold !== undefined ||
    input.isActive !== undefined
  );
  if (!hasProductChanges) return initialProduct;
  const changedFields = [
    categoryId ? "category_id" : null,
    input.name !== undefined ? "name" : null,
    input.description !== undefined ? "description" : null,
    input.imageUrl !== undefined ? "image_url" : null,
    input.imageStoragePath !== undefined ? "image_storage_path" : null,
    input.price !== undefined ? "price" : null,
    input.oldPrice !== undefined ? "old_price" : null,
    input.status !== undefined || input.stock !== undefined || input.lowStockThreshold !== undefined ? "status" : null,
    input.stock !== undefined ? "stock" : null,
    input.lowStockThreshold !== undefined ? "low_stock_threshold" : null,
    input.isActive !== undefined ? "is_active" : null
  ].filter((field): field is string => Boolean(field));

  const transactionResult = await prisma
    .$transaction(async (transaction) => {
      const productExists = await lockProductForUpdate(transaction, productId);
      if (!productExists) throw new HttpError(404, "Product not found.");

      const current = await transaction.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          name: true,
          price: true,
          status: true,
          stock: true,
          lowStockThreshold: true,
          isActive: true,
          variants: { select: { id: true }, take: 1 }
        }
      });
      if (!current) throw new HttpError(404, "Product not found.");
      if (input.stock !== undefined && current.variants.length) {
        throw new HttpError(
          400,
          "Use the stock update action so the product total and option quantities stay aligned.",
          "VARIANT_AWARE_RESTOCK_REQUIRED"
        );
      }

      const nextStock = input.stock ?? current.stock;
      const nextLowStockThreshold = input.lowStockThreshold ?? current.lowStockThreshold;
      const nextStatus = input.status ??
        (
          input.stock !== undefined || input.lowStockThreshold !== undefined
            ? deriveProductStatus(nextStock, nextLowStockThreshold, current.status)
            : current.status
        );
      const updates: Prisma.ProductUncheckedUpdateInput = {
        updatedAt: new Date()
      };
      if (categoryId) updates.categoryId = categoryId;
      if (input.name !== undefined) updates.name = input.name.trim();
      if (input.description !== undefined) updates.description = input.description;
      if (input.imageUrl !== undefined) updates.imageUrl = input.imageUrl;
      if (input.imageStoragePath !== undefined) updates.imageStoragePath = input.imageStoragePath;
      if (input.price !== undefined) updates.price = input.price;
      if (input.oldPrice !== undefined) updates.oldPrice = input.oldPrice;
      if (input.status !== undefined || input.stock !== undefined || input.lowStockThreshold !== undefined) {
        updates.status = nextStatus;
      }
      if (input.stock !== undefined) updates.stock = input.stock;
      if (input.lowStockThreshold !== undefined) updates.lowStockThreshold = input.lowStockThreshold;
      if (input.isActive !== undefined) updates.isActive = input.isActive;

      const updated = await transaction.product.update({
        where: { id: productId },
        data: updates,
        select: {
          id: true,
          name: true,
          price: true,
          status: true,
          stock: true,
          lowStockThreshold: true,
          isActive: true
        }
      });

      let inventoryMovementId: string | undefined;
      if (updated.stock !== current.stock) {
        const movement = await transaction.inventoryMovement.create({
          data: {
            productId,
            type: "ADJUSTMENT",
            quantity: updated.stock - current.stock,
            previousStock: current.stock,
            newStock: updated.stock,
            performedById,
            notes: input.notes ?? "Product stock adjusted."
          },
          select: { id: true }
        });
        inventoryMovementId = movement.id;
      }

      await createBackInStockNotificationsInTransaction(
        transaction,
        {
          productId,
          productName: updated.name,
          previous: current,
          next: updated,
          eventId: inventoryMovementId
        }
      );

      return { current, updated };
    }, INVENTORY_WRITE_TRANSACTION_OPTIONS)
    .catch((error) => {
      throw mapInventoryTransactionError(error);
    });

  const updatedProduct = await requireInventoryProduct(productId);
  await notifyLowStockIfNeeded({
    productId: updatedProduct.id,
    productName: updatedProduct.name,
    previousStock: transactionResult.current.stock,
    newStock: updatedProduct.stock,
    previousLowStockThreshold: transactionResult.current.lowStockThreshold,
    lowStockThreshold: updatedProduct.lowStockThreshold
  });

  await safelyRecordAuditLog({
    actorId: performedById,
    action: "PRODUCT_UPDATED",
    entityType: "product",
    entityId: productId,
    summary: `Updated product ${updatedProduct.name}.`,
    metadata: {
      changedFields,
      previous: {
        name: transactionResult.current.name,
        stock: transactionResult.current.stock,
        lowStockThreshold: transactionResult.current.lowStockThreshold,
        price: transactionResult.current.price,
        status: transactionResult.current.status,
        isActive: transactionResult.current.isActive
      },
      next: {
        name: updatedProduct.name,
        stock: updatedProduct.stock,
        lowStockThreshold: updatedProduct.lowStockThreshold,
        price: updatedProduct.price,
        status: updatedProduct.status,
        isActive: updatedProduct.isActive
      }
    }
  });

  return updatedProduct;
}


export async function updateProductSaleMode(
  productId: string,
  saleMode: ProductSaleMode,
  performedById: string
) {
  const result = await prisma.$transaction(async (transaction) => {
    const productExists = await lockProductForUpdate(transaction, productId);
    if (!productExists) throw new HttpError(404, "Product not found.");

    const product = await transaction.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        saleMode: true,
        stock: true,
        status: true,
        lowStockThreshold: true,
        skuInventoryEnabled: true,
        skus: { where: { isActive: true }, select: { id: true, stock: true } }
      }
    });
    if (!product) throw new HttpError(404, "Product not found.");
    if (product.saleMode === saleMode) return { previousMode: product.saleMode, changed: false };

    const changesInventoryStructure = product.saleMode === "OPTIONS" || saleMode === "OPTIONS";
    if (changesInventoryStructure) {
      const reservationBlockers = await transaction.reservationItem.count({
        where: {
          productId,
          OR: [
            { reservation: { status: { in: ["PENDING", "CONFIRMED", "READY_FOR_PICKUP"] } } },
            {
              reservation: {
                onlinePayment: {
                  is: { status: { in: ["INITIALIZING", "AWAITING_PAYMENT", "REFUND_REVIEW_REQUIRED", "PARTIALLY_REFUNDED"] } }
                }
              }
            }
          ]
        }
      });
      if (reservationBlockers > 0) {
        throw new HttpError(
          409,
          "Finish, cancel, or settle active reservations and payments for this product before changing how it is sold.",
          "SALE_MODE_HAS_ACTIVE_RESERVATIONS"
        );
      }
    }

    if (saleMode === "OPTIONS") {
      await transaction.productSku.updateMany({
        where: { productId, isActive: true },
        data: { isActive: false, updatedAt: new Date() }
      });
      await transaction.product.update({
        where: { id: productId },
        data: {
          saleMode: "OPTIONS",
          skuInventoryEnabled: false,
          inventoryReconciledAt: null,
          updatedAt: new Date()
        },
        select: { id: true }
      });
      return { previousMode: product.saleMode, changed: true };
    }

    const physicalStock = product.skuInventoryEnabled
      ? product.skus.reduce((total, sku) => total + Math.max(0, sku.stock), 0)
      : product.stock;

    await transaction.productSku.updateMany({
      where: { productId, isActive: true },
      data: { isActive: false, updatedAt: new Date() }
    });
    await transaction.productVariant.updateMany({
      where: { productId },
      data: { stock: 0, updatedAt: new Date() }
    });
    await transaction.product.update({
      where: { id: productId },
      data: {
        saleMode,
        stock: physicalStock,
        status: deriveProductStatus(physicalStock, product.lowStockThreshold, product.status),
        skuInventoryEnabled: false,
        inventoryReconciledAt: null,
        updatedAt: new Date()
      },
      select: { id: true }
    });

    return { previousMode: product.saleMode, changed: true };
  }, INVENTORY_WRITE_TRANSACTION_OPTIONS).catch((error) => {
    throw mapInventoryTransactionError(error);
  });

  const updatedProduct = await requireInventoryProduct(productId);
  if (result.changed) {
    await safelyRecordAuditLog({
      actorId: performedById,
      action: "PRODUCT_SALE_MODE_UPDATED",
      entityType: "product",
      entityId: productId,
      summary: `Changed ${updatedProduct.name} selling mode from ${result.previousMode} to ${saleMode}.`,
      metadata: {
        previousMode: result.previousMode,
        saleMode,
        stock: updatedProduct.stock,
        skuInventoryEnabled: updatedProduct.skuInventoryEnabled
      }
    });
  }
  return updatedProduct;
}

export async function archiveProduct(productId: string, performedById: string) {
  const current = await requireInventoryProduct(productId);

  await prisma.product.update({
    where: { id: productId },
    data: { isActive: false, updatedAt: new Date() },
    select: { id: true }
  });

  await recordInventoryMovement({
    productId,
    type: "ADJUSTMENT",
    quantity: 0,
    previousStock: current.stock,
    newStock: current.stock,
    performedById,
    notes: "Product archived."
  });

  const archivedProduct = await requireInventoryProduct(productId);

  await safelyRecordAuditLog({
    actorId: performedById,
    action: "PRODUCT_ARCHIVED",
    entityType: "product",
    entityId: productId,
    summary: `Archived product ${archivedProduct.name}.`,
    metadata: {
      name: archivedProduct.name,
      stock: archivedProduct.stock
    }
  });

  return archivedProduct;
}

export async function restoreProduct(productId: string, performedById: string) {
  const current = await requireInventoryProduct(productId);
  if (current.isActive) return current;

  await prisma.product.update({
    where: { id: productId },
    data: { isActive: true, updatedAt: new Date() },
    select: { id: true }
  });

  const restoredProduct = await requireInventoryProduct(productId);

  await safelyRecordAuditLog({
    actorId: performedById,
    action: "PRODUCT_RESTORED",
    entityType: "product",
    entityId: productId,
    summary: `Restored product ${restoredProduct.name}.`,
    metadata: {
      name: restoredProduct.name,
      stock: restoredProduct.stock,
      status: restoredProduct.status,
      saleMode: restoredProduct.saleMode
    }
  });

  return restoredProduct;
}

export async function restockProduct(input: {
  productId: string;
  quantity: number;
  mode?: "add" | "set";
  variantQuantities?: ProductVariantQuantityInput[];
  performedById: string;
  notes?: string;
}) {
  const mode = input.mode ?? "add";
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 0 || input.quantity > 10_000_000) {
    throw new HttpError(400, "Stock quantity must be a whole number from 0 to 10,000,000.", "INVALID_STOCK_QUANTITY");
  }
  const invalidVariantQuantity = input.variantQuantities?.find(
    (entry) => !Number.isSafeInteger(entry.quantity) || entry.quantity < 0 || entry.quantity > 10_000_000
  );
  if (invalidVariantQuantity) {
    throw new HttpError(400, "Every option quantity must be a whole number from 0 to 10,000,000.", "INVALID_VARIANT_STOCK_QUANTITY");
  }
  const transactionResult = await prisma
    .$transaction(async (transaction) => {
      const productExists = await lockProductForUpdate(transaction, input.productId);
      if (!productExists) throw new HttpError(404, "Product not found.");

      const product = await transaction.product.findUnique({
        where: { id: input.productId },
        select: {
          id: true,
          name: true,
          status: true,
          stock: true,
          lowStockThreshold: true,
          isActive: true,
          saleMode: true,
          skuInventoryEnabled: true,
          variants: {
            select: {
              id: true,
              optionName: true,
              optionValue: true,
              stock: true,
              lowStockThreshold: true
            },
            orderBy: [{ optionName: "asc" }, { optionValue: "asc" }]
          }
        }
      });
      if (!product) throw new HttpError(404, "Product not found.");
      if (product.skuInventoryEnabled) {
        throw new HttpError(409, "This product uses SKU inventory. Update stock by physical combination instead.", "SKU_AWARE_STOCK_UPDATE_REQUIRED");
      }
      if (mode === "set") {
        await requireNoActiveInventoryReservations(transaction, input.productId, {
          message: "Complete or cancel active reservations for this product before correcting its available stock.",
          code: "EXACT_COUNT_HAS_ACTIVE_RESERVATIONS"
        });
      }

      const newStock = mode === "set" ? input.quantity : product.stock + input.quantity;
      const stockVariants = product.saleMode === "OPTIONS" ? product.variants : [];
      const groupedVariants = new Map<string, typeof stockVariants>();
      for (const variant of stockVariants) {
        const groupKey = normalizeVariantPart(variant.optionName);
        const group = groupedVariants.get(groupKey) ?? [];
        group.push(variant);
        groupedVariants.set(groupKey, group);
      }

      const requestedVariantQuantities = input.variantQuantities ?? [];
      const requestedById = new Map(requestedVariantQuantities.map((entry) => [entry.variantId, entry.quantity]));
      if (requestedById.size !== requestedVariantQuantities.length) {
        throw new HttpError(400, "Each product option may be included only once.", "DUPLICATE_VARIANT_STOCK");
      }

      const allDimensionsHaveOneValue = stockVariants.length > 0
        && Array.from(groupedVariants.values()).every((group) => group.length === 1);
      let nextVariantStocks = new Map<string, number>();

      if (stockVariants.length && allDimensionsHaveOneValue && !requestedVariantQuantities.length) {
        nextVariantStocks = new Map(stockVariants.map((variant) => [variant.id, newStock]));
      } else if (stockVariants.length) {
        const knownIds = new Set(stockVariants.map((variant) => variant.id));
        if (
          requestedVariantQuantities.length !== stockVariants.length
          || requestedVariantQuantities.some((entry) => !knownIds.has(entry.variantId))
        ) {
          throw new HttpError(
            400,
            "Enter a stock quantity for every option value before saving.",
            "VARIANT_STOCK_ALLOCATION_REQUIRED"
          );
        }

        for (const variants of groupedVariants.values()) {
          const optionName = variants[0]?.optionName ?? "Option";
          const requestedTotal = variants.reduce(
            (total, variant) => total + (requestedById.get(variant.id) ?? 0),
            0
          );
          const expectedTotal = mode === "set" ? newStock : input.quantity;
          if (requestedTotal !== expectedTotal) {
            throw new HttpError(
              400,
              `${optionName} quantities must total ${expectedTotal}.`,
              "VARIANT_STOCK_TOTAL_MISMATCH",
              { optionName, expectedTotal, actualTotal: requestedTotal }
            );
          }

          if (mode === "add") {
            const currentTotal = variants.reduce((total, variant) => total + variant.stock, 0);
            if (currentTotal !== product.stock) {
              throw new HttpError(
                409,
                `${optionName} stock needs reconciliation. Use Set exact stock and enter the correct quantity for every option.`,
                "VARIANT_STOCK_RECONCILIATION_REQUIRED",
                { optionName, productStock: product.stock, optionStock: currentTotal }
              );
            }
          }
        }

        nextVariantStocks = new Map(stockVariants.map((variant) => [
          variant.id,
          mode === "set"
            ? requestedById.get(variant.id) ?? 0
            : variant.stock + (requestedById.get(variant.id) ?? 0)
        ]));
      }
      const previousOptionGroupsAvailable = optionGroupsHaveAvailableStock(stockVariants);
      const nextOptionGroupsAvailable = optionGroupsHaveAvailableStock(
        stockVariants.map((variant) => ({
          ...variant,
          stock: nextVariantStocks.get(variant.id) ?? variant.stock
        }))
      );

      const status = deriveProductStatus(newStock, product.lowStockThreshold, product.status);
      const updated = await transaction.product.update({
        where: { id: input.productId },
        data: {
          stock: newStock,
          status,
          updatedAt: new Date()
        },
        select: {
          id: true,
          name: true,
          status: true,
          stock: true,
          lowStockThreshold: true,
          isActive: true
        }
      });

      const difference = newStock - product.stock;
      let inventoryMovementId: string | undefined;
      if (difference !== 0) {
        const movement = await transaction.inventoryMovement.create({
          data: {
            productId: input.productId,
            type: difference >= 0 ? "RESTOCK" : "ADJUSTMENT",
            quantity: difference,
            previousStock: product.stock,
            newStock,
            performedById: input.performedById,
            notes: input.notes ?? (mode === "set" ? "Stock set by staff." : "Stock added by staff.")
          },
          select: { id: true }
        });
        inventoryMovementId = movement.id;
      }

      const variantChanges = stockVariants.flatMap((variant) => {
        const nextStock = nextVariantStocks.get(variant.id);
        return nextStock === undefined || nextStock === variant.stock
          ? []
          : [{ ...variant, nextStock, difference: nextStock - variant.stock }];
      });
      if (variantChanges.length) {
        const stockRows = variantChanges.map((variant) => Prisma.sql`
          (${variant.id}::uuid, ${variant.nextStock}::integer)
        `);
        await transaction.$executeRaw`
          UPDATE "product_variants" AS pv
          SET
            "stock" = next."stock",
            "updated_at" = CURRENT_TIMESTAMP
          FROM (VALUES ${Prisma.join(stockRows)}) AS next("id", "stock")
          WHERE pv."product_id" = ${input.productId}::uuid
            AND pv."id" = next."id"
        `;
        await transaction.inventoryMovement.createMany({
          data: variantChanges.map((variant) => ({
            productId: input.productId,
            variantId: variant.id,
            type: mode === "add"
              && variant.difference >= 0
              && (requestedVariantQuantities.length > 0 || variant.stock === product.stock)
              ? "RESTOCK"
              : "ADJUSTMENT",
            quantity: variant.difference,
            previousStock: variant.stock,
            newStock: variant.nextStock,
            performedById: input.performedById,
            notes: input.notes ?? `Updated ${variant.optionName}: ${variant.optionValue} stock.`
          }))
        });
      }

      await createBackInStockNotificationsInTransaction(
        transaction,
        {
          productId: input.productId,
          productName: updated.name,
          previous: { ...product, optionGroupsAvailable: previousOptionGroupsAvailable },
          next: { ...updated, optionGroupsAvailable: nextOptionGroupsAvailable },
          eventId: inventoryMovementId
        }
      );

      return { product, updated, difference, variantChanges };
    }, INVENTORY_WRITE_TRANSACTION_OPTIONS)
    .catch((error) => {
      throw mapInventoryTransactionError(error);
    });

  const updatedProduct = await requireInventoryProduct(input.productId);
  await notifyLowStockIfNeeded({
    productId: updatedProduct.id,
    productName: updatedProduct.name,
    previousStock: transactionResult.product.stock,
    newStock: updatedProduct.stock,
    previousLowStockThreshold: transactionResult.product.lowStockThreshold,
    lowStockThreshold: updatedProduct.lowStockThreshold
  });

  for (const previous of transactionResult.variantChanges) {
    const current = updatedProduct.variants.find((variant) => variant.id === previous.id);
    if (!current) continue;
    await notifyVariantLowStockIfNeeded({
      productId: updatedProduct.id,
      productName: updatedProduct.name,
      optionName: current.optionName,
      optionValue: current.optionValue,
      previousStock: previous.stock,
      newStock: current.stock,
      previousLowStockThreshold: previous.lowStockThreshold,
      lowStockThreshold: current.lowStockThreshold
    }).catch(() => undefined);
  }

  await safelyRecordAuditLog({
    actorId: input.performedById,
    action: input.mode === "set" ? "PRODUCT_STOCK_SET" : "PRODUCT_RESTOCKED",
    entityType: "product",
    entityId: input.productId,
    summary: `${input.mode === "set" ? "Set stock for" : "Restocked"} ${updatedProduct.name}.`,
    metadata: {
      mode,
      quantity: input.quantity,
      previousStock: transactionResult.product.stock,
      newStock: updatedProduct.stock,
      difference: transactionResult.difference,
      variantChanges: transactionResult.variantChanges.map((variant) => ({
        variantId: variant.id,
        optionName: variant.optionName,
        optionValue: variant.optionValue,
        previousStock: variant.stock,
        newStock: variant.nextStock
      })),
      notes: input.notes ?? null
    }
  });

  return updatedProduct;
}

export async function syncProductVariants(
  productId: string,
  optionName: string,
  definitions: ProductVariantDefinitionInput[],
  performedById?: string
) {
  const canonicalOptionName = optionName.trim();
  const optionKey = normalizeVariantPart(canonicalOptionName);
  const normalized = definitions.map((definition) => ({
    id: definition.id,
    optionName: canonicalOptionName,
    optionValue: definition.optionValue.trim(),
    lowStockThreshold: definition.lowStockThreshold
  }));

  const seen = new Set<string>();
  for (const definition of normalized) {
    const key = normalizeVariantPart(definition.optionValue);
    if (seen.has(key)) {
      throw new HttpError(400, `${definition.optionValue} is listed more than once.`, "DUPLICATE_VARIANT");
    }
    seen.add(key);
  }

  const transactionResult = await prisma.$transaction(async (transaction) => {
    const productExists = await lockProductForUpdate(transaction, productId);
    if (!productExists) throw new HttpError(404, "Product not found.");

    const product = await transaction.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        stock: true,
        saleMode: true,
        skuInventoryEnabled: true,
        variants: {
          select: {
            id: true,
            optionName: true,
            optionValue: true,
            stock: true,
            lowStockThreshold: true
          }
        }
      }
    });
    if (!product) throw new HttpError(404, "Product not found.");
    if (product.saleMode !== "OPTIONS") {
      throw new HttpError(409, "Change Selling setup to With sizes/options before managing product options.", "SALE_MODE_OPTIONS_REQUIRED");
    }

    const targetVariants = product.variants.filter(
      (variant) => normalizeVariantPart(variant.optionName) === optionKey
    );
    if (product.skuInventoryEnabled && targetVariants.length === 0 && normalized.length > 0) {
      throw new HttpError(
        409,
        "Add new option groups while rebuilding inventory combinations so every physical SKU stays complete.",
        "SKU_NEW_OPTION_GROUP_REQUIRES_REBUILD"
      );
    }
    const existingById = new Map(targetVariants.map((variant) => [variant.id, variant]));
    const requestedIds = normalized.flatMap((definition) => definition.id ? [definition.id] : []);
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new HttpError(400, "Each existing size may be included only once.", "DUPLICATE_VARIANT_ID");
    }
    const unknownId = requestedIds.find((id) => !existingById.has(id));
    if (unknownId) throw new HttpError(400, "One of the size values no longer exists. Refresh and try again.");

    const requestedIdSet = new Set(requestedIds);
    const removed = targetVariants.filter((variant) => !requestedIdSet.has(variant.id));
    const added = normalized.filter((definition) => !definition.id);
    const labelChanged = normalized.some((definition) => {
      if (!definition.id) return false;
      const current = existingById.get(definition.id)!;
      return normalizeVariantPart(current.optionValue) !== normalizeVariantPart(definition.optionValue);
    });
    const structuralChange = removed.length > 0 || added.length > 0 || labelChanged;

    if (structuralChange && product.skuInventoryEnabled) {
      if (removed.length) {
        const linkedCount = await transaction.productSkuVariant.count({
          where: {
            variantId: { in: removed.map((variant) => variant.id) },
            sku: { isActive: true }
          }
        });
        if (linkedCount > 0) {
          throw new HttpError(
            409,
            "This option is used by an inventory combination. Rebuild inventory combinations before removing it.",
            "SKU_OPTION_VALUE_IN_USE"
          );
        }
      }
    }

    if (structuralChange && !product.skuInventoryEnabled) {
      const activeReservationCount = await transaction.reservationItem.count({
        where: {
          productId,
          reservation: { status: { in: ["PENDING", "CONFIRMED", "READY_FOR_PICKUP"] } }
        }
      });
      if (activeReservationCount > 0) {
        throw new HttpError(
          409,
          "Finish or cancel active reservations for this product before changing its size list or size names.",
          "VARIANT_STRUCTURE_HAS_ACTIVE_RESERVATIONS"
        );
      }
    }

    // Move renamed values to temporary unique keys first so swaps such as M <-> Medium
    // stay atomic and never fail on the composite unique constraint halfway through.
    for (const definition of normalized) {
      if (!definition.id) continue;
      const current = existingById.get(definition.id)!;
      if (normalizeVariantPart(current.optionValue) === normalizeVariantPart(definition.optionValue)) continue;
      await transaction.productVariant.update({
        where: { id: current.id },
        data: {
          optionValue: `__wescomm_variant_sync_${current.id}`,
          updatedAt: new Date()
        },
        select: { id: true }
      });
    }

    if (removed.length) {
      await transaction.productVariant.deleteMany({
        where: { id: { in: removed.map((variant) => variant.id) }, productId }
      });
    }

    for (const definition of normalized) {
      if (!definition.id) continue;
      await transaction.productVariant.update({
        where: { id: definition.id },
        data: {
          optionName: canonicalOptionName,
          optionValue: definition.optionValue,
          lowStockThreshold: definition.lowStockThreshold,
          updatedAt: new Date()
        },
        select: { id: true }
      });
    }

    if (added.length) {
      await transaction.productVariant.createMany({
        data: added.map((definition) => ({
          productId,
          optionName: canonicalOptionName,
          optionValue: definition.optionValue,
          stock: 0,
          lowStockThreshold: definition.lowStockThreshold
        }))
      });
    }

    return { productName: product.name, previousVariants: targetVariants, structuralChange };
  }, INVENTORY_WRITE_TRANSACTION_OPTIONS).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "This size already exists.");
    }
    throw mapInventoryTransactionError(error);
  });

  const product = await requireInventoryProduct(productId);
  for (const previous of transactionResult.previousVariants) {
    const current = product.variants.find((variant) => variant.id === previous.id);
    if (!current) continue;
    await notifyVariantLowStockIfNeeded({
      productId,
      productName: transactionResult.productName,
      optionName: current.optionName,
      optionValue: current.optionValue,
      previousStock: previous.stock,
      newStock: current.stock,
      previousLowStockThreshold: previous.lowStockThreshold,
      lowStockThreshold: current.lowStockThreshold
    }).catch(() => undefined);
  }

  await safelyRecordAuditLog({
    actorId: performedById,
    action: "PRODUCT_VARIANTS_SYNCED",
    entityType: "product",
    entityId: productId,
    summary: `Updated ${canonicalOptionName} settings for ${product.name}.`,
    metadata: {
      optionName: canonicalOptionName,
      variantCount: normalized.length,
      structuralChange: transactionResult.structuralChange,
      variants: normalized.map((variant) => ({
        id: variant.id ?? null,
        optionValue: variant.optionValue,
        lowStockThreshold: variant.lowStockThreshold
      }))
    }
  });

  return product;
}

export async function createProductVariant(productId: string, input: ProductVariantInput, performedById?: string) {
  const requestedStock = input.stock ?? 0;
  await prisma.$transaction(async (transaction) => {
    const productExists = await lockProductForUpdate(transaction, productId);
    if (!productExists) throw new HttpError(404, "Product not found.");
    const product = await transaction.product.findUnique({
      where: { id: productId },
      select: { stock: true, saleMode: true, skuInventoryEnabled: true, variants: { select: { stock: true, optionName: true } } }
    });
    if (!product) throw new HttpError(404, "Product not found.");
    if (product.saleMode !== "OPTIONS") {
      throw new HttpError(409, "Change Selling setup to With sizes/options before adding product options.", "SALE_MODE_OPTIONS_REQUIRED");
    }
    if (
      product.skuInventoryEnabled
      && !product.variants.some((variant) => normalizeVariantPart(variant.optionName) === normalizeVariantPart(input.optionName))
    ) {
      throw new HttpError(
        409,
        "Add new option groups while rebuilding inventory combinations so every physical SKU stays complete.",
        "SKU_NEW_OPTION_GROUP_REQUIRES_REBUILD"
      );
    }
    if (requestedStock !== 0) {
      throw new HttpError(400, "New option values start at zero stock. Add them to an inventory combination before stocking them.", "SKU_NEW_OPTION_ZERO_STOCK_REQUIRED");
    }
    if (!product.skuInventoryEnabled) {
      const activeReservationCount = await transaction.reservationItem.count({
        where: {
          productId,
          reservation: { status: { in: ["PENDING", "CONFIRMED", "READY_FOR_PICKUP"] } }
        }
      });
      if (activeReservationCount > 0) {
        throw new HttpError(
          409,
          "Finish or cancel active reservations for this product before adding an option value.",
          "VARIANT_STRUCTURE_HAS_ACTIVE_RESERVATIONS"
        );
      }
    }

    await transaction.productVariant.create({
      data: {
        productId,
        optionName: product.variants.find(
          (variant) => normalizeVariantPart(variant.optionName) === normalizeVariantPart(input.optionName)
        )?.optionName ?? input.optionName.trim(),
        optionValue: input.optionValue.trim(),
        stock: 0,
        lowStockThreshold: input.lowStockThreshold ?? 2
      },
      select: { id: true }
    });
  }, INVENTORY_WRITE_TRANSACTION_OPTIONS).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "This product variant already exists.");
    }
    throw mapInventoryTransactionError(error);
  });

  const product = await requireInventoryProduct(productId);

  await safelyRecordAuditLog({
    actorId: performedById,
    action: "PRODUCT_VARIANT_CREATED",
    entityType: "product",
    entityId: productId,
    summary: `Created variant ${input.optionName}: ${input.optionValue} for ${product.name}.`,
    metadata: {
      optionName: input.optionName,
      optionValue: input.optionValue,
      stock: input.stock ?? 0
    }
  });

  return product;
}

export async function updateProductVariant(
  productId: string,
  variantId: string,
  input: Partial<ProductVariantInput>,
  performedById?: string
) {
  if (input.stock !== undefined) {
    throw new HttpError(
      400,
      "Use the product stock update action to change option quantities atomically.",
      "VARIANT_AWARE_RESTOCK_REQUIRED"
    );
  }

  const changedFields: string[] = [];
  await prisma.$transaction(async (transaction) => {
    const productExists = await lockProductForUpdate(transaction, productId);
    if (!productExists) throw new HttpError(404, "Product not found.");
    const product = await transaction.product.findUnique({
      where: { id: productId },
      select: {
        stock: true,
        variants: { select: { id: true, optionName: true, optionValue: true, stock: true, lowStockThreshold: true } }
      }
    });
    if (!product) throw new HttpError(404, "Product not found.");
    const current = product.variants.find((variant) => variant.id === variantId);
    if (!current) throw new HttpError(404, "Product variant not found.");

    const optionNameChanged = input.optionName !== undefined
      && normalizeVariantPart(input.optionName) !== normalizeVariantPart(current.optionName);
    const optionValueChanged = input.optionValue !== undefined
      && normalizeVariantPart(input.optionValue) !== normalizeVariantPart(current.optionValue);
    const variantLabelChanged = optionNameChanged || optionValueChanged;
    if (
      variantLabelChanged
      && (product.stock !== 0 || product.variants.some((variant) => variant.stock !== 0))
    ) {
      throw new HttpError(
        409,
        "Set the product and all option quantities to zero before renaming or moving an option value.",
        "VARIANT_STRUCTURE_REQUIRES_ZERO_STOCK"
      );
    }
    if (variantLabelChanged) {
      const activeReservationCount = await transaction.reservationItem.count({
        where: {
          productId,
          reservation: { status: { in: ["PENDING", "CONFIRMED", "READY_FOR_PICKUP"] } }
        }
      });
      if (activeReservationCount > 0) {
        throw new HttpError(
          409,
          "Finish or cancel active reservations for this product before renaming an option value.",
          "VARIANT_STRUCTURE_HAS_ACTIVE_RESERVATIONS"
        );
      }
    }

    const updates: Prisma.ProductVariantUpdateInput = {};
    if (input.optionName !== undefined) {
      updates.optionName = optionNameChanged
        ? product.variants.find(
            (variant) => variant.id !== variantId
              && normalizeVariantPart(variant.optionName) === normalizeVariantPart(input.optionName!)
          )?.optionName ?? input.optionName.trim()
        : current.optionName;
      changedFields.push("optionName");
    }
    if (input.optionValue !== undefined) {
      updates.optionValue = input.optionValue.trim();
      changedFields.push("optionValue");
    }
    if (input.lowStockThreshold !== undefined) {
      updates.lowStockThreshold = input.lowStockThreshold;
      changedFields.push("lowStockThreshold");
    }
    if (changedFields.length) {
      updates.updatedAt = new Date();
      await transaction.productVariant.update({
        where: { id: variantId },
        data: updates,
        select: { id: true }
      });
    }
  }, INVENTORY_WRITE_TRANSACTION_OPTIONS).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "This product variant already exists.");
    }
    throw mapInventoryTransactionError(error);
  });

  const product = await requireInventoryProduct(productId);

  await safelyRecordAuditLog({
    actorId: performedById,
    action: "PRODUCT_VARIANT_UPDATED",
    entityType: "product",
    entityId: productId,
    summary: `Updated a variant for ${product.name}.`,
    metadata: {
      variantId,
      changedFields
    }
  });

  return product;
}

export async function deleteProductVariant(productId: string, variantId: string, performedById?: string) {
  await prisma.$transaction(async (transaction) => {
    const productExists = await lockProductForUpdate(transaction, productId);
    if (!productExists) throw new HttpError(404, "Product not found.");
    const product = await transaction.product.findUnique({
      where: { id: productId },
      select: { stock: true, skuInventoryEnabled: true, variants: { select: { id: true, stock: true } } }
    });
    if (!product) throw new HttpError(404, "Product not found.");
    if (!product.variants.some((variant) => variant.id === variantId)) {
      throw new HttpError(404, "Product variant not found.");
    }
    if (product.skuInventoryEnabled) {
      const linkedCount = await transaction.productSkuVariant.count({ where: { variantId, sku: { isActive: true } } });
      if (linkedCount > 0) {
        throw new HttpError(409, "This option is used by an inventory combination. Rebuild combinations before deleting it.", "SKU_OPTION_VALUE_IN_USE");
      }
    } else {
      if (product.stock !== 0 || product.variants.some((variant) => variant.stock !== 0)) {
        throw new HttpError(
          409,
          "Set the product and all option quantities to zero before deleting an option value.",
          "VARIANT_STRUCTURE_REQUIRES_ZERO_STOCK"
        );
      }
      const activeReservationCount = await transaction.reservationItem.count({
        where: {
          productId,
          reservation: { status: { in: ["PENDING", "CONFIRMED", "READY_FOR_PICKUP"] } }
        }
      });
      if (activeReservationCount > 0) {
        throw new HttpError(
          409,
          "Finish or cancel active reservations for this product before deleting an option value.",
          "VARIANT_STRUCTURE_HAS_ACTIVE_RESERVATIONS"
        );
      }
    }

    await transaction.productVariant.delete({ where: { id: variantId }, select: { id: true } });
  }, INVENTORY_WRITE_TRANSACTION_OPTIONS).catch((error) => {
    throw mapInventoryTransactionError(error);
  });
  const product = await requireInventoryProduct(productId);

  await safelyRecordAuditLog({
    actorId: performedById,
    action: "PRODUCT_VARIANT_DELETED",
    entityType: "product",
    entityId: productId,
    summary: `Deleted a variant from ${product.name}.`,
    metadata: { variantId }
  });

  return product;
}
