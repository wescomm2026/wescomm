import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { canonicalSkuVariantKey, normalizeSkuOptionName } from "../domain/sku-inventory.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { requireNoActiveInventoryReservations } from "../utils/inventory-reservation.js";
import { lockProductForUpdate } from "../utils/product-transaction.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";
import { createNotificationsForRolesBestEffort } from "./notification.service.js";
import { getInventoryProduct, INVENTORY_WRITE_TRANSACTION_OPTIONS } from "./inventory.service.js";
import { createBackInStockNotificationsInTransaction } from "./wishlist-notification.service.js";

export type SkuDefinitionInput = {
  variantIds?: string[];
  optionValueKeys?: string[];
  stock: number;
  lowStockThreshold?: number;
};

export type SkuOptionValueDefinitionInput = {
  key: string;
  id?: string;
  optionValue: string;
  lowStockThreshold?: number;
};

export type SkuOptionGroupDefinitionInput = {
  key: string;
  optionName: string;
  values: SkuOptionValueDefinitionInput[];
};

export type SkuStockQuantityInput = {
  skuId: string;
  quantity: number;
};

function deriveProductStatus(stock: number, lowStockThreshold: number, currentStatus?: string) {
  if (stock <= 0) return "OUT_OF_STOCK" as const;
  if (currentStatus === "ON_SALE") return "ON_SALE" as const;
  if (stock <= lowStockThreshold) return "RESTOCK_SOON" as const;
  return "IN_STOCK" as const;
}

async function syncDerivedVariantStocks(transaction: Prisma.TransactionClient, productId: string) {
  // Recalculate every legacy option total from the active physical SKUs in one SQL statement.
  // The previous implementation updated each variant one-by-one, which made reconciliation
  // slow enough to expire the interactive transaction for multi-attribute products.
  await transaction.$executeRaw`
    UPDATE "product_variants" AS pv
    SET
      "stock" = COALESCE((
        SELECT SUM(ps."stock")::integer
        FROM "product_sku_variants" AS psv
        INNER JOIN "product_skus" AS ps
          ON ps."id" = psv."sku_id"
        WHERE psv."variant_id" = pv."id"
          AND ps."product_id" = ${productId}::uuid
          AND ps."is_active" = true
      ), 0),
      "updated_at" = CURRENT_TIMESTAMP
    WHERE pv."product_id" = ${productId}::uuid
  `;
}

const SKU_RECONCILIATION_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 10_000,
  // Reconciliation is a one-time administrative operation and can contain hundreds
  // of combinations. The writes are batched below, but leave a little more headroom
  // than ordinary inventory updates for remote Supabase connections.
  timeout: 45_000
});

export function requireInventoryInteger(value: number | undefined, fallback: number, label: string, code: string) {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > 10_000_000) {
    throw new HttpError(400, `${label} must be a whole number from 0 to 10,000,000.`, code);
  }
  return normalized;
}

