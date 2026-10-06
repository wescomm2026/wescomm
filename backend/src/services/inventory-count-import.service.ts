import { Prisma } from "@prisma/client";
import {
  normalizeCatalogName,
  planInventoryImport,
  type CatalogProductSnapshot,
  type InventoryCountDataset,
  type InventoryCountProduct,
  type ProductImportPlan
} from "../domain/inventory-count-import.js";
import { prisma } from "../lib/prisma.js";
import { ACTIVE_INVENTORY_RESERVATION_STATUSES } from "../utils/inventory-reservation.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";
import { restockProduct, updateProductSaleMode } from "./inventory.service.js";
import { invalidateOperationalReadCaches } from "./operational-cache.service.js";
import { reconcileProductSkuInventory, restockProductSkus } from "./sku-inventory.service.js";

const ALIAS_SOURCE = "inventory-count";

export async function loadCatalogSnapshot(): Promise<CatalogProductSnapshot[]> {
  const [products, activeReservations] = await Promise.all([
    prisma.product.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        saleMode: true,
        skuInventoryEnabled: true,
        stock: true,
        imageUrl: true,
        aliases: { select: { normalizedAlias: true } },
        variants: { select: { id: true, optionName: true, optionValue: true } },
        skus: {
          where: { isActive: true },
          select: {
            id: true,
            stock: true,
            optionValues: { select: { variant: { select: { optionName: true, optionValue: true } } } }
          }
        }
      },
      orderBy: { name: "asc" }
    }),
    prisma.reservationItem.groupBy({
      by: ["productId"],
      where: { reservation: { status: { in: [...ACTIVE_INVENTORY_RESERVATION_STATUSES] } } },
      _count: { _all: true }
    })
  ]);
  const activeByProduct = new Map(activeReservations.map((row) => [row.productId, row._count._all]));
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    isActive: product.isActive,
    saleMode: product.saleMode,
    skuInventoryEnabled: product.skuInventoryEnabled,
    stock: product.stock,
    imageUrl: product.imageUrl,
    normalizedAliases: product.aliases.map((alias) => alias.normalizedAlias),
    variants: product.variants,
    activeSkus: product.skus.map((sku) => ({
      id: sku.id,
      stock: sku.stock,
      options: sku.optionValues.map((link) => link.variant)
    })),
    activeReservationCount: activeByProduct.get(product.id) ?? 0
  }));
}

export async function planInventoryCountImport(dataset: InventoryCountDataset) {
  return planInventoryImport(dataset, await loadCatalogSnapshot());
}

async function ensureCategories(dataset: InventoryCountDataset) {
  const idBySlug = new Map<string, string>();
  for (const category of dataset.categories) {
    const existing = await prisma.category.findUnique({ where: { slug: category.slug }, select: { id: true } });
    const row = existing ?? await prisma.category.create({
      data: { name: category.name, slug: category.slug, iconUrl: category.iconUrl ?? null, isActive: true },
      select: { id: true }
    });
    idBySlug.set(category.slug, row.id);
  }
  return idBySlug;
}

async function activeSkuIdsByOption(productId: string) {
  const skus = await prisma.productSku.findMany({
    where: { productId, isActive: true },
    select: { id: true, optionValues: { select: { variant: { select: { optionValue: true } } } } }
  });
  return new Map(skus.map((sku) => [normalizeCatalogName(sku.optionValues[0]?.variant.optionValue ?? ""), sku.id]));
}

async function zeroStock(productId: string, actorId: string, notes: string) {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: {
      saleMode: true,
      skuInventoryEnabled: true,
      variants: { select: { id: true } },
      skus: { where: { isActive: true }, select: { id: true } }
    }
  });
  if (product.skuInventoryEnabled) {
    await restockProductSkus({
      productId,
      mode: "set",
      quantities: product.skus.map((sku) => ({ skuId: sku.id, quantity: 0 })),
      performedById: actorId,
      notes
    });
    return;
  }
  await restockProduct({
    productId,
    mode: "set",
    quantity: 0,
    ...(product.saleMode === "OPTIONS" && product.variants.length
      ? { variantQuantities: product.variants.map((variant) => ({ variantId: variant.id, quantity: 0 })) }
      : {}),
    performedById: actorId,
    notes
  });
}

async function setSizeCounts(productId: string, counts: Array<{ option: string; count: number }>, actorId: string, notes: string) {
  const skuIds = await activeSkuIdsByOption(productId);
  const quantities = Array.from(skuIds.entries()).map(([option, skuId]) => ({
    skuId,
    quantity: counts.find((entry) => normalizeCatalogName(entry.option) === option)?.count ?? 0
  }));
  if (!quantities.some((entry) => entry.quantity > 0)) return;
  // A "set" count records every positive difference as an unverified opening batch.
  await restockProductSkus({ productId, mode: "set", quantities, performedById: actorId, notes });
}

