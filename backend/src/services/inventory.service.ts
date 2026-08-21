import { Prisma } from "@prisma/client";
import { supabaseAdmin } from "../lib/supabase.js";
import { prisma } from "../lib/prisma.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";
import { createNotificationsForRoles } from "./notification.service.js";
import { createBackInStockNotificationsInTransaction } from "./wishlist-notification.service.js";
import { firstRow, type ProductStatus } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import { lockProductForUpdate } from "../utils/product-transaction.js";
import { createPage, decodeCursor, normalizePageLimit } from "../utils/cursor-pagination.js";

type RawCategory = {
  id: string;
  name: string;
  slug: string;
  icon_url: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

type RawInventoryProduct = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: string | number;
  old_price: string | number | null;
  status: ProductStatus;
  stock: number;
  low_stock_threshold: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  category: RawCategory | RawCategory[] | null;
  variants:
    | Array<{
        id: string;
        option_name: string;
        option_value: string;
        stock: number;
      }>
    | null;
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
};

export type ProductCreateInput = CategoryInput & {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price: number;
  oldPrice?: number | null;
  status?: ProductStatus;
  stock?: number;
  lowStockThreshold?: number;
  variants?: ProductVariantInput[];
  notes?: string;
};

export type ProductUpdateInput = Partial<Omit<ProductCreateInput, "variants">> & {
  isActive?: boolean;
};

const inventorySelect = `
  id,
  category_id,
  name,
  description,
  image_url,
  price,
  old_price,
  status,
  stock,
  low_stock_threshold,
  is_active,
  created_at,
  updated_at,
  category:categories(id,name,slug,icon_url,is_active,created_at,updated_at),
  variants:product_variants(id,option_name,option_value,stock)
`;

const inventoryRecordSelect = Prisma.validator<Prisma.ProductSelect>()({
  id: true,
  categoryId: true,
  name: true,
  description: true,
  imageUrl: true,
  price: true,
  oldPrice: true,
  status: true,
  stock: true,
  lowStockThreshold: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: { id: true, name: true, slug: true, iconUrl: true }
  },
  variants: {
    select: { id: true, optionName: true, optionValue: true, stock: true },
    orderBy: [{ optionName: "asc" }, { optionValue: "asc" }]
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

function mapInventoryProduct(row: RawInventoryProduct) {
  const category = firstRow(row.category);

  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    price: row.price,
    oldPrice: row.old_price,
    status: row.status,
    stock: row.stock,
    lowStockThreshold: row.low_stock_threshold,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    category: category ? mapCategory(category) : null,
    variants: (row.variants ?? []).map((variant) => ({
      id: variant.id,
      optionName: variant.option_name,
      optionValue: variant.option_value,
      stock: variant.stock
    }))
  };
}

function mapInventoryRecord(row: InventoryRecord) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl,
    price: row.price,
    oldPrice: row.oldPrice,
    status: row.status,
    stock: row.stock,
    lowStockThreshold: row.lowStockThreshold,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    category: row.category,
    variants: row.variants
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

async function requireProductVariant(productId: string, variantId: string) {
  const { data, error } = await supabaseAdmin
    .from("product_variants")
    .select("id")
    .eq("id", variantId)
    .eq("product_id", productId)
    .maybeSingle();

  if (error) throw HttpError.fromSupabase(error);
  if (!data) throw new HttpError(404, "Product variant not found.");
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
      isActive: true,
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
    orderBy: [{ name: "asc" }, { id: "asc" }],
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    take: limit + 1
  });

  return createPage(rows.map(mapInventoryRecord), limit);
}

export async function getInventoryProduct(productId: string) {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select(inventorySelect)
    .eq("id", productId)
    .maybeSingle();

  if (error) throw HttpError.fromSupabase(error);
  return data ? mapInventoryProduct(data as unknown as RawInventoryProduct) : null;
}