export async function reconcileProductSkuInventory(input: {
  productId: string;
  skus: SkuDefinitionInput[];
  optionGroups?: SkuOptionGroupDefinitionInput[];
  performedById: string;
  notes?: string;
}) {
  if (!input.skus.length) {
    throw new HttpError(400, "Add at least one inventory combination before saving.", "SKU_COMBINATION_REQUIRED");
  }

  const result = await prisma.$transaction(async (transaction) => {
    const locked = await lockProductForUpdate(transaction, input.productId);
    if (!locked) throw new HttpError(404, "Product not found.");

    const product = await transaction.product.findUnique({
      where: { id: input.productId },
      select: {
        id: true,
        name: true,
        stock: true,
        status: true,
        lowStockThreshold: true,
        isActive: true,
        saleMode: true,
        variants: {
          select: { id: true, optionName: true, optionValue: true, lowStockThreshold: true },
          orderBy: [{ optionName: "asc" }, { optionValue: "asc" }]
        }
      }
    });
    if (!product) throw new HttpError(404, "Product not found.");
    if (product.saleMode !== "OPTIONS") {
      throw new HttpError(409, "This product is not sold with selectable sizes/options.", "SALE_MODE_OPTIONS_REQUIRED");
    }
    await requireNoActiveInventoryReservations(transaction, input.productId, {
      message: "Complete or cancel active reservations for this product before rebuilding its inventory combinations.",
      code: "SKU_RECONCILIATION_HAS_ACTIVE_RESERVATIONS"
    });

    const existingVariantById = new Map(product.variants.map((variant) => [variant.id, variant]));
    const variantIdByValueKey = new Map<string, string>();
    const finalVariants: Array<{
      id: string;
      optionName: string;
      optionValue: string;
      lowStockThreshold: number;
      existed: boolean;
    }> = [];

    if (input.optionGroups !== undefined) {
      if (input.optionGroups.length === 0) {
        throw new HttpError(400, "Add at least one option group before saving inventory combinations.", "SKU_OPTION_GROUP_REQUIRED");
      }

      const seenGroupKeys = new Set<string>();
      const seenGroupNames = new Set<string>();
      const seenValueKeys = new Set<string>();
      const seenVariantIds = new Set<string>();

      input.optionGroups.forEach((group, groupIndex) => {
        const groupKey = group.key.trim();
        const optionName = group.optionName.trim();
        const normalizedGroupName = normalizeSkuOptionName(optionName);
        if (!groupKey || seenGroupKeys.has(groupKey)) {
          throw new HttpError(400, `Option group ${groupIndex + 1} has a missing or duplicated key.`, "SKU_DUPLICATE_OPTION_GROUP_KEY");
        }
        if (!optionName || seenGroupNames.has(normalizedGroupName)) {
          throw new HttpError(400, `Option group ${groupIndex + 1} has a missing or duplicated name.`, "SKU_DUPLICATE_OPTION_GROUP_NAME");
        }
        if (group.values.length === 0) {
          throw new HttpError(400, `${optionName} needs at least one option value.`, "SKU_OPTION_VALUE_REQUIRED");
        }
        seenGroupKeys.add(groupKey);
        seenGroupNames.add(normalizedGroupName);

        const seenLabels = new Set<string>();
        group.values.forEach((value, valueIndex) => {
          const valueKey = value.key.trim();
          const optionValue = value.optionValue.trim();
          const normalizedValue = normalizeSkuOptionName(optionValue);
          if (!valueKey || seenValueKeys.has(valueKey)) {
            throw new HttpError(400, `${optionName} value ${valueIndex + 1} has a missing or duplicated key.`, "SKU_DUPLICATE_OPTION_VALUE_KEY");
          }
          if (!optionValue || seenLabels.has(normalizedValue)) {
            throw new HttpError(400, `${optionName} has a missing or duplicated option value.`, "SKU_DUPLICATE_OPTION_VALUE");
          }
          if (value.id && (!existingVariantById.has(value.id) || seenVariantIds.has(value.id))) {
            throw new HttpError(400, "One of the existing option values is invalid or duplicated.", "SKU_UNKNOWN_OPTION_VALUE");
          }

          const id = value.id ?? randomUUID();
          const lowStockThreshold = requireInventoryInteger(
            value.lowStockThreshold,
            2,
            `${optionName}: ${optionValue} alert level`,
            "SKU_INVALID_OPTION_THRESHOLD"
          );
          finalVariants.push({
            id,
            optionName,
            optionValue,
            lowStockThreshold,
            existed: Boolean(value.id)
          });
          variantIdByValueKey.set(valueKey, id);
          seenValueKeys.add(valueKey);
          seenLabels.add(normalizedValue);
          if (value.id) seenVariantIds.add(value.id);
        });
      });
    } else {
      for (const variant of product.variants) {
        finalVariants.push({
          id: variant.id,
          optionName: variant.optionName,
          optionValue: variant.optionValue,
          lowStockThreshold: variant.lowStockThreshold,
          existed: true
        });
      }
    }

    if (finalVariants.length === 0) {
      throw new HttpError(409, "Add at least one product option before setting up inventory combinations.", "SKU_OPTIONS_REQUIRED");
    }

    const finalVariantById = new Map(finalVariants.map((variant) => [variant.id, variant]));
    const optionGroups = new Map<string, typeof finalVariants>();
    for (const variant of finalVariants) {
      const key = normalizeSkuOptionName(variant.optionName);
      const group = optionGroups.get(key) ?? [];
      group.push(variant);
      optionGroups.set(key, group);
    }

    const seenCombinations = new Set<string>();
    const normalizedSkus = input.skus.map((sku, index) => {
      const hasVariantIds = sku.variantIds !== undefined;
      const hasValueKeys = sku.optionValueKeys !== undefined;
      if (hasVariantIds === hasValueKeys) {
        throw new HttpError(400, `Combination ${index + 1} must use exactly one option reference format.`, "SKU_OPTION_REFERENCE_REQUIRED");
      }
      const requestedIds = hasValueKeys
        ? sku.optionValueKeys!.map((key) => {
            const variantId = variantIdByValueKey.get(key.trim());
            if (!variantId) throw new HttpError(400, "One of the selected option values is no longer available.", "SKU_UNKNOWN_OPTION_VALUE_KEY");
            return variantId;
          })
        : sku.variantIds!;
      const variantIds = Array.from(new Set(requestedIds));
      if (variantIds.length !== requestedIds.length) {
        throw new HttpError(400, `Combination ${index + 1} contains the same option value more than once.`, "SKU_DUPLICATE_OPTION_VALUE");
      }
      const unknownId = variantIds.find((variantId) => !finalVariantById.has(variantId));
      if (unknownId) throw new HttpError(400, "One of the selected option values does not belong to this product.", "SKU_UNKNOWN_OPTION_VALUE");

      if (optionGroups.size === 0 && variantIds.length !== 0) {
        throw new HttpError(400, "This product has no option values.", "SKU_UNEXPECTED_OPTION_VALUE");
      }

      if (optionGroups.size > 0) {
        if (variantIds.length !== optionGroups.size) {
          throw new HttpError(
            400,
            `Combination ${index + 1} must choose exactly one value from every option group.`,
            "SKU_INCOMPLETE_COMBINATION"
          );
        }
        const selectedGroupKeys = new Set(variantIds.map((variantId) => normalizeSkuOptionName(finalVariantById.get(variantId)!.optionName)));
        if (selectedGroupKeys.size !== optionGroups.size) {
          throw new HttpError(
            400,
            `Combination ${index + 1} must choose one value from each option group.`,
            "SKU_DUPLICATE_OPTION_GROUP"
          );
        }
      } else if (input.skus.length !== 1) {
        throw new HttpError(400, "A product without options can only have one stock combination.", "SKU_DEFAULT_COMBINATION_ONLY");
      }

      const stock = requireInventoryInteger(sku.stock, 0, `Combination ${index + 1} stock`, "SKU_INVALID_STOCK");
      const lowStockThreshold = requireInventoryInteger(
        sku.lowStockThreshold,
        2,
        `Combination ${index + 1} alert level`,
        "SKU_INVALID_THRESHOLD"
      );
      const combinationKey = canonicalSkuVariantKey(variantIds);
      if (seenCombinations.has(combinationKey)) {
        throw new HttpError(400, `Combination ${index + 1} is duplicated.`, "SKU_DUPLICATE_COMBINATION");
      }
      seenCombinations.add(combinationKey);
      return { variantIds, stock, lowStockThreshold };
    });

    const previousStock = product.stock;
    // Retire previous definitions instead of deleting them so completed reservation and
    // inventory-movement references remain auditable. Active reservations are blocked above.
    await transaction.productSku.updateMany({
      where: { productId: input.productId, isActive: true },
      data: { isActive: false, updatedAt: new Date() }
    });

    const finalExistingVariants = finalVariants.filter((variant) => variant.existed);
    const finalExistingIds = new Set(finalExistingVariants.map((variant) => variant.id));
    const removedVariantIds = product.variants
      .filter((variant) => !finalExistingIds.has(variant.id))
      .map((variant) => variant.id);
    const structureChanged = input.optionGroups !== undefined && (
      finalVariants.length !== product.variants.length
      || finalVariants.some((variant) => {
        const current = existingVariantById.get(variant.id);
        return !current
          || current.optionName !== variant.optionName
          || current.optionValue !== variant.optionValue
          || current.lowStockThreshold !== variant.lowStockThreshold;
      })
    );

    if (structureChanged) {
      if (finalExistingVariants.length) {
        const retainedIds = finalExistingVariants.map((variant) => Prisma.sql`${variant.id}::uuid`);
        await transaction.$executeRaw`
          UPDATE "product_variants"
          SET
            "option_name" = '__wescomm_rebuild_group_' || REPLACE("id"::text, '-', ''),
            "option_value" = '__wescomm_rebuild_value_' || REPLACE("id"::text, '-', ''),
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "product_id" = ${input.productId}::uuid
            AND "id" IN (${Prisma.join(retainedIds)})
        `;
      }

      if (removedVariantIds.length) {
        await transaction.productVariant.deleteMany({
          where: { productId: input.productId, id: { in: removedVariantIds } }
        });
      }

      if (finalExistingVariants.length) {
        const updateRows = finalExistingVariants.map((variant) => Prisma.sql`
          (${variant.id}::uuid, ${variant.optionName}::text, ${variant.optionValue}::text, ${variant.lowStockThreshold}::integer)
        `);
        await transaction.$executeRaw`
          UPDATE "product_variants" AS pv
          SET
            "option_name" = next."option_name",
            "option_value" = next."option_value",
            "low_stock_threshold" = next."low_stock_threshold",
            "updated_at" = CURRENT_TIMESTAMP
          FROM (VALUES ${Prisma.join(updateRows)}) AS next("id", "option_name", "option_value", "low_stock_threshold")
          WHERE pv."product_id" = ${input.productId}::uuid
            AND pv."id" = next."id"
        `;
      }

      const newVariants = finalVariants.filter((variant) => !variant.existed);
      if (newVariants.length) {
        await transaction.productVariant.createMany({
          data: newVariants.map((variant) => ({
            id: variant.id,
            productId: input.productId,
            optionName: variant.optionName,
            optionValue: variant.optionValue,
            stock: 0,
            lowStockThreshold: variant.lowStockThreshold
          }))
        });
      }
    }

    const skuRows = normalizedSkus.map((sku) => {
      const id = randomUUID();
      return {
        id,
        productId: input.productId,
        code: `SKU-${randomUUID().slice(0, 8).toUpperCase()}`,
        stock: sku.stock,
        lowStockThreshold: sku.lowStockThreshold,
        isActive: true,
        optionSnapshot: sku.variantIds.map((variantId) => {
          const variant = finalVariantById.get(variantId)!;
          return { variantId, optionName: variant.optionName, optionValue: variant.optionValue };
        }),
        variantIds: sku.variantIds
      };
    });

    // Batch the SKU rows and their option links instead of issuing one nested INSERT per
    // combination. A Size × Waist × Length product can easily have dozens of combinations.
    await transaction.productSku.createMany({
      data: skuRows.map(({ variantIds: _variantIds, ...sku }) => sku)
    });

    const skuVariantLinks = skuRows.flatMap((sku) =>
      sku.variantIds.map((variantId) => ({ skuId: sku.id, variantId }))
    );
    if (skuVariantLinks.length) {
      await transaction.productSkuVariant.createMany({ data: skuVariantLinks });
    }

    const totalStock = normalizedSkus.reduce((total, sku) => total + sku.stock, 0);
    const status = deriveProductStatus(totalStock, product.lowStockThreshold, product.status);
    await transaction.product.update({
      where: { id: input.productId },
      data: {
        stock: totalStock,
        status,
        skuInventoryEnabled: true,
        inventoryReconciledAt: new Date(),
        updatedAt: new Date()
      },
      select: { id: true }
    });

    await syncDerivedVariantStocks(transaction, input.productId);

    await transaction.inventoryMovement.create({
      data: {
        productId: input.productId,
        type: "ADJUSTMENT",
        quantity: totalStock - previousStock,
        previousStock,
        newStock: totalStock,
        performedById: input.performedById,
        notes: input.notes ?? "Reconciled physical inventory into SKU combinations."
      },
      select: { id: true }
    });

    // Reconciliation reclassifies existing physical stock; it is not a new
    // delivery. Do not emit a back-in-stock notification here because that
    // could tell students an already-available product was newly restocked.

    return {
      productName: product.name,
      previousStock,
      totalStock,
      combinationCount: normalizedSkus.length,
      optionGroupCount: optionGroups.size,
      structureChanged
    };
  }, SKU_RECONCILIATION_TRANSACTION_OPTIONS).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
      throw new HttpError(
        503,
        "Inventory setup took too long to complete. No partial inventory changes were saved; please retry once.",
        "SKU_RECONCILIATION_TIMEOUT"
      );
    }
    throw error;
  });

  const product = await getInventoryProduct(input.productId);
  if (!product) throw new HttpError(404, "Product not found.");

  await safelyRecordAuditLog({
    actorId: input.performedById,
    action: "PRODUCT_SKU_INVENTORY_RECONCILED",
    entityType: "product",
    entityId: input.productId,
    summary: `Reconciled SKU inventory for ${result.productName}.`,
    metadata: {
      previousStock: result.previousStock,
      newStock: result.totalStock,
      combinationCount: result.combinationCount,
      optionGroupCount: result.optionGroupCount,
      structureChanged: result.structureChanged
    }
  });

  return product;
}