async function applyPlan(
  plan: ProductImportPlan,
  product: InventoryCountProduct,
  context: { dataset: InventoryCountDataset; categoryIdBySlug: Map<string, string>; actorId: string }
) {
  const notes = `${context.dataset.title}: ${product.name}`;
  let productId = plan.matched?.id ?? null;

  for (const step of plan.steps) {
    switch (step.type) {
      case "CREATE": {
        const created = await prisma.product.create({
          data: {
            name: product.name,
            categoryId: context.categoryIdBySlug.get(product.category)!,
            description: product.description ?? null,
            imageUrl: product.imageUrl ?? null,
            price: new Prisma.Decimal(0),
            stock: 0,
            status: "OUT_OF_STOCK",
            saleMode: product.saleMode,
            isActive: true
          },
          select: { id: true }
        });
        productId = created.id;
        break;
      }
      case "RESTORE":
        await prisma.product.update({ where: { id: productId! }, data: { isActive: true, updatedAt: new Date() } });
        break;
      case "RENAME":
        await prisma.product.update({ where: { id: productId! }, data: { name: step.to, updatedAt: new Date() } });
        break;
      case "ZERO_STOCK":
        await zeroStock(productId!, context.actorId, `${notes} — previous recorded stock cleared before the September count.`);
        break;
      case "CHANGE_SALE_MODE":
        await updateProductSaleMode(productId!, step.to, context.actorId);
        break;
      case "SET_SIZES":
        await reconcileProductSkuInventory({
          productId: productId!,
          optionGroups: [{
            key: "count-option",
            optionName: step.optionName,
            values: step.sizes.map((size, index) => ({ key: `count-value-${index}`, optionValue: size.option }))
          }],
          skus: step.sizes.map((_size, index) => ({ optionValueKeys: [`count-value-${index}`], stock: 0 })),
          performedById: context.actorId,
          notes
        });
        await setSizeCounts(productId!, step.sizes, context.actorId, notes);
        break;
      case "SET_SIZE_COUNTS":
        await setSizeCounts(productId!, product.lines.map((line) => ({ option: line.option!, count: line.count })), context.actorId, notes);
        break;
      case "SET_STOCK":
        await restockProduct({ productId: productId!, mode: "set", quantity: step.to, performedById: context.actorId, notes });
        break;
      case "SET_IMAGE":
        await prisma.product.update({ where: { id: productId! }, data: { imageUrl: step.imageUrl, updatedAt: new Date() } });
        break;
      case "ADD_ALIASES":
        await prisma.productAlias.createMany({
          data: step.aliases.map((alias) => ({
            productId: productId!,
            alias,
            normalizedAlias: normalizeCatalogName(alias),
            source: ALIAS_SOURCE,
            sourceVersion: context.dataset.version
          })),
          skipDuplicates: true
        });
        break;
    }
  }
  return productId!;
}

export type InventoryCountImportResult = {
  plans: ProductImportPlan[];
  applied: Array<{ key: string; productId: string }>;
  skipped: Array<{ key: string; reason: string }>;
  failed: Array<{ key: string; error: string }>;
};

/** Applies every unblocked plan. Each product is independent; one failure does not stop the rest. */
export async function applyInventoryCountImport(dataset: InventoryCountDataset, actorId: string): Promise<InventoryCountImportResult> {
  const actor = await prisma.profile.findFirst({ where: { id: actorId, role: { in: ["STAFF", "ADMIN"] } }, select: { id: true } });
  if (!actor) throw new Error("The import actor must be an existing staff or admin account.");

  const categoryIdBySlug = await ensureCategories(dataset);
  const plans = await planInventoryCountImport(dataset);
  const result: InventoryCountImportResult = { plans, applied: [], skipped: [], failed: [] };

  for (const plan of plans) {
    if (plan.blockedReason) {
      result.skipped.push({ key: plan.key, reason: plan.blockedReason });
      continue;
    }
    if (!plan.steps.length) continue;
    const product = dataset.products.find((entry) => entry.key === plan.key)!;
    try {
      const productId = await applyPlan(plan, product, { dataset, categoryIdBySlug, actorId });
      result.applied.push({ key: plan.key, productId });
    } catch (error) {
      result.failed.push({ key: plan.key, error: error instanceof Error ? error.message : String(error) });
    }
  }

  await invalidateOperationalReadCaches();
  await safelyRecordAuditLog({
    actorId,
    action: "INVENTORY_COUNT_IMPORTED",
    entityType: "inventory",
    entityId: null,
    summary: `Imported ${dataset.title}: ${result.applied.length} product(s) updated, ${result.skipped.length} skipped, ${result.failed.length} failed.`,
    metadata: {
      version: dataset.version,
      applied: result.applied.map((entry) => entry.key),
      skipped: result.skipped,
      failed: result.failed
    }
  });
  return result;
}