export async function createProduct(input: ProductCreateInput, performedById: string) {
  const category = await resolveCategory(input);
  await assertUniqueActiveProductName(input.name);

  const stock = input.stock ?? 0;
  const lowStockThreshold = input.lowStockThreshold ?? 10;
  const status = input.status ?? deriveProductStatus(stock, lowStockThreshold);

  const { data, error } = await supabaseAdmin
    .from("products")
    .insert({
      category_id: category.id,
      name: input.name.trim(),
      description: input.description ?? null,
      image_url: input.imageUrl ?? null,
      price: input.price,
      old_price: input.oldPrice ?? null,
      status,
      stock,
      low_stock_threshold: lowStockThreshold,
      is_active: true
    })
    .select(inventorySelect)
    .single();

  if (error) {
    if (error.code === "23505") throw new HttpError(409, "A product with this name already exists.");
    throw HttpError.fromSupabase(error);
  }

  const product = mapInventoryProduct(data as unknown as RawInventoryProduct);

  if (input.variants?.length) {
    const { error: variantError } = await supabaseAdmin.from("product_variants").insert(
      input.variants.map((variant) => ({
        product_id: product.id,
        option_name: variant.optionName.trim(),
        option_value: variant.optionValue.trim(),
        stock: variant.stock ?? 0
      }))
    );

    if (variantError) throw HttpError.fromSupabase(variantError);
  }

  await recordInventoryMovement({
    productId: product.id,
    type: "RESTOCK",
    quantity: stock,
    previousStock: 0,
    newStock: stock,
    performedById,
    notes: input.notes ?? "Initial product stock."
  });

  await notifyLowStockIfNeeded({
    productId: product.id,
    productName: product.name,
    previousStock: Number.POSITIVE_INFINITY,
    newStock: stock,
    lowStockThreshold
  });

  const createdProduct = await requireInventoryProduct(product.id);

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

  const hasProductChanges = Boolean(
    categoryId ||
    input.name !== undefined ||
    input.description !== undefined ||
    input.imageUrl !== undefined ||
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
          isActive: true
        }
      });
      if (!current) throw new HttpError(404, "Product not found.");

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

export async function archiveProduct(productId: string, performedById: string) {
  const current = await requireInventoryProduct(productId);

  const { data, error } = await supabaseAdmin
    .from("products")
    .update({
      is_active: false,
      updated_at: new Date().toISOString()
    })
    .eq("id", productId)
    .select(inventorySelect)
    .single();

  if (error) throw HttpError.fromSupabase(error);

  await recordInventoryMovement({
    productId,
    type: "ADJUSTMENT",
    quantity: 0,
    previousStock: current.stock,
    newStock: current.stock,
    performedById,
    notes: "Product archived."
  });

  const archivedProduct = mapInventoryProduct(data as unknown as RawInventoryProduct);

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

export async function restockProduct(input: {
  productId: string;
  quantity: number;
  mode?: "add" | "set";
  performedById: string;
  notes?: string;
}) {
  const mode = input.mode ?? "add";
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
          isActive: true
        }
      });
      if (!product) throw new HttpError(404, "Product not found.");

      const newStock = mode === "set" ? input.quantity : product.stock + input.quantity;
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

      await createBackInStockNotificationsInTransaction(
        transaction,
        {
          productId: input.productId,
          productName: updated.name,
          previous: product,
          next: updated,
          eventId: inventoryMovementId
        }
      );

      return { product, updated, difference };
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
      notes: input.notes ?? null
    }
  });

  return updatedProduct;
}

export async function createProductVariant(productId: string, input: ProductVariantInput, performedById?: string) {
  await requireInventoryProduct(productId);

  const { error } = await supabaseAdmin.from("product_variants").insert({
    product_id: productId,
    option_name: input.optionName.trim(),
    option_value: input.optionValue.trim(),
    stock: input.stock ?? 0
  });

  if (error) {
    if (error.code === "23505") throw new HttpError(409, "This product variant already exists.");
    throw HttpError.fromSupabase(error);
  }

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
  await requireInventoryProduct(productId);
  await requireProductVariant(productId, variantId);

  const updates: Record<string, unknown> = {};
  if (input.optionName !== undefined) updates.option_name = input.optionName.trim();
  if (input.optionValue !== undefined) updates.option_value = input.optionValue.trim();
  if (input.stock !== undefined) updates.stock = input.stock;

  if (Object.keys(updates).length) {
    updates.updated_at = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("product_variants")
      .update(updates)
      .eq("id", variantId)
      .eq("product_id", productId);

    if (error) {
      if (error.code === "23505") throw new HttpError(409, "This product variant already exists.");
      throw HttpError.fromSupabase(error);
    }
  }

  const product = await requireInventoryProduct(productId);

  await safelyRecordAuditLog({
    actorId: performedById,
    action: "PRODUCT_VARIANT_UPDATED",
    entityType: "product",
    entityId: productId,
    summary: `Updated a variant for ${product.name}.`,
    metadata: {
      variantId,
      changedFields: Object.keys(updates).filter((field) => field !== "updated_at")
    }
  });

  return product;
}

export async function deleteProductVariant(productId: string, variantId: string, performedById?: string) {
  await requireInventoryProduct(productId);
  await requireProductVariant(productId, variantId);

  const { error } = await supabaseAdmin
    .from("product_variants")
    .delete()
    .eq("id", variantId)
    .eq("product_id", productId);

  if (error) throw HttpError.fromSupabase(error);
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