export async function restockProductSkus(input: {
  productId: string;
  mode: "add" | "set";
  quantities: SkuStockQuantityInput[];
  performedById: string;
  notes?: string;
}) {
  const result = await prisma.$transaction(async (transaction) => {
    const locked = await lockProductForUpdate(transaction, input.productId);
    if (!locked) throw new HttpError(404, "Product not found.");

    const product = await transaction.product.findUnique({
      where: { id: input.productId },
      select: {
        id: true,
        name: true,
        stock: true,
        status: true,
        lowStockThreshold: true,
        saleMode: true,
        skuInventoryEnabled: true,
        isActive: true,
        skus: {
          where: { isActive: true },
          select: {
            id: true,
            stock: true,
            lowStockThreshold: true,
            optionValues: { select: { variant: { select: { optionName: true, optionValue: true } } } }
          }
        }
      }
    });
    if (!product) throw new HttpError(404, "Product not found.");
    if (product.saleMode !== "OPTIONS") {
      throw new HttpError(409, "This product is not sold with selectable sizes/options.", "SALE_MODE_OPTIONS_REQUIRED");
    }
    if (!product.skuInventoryEnabled) {
      throw new HttpError(409, "Set up inventory combinations before updating stock.", "SKU_RECONCILIATION_REQUIRED");
    }
    if (input.mode === "set") {
      // The current stock field represents stock still available for new reservations.
      // Recounting it while holds exist can accidentally make reserved pieces available again.
      await requireNoActiveInventoryReservations(transaction, input.productId, {
        message: "Complete or cancel active reservations for this product before correcting its available inventory.",
        code: "SKU_EXACT_COUNT_HAS_ACTIVE_RESERVATIONS"
      });
    }

    const requestedById = new Map(input.quantities.map((entry, index) => [
      entry.skuId,
      requireInventoryInteger(entry.quantity, 0, `Combination ${index + 1} quantity`, "SKU_INVALID_QUANTITY")
    ]));
    if (requestedById.size !== input.quantities.length) {
      throw new HttpError(400, "Each inventory combination may be entered only once.", "SKU_DUPLICATE_QUANTITY");
    }
    const knownIds = new Set(product.skus.map((sku) => sku.id));
    if (input.quantities.some((entry) => !knownIds.has(entry.skuId))) {
      throw new HttpError(400, "One of the selected inventory combinations is no longer available.", "SKU_UNKNOWN_COMBINATION");
    }
    if (input.mode === "set" && requestedById.size !== product.skus.length) {
      throw new HttpError(400, "Enter the exact count for every inventory combination.", "SKU_EXACT_COUNT_REQUIRED");
    }

    const previousProductStock = product.stock;
    const changes: Array<{
      skuId: string;
      previousStock: number;
      newStock: number;
      lowStockThreshold: number;
      label: string;
    }> = [];

    for (const sku of product.skus) {
      const entered = requestedById.get(sku.id);
      const newStock = input.mode === "set"
        ? (entered ?? sku.stock)
        : sku.stock + (entered ?? 0);
      if (newStock === sku.stock) continue;
      const label = sku.optionValues.length
        ? sku.optionValues.map((link) => `${link.variant.optionName}: ${link.variant.optionValue}`).join(" / ")
        : "Standard item";
      changes.push({ skuId: sku.id, previousStock: sku.stock, newStock, lowStockThreshold: sku.lowStockThreshold, label });
    }

    if (changes.length) {
      const stockRows = changes.map((change) => Prisma.sql`
        (${change.skuId}::uuid, ${change.newStock}::integer)
      `);
      await transaction.$executeRaw`
        UPDATE "product_skus" AS ps
        SET
          "stock" = next."stock",
          "updated_at" = CURRENT_TIMESTAMP
        FROM (VALUES ${Prisma.join(stockRows)}) AS next("id", "stock")
        WHERE ps."product_id" = ${input.productId}::uuid
          AND ps."is_active" = true
          AND ps."id" = next."id"
      `;
      await transaction.inventoryMovement.createMany({
        data: changes.map((change) => ({
          productId: input.productId,
          skuId: change.skuId,
          type: change.newStock >= change.previousStock ? "RESTOCK" : "ADJUSTMENT",
          quantity: change.newStock - change.previousStock,
          previousStock: change.previousStock,
          newStock: change.newStock,
          performedById: input.performedById,
          notes: input.notes ?? `${input.mode === "set" ? "Corrected" : "Updated"} ${change.label} stock.`
        }))
      });
    }

    const nextStockBySkuId = new Map(changes.map((change) => [change.skuId, change.newStock]));
    const nextSkuStocks = product.skus.map((sku) => nextStockBySkuId.get(sku.id) ?? sku.stock);
    const totalStock = nextSkuStocks.reduce((total, stock) => total + stock, 0);
    const status = deriveProductStatus(totalStock, product.lowStockThreshold, product.status);
    await transaction.product.update({
      where: { id: input.productId },
      data: { stock: totalStock, status, updatedAt: new Date() },
      select: { id: true }
    });
    await syncDerivedVariantStocks(transaction, input.productId);

    let productMovementId: string | undefined;
    if (totalStock !== previousProductStock) {
      const movement = await transaction.inventoryMovement.create({
        data: {
          productId: input.productId,
          type: totalStock >= previousProductStock ? "RESTOCK" : "ADJUSTMENT",
          quantity: totalStock - previousProductStock,
          previousStock: previousProductStock,
          newStock: totalStock,
          performedById: input.performedById,
          notes: input.notes ?? "SKU stock total updated."
        },
        select: { id: true }
      });
      productMovementId = movement.id;
    }

    await createBackInStockNotificationsInTransaction(transaction, {
      productId: input.productId,
      productName: product.name,
      previous: {
        stock: previousProductStock,
        status: product.status,
        isActive: product.isActive,
        optionGroupsAvailable: product.skus.some((sku) => sku.stock > 0)
      },
      next: {
        stock: totalStock,
        status,
        isActive: product.isActive,
        optionGroupsAvailable: nextSkuStocks.some((stock) => stock > 0)
      },
      eventId: productMovementId
    });

    return { productName: product.name, previousProductStock, totalStock, changes };
  }, INVENTORY_WRITE_TRANSACTION_OPTIONS);

  for (const change of result.changes) {
    if (change.newStock <= change.lowStockThreshold && change.previousStock > change.lowStockThreshold) {
      await createNotificationsForRolesBestEffort(["STAFF", "ADMIN"], {
        title: `Low stock: ${result.productName}`,
        message: `${change.label} has only ${change.newStock} item${change.newStock === 1 ? "" : "s"} left.`,
        type: "LOW_STOCK",
        actionUrl: `/staff/inventory?productId=${input.productId}`,
        dedupeKey: `sku-low-stock:${change.skuId}:${change.newStock}`
      });
    }
  }

  const product = await getInventoryProduct(input.productId);
  if (!product) throw new HttpError(404, "Product not found.");

  await safelyRecordAuditLog({
    actorId: input.performedById,
    action: input.mode === "set" ? "PRODUCT_SKU_STOCK_SET" : "PRODUCT_SKU_RESTOCKED",
    entityType: "product",
    entityId: input.productId,
    summary: `${input.mode === "set" ? "Corrected" : "Restocked"} SKU inventory for ${result.productName}.`,
    metadata: {
      previousStock: result.previousProductStock,
      newStock: result.totalStock,
      changes: result.changes
    }
  });

  return product;
}
