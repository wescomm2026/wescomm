import {
  Prisma,
  type ProductStatus as PrismaProductStatus
} from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { type ProductStatus } from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import { createPage, decodeCursor, normalizePageLimit } from "../utils/cursor-pagination.js";
import { lockProductForUpdate } from "../utils/product-transaction.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";
import {
  allocateWalkInSaleCostsInTransaction,
  reverseWalkInSaleCostAllocationsInTransaction
} from "./inventory-cost.service.js";
import { INVENTORY_WRITE_TRANSACTION_OPTIONS, deriveProductStatus } from "./inventory.service.js";
import { createNotificationBestEffort, createNotificationsForRolesBestEffort } from "./notification.service.js";
import { OUTBOX_EVENT_TYPES } from "./outbox.service.js";
import { createPublicVerificationToken, createReceiptCode, createVerificationHash } from "./receipt.service.js";
import { publishRealtimeEvents, REALTIME_TOPICS } from "./realtime-event.service.js";

export type WalkInSaleItemInput = {
  productId: string;
  skuId?: string;
  variantId?: string;
  quantity: number;
};

export type WalkInSaleInput = {
  items: WalkInSaleItemInput[];
  studentId: string;
  receiptCode?: string | null;
  cashReceived: number;
  clientSaleId: string;
  performedById: string;
};

type OptionSnapshotEntry = { optionName: string; optionValue: string };

const walkInSaleItemSelect = {
  id: true,
  productId: true,
  skuId: true,
  variantId: true,
  productNameSnapshot: true,
  optionSnapshot: true,
  quantity: true,
  unitPrice: true,
  subtotal: true
} satisfies Prisma.WalkInSaleItemSelect;

const walkInReceiptSelect = Prisma.validator<Prisma.ReceiptSelect>()({
  id: true,
  receiptCode: true,
  studentId: true,
  reservationId: true,
  totalAmount: true,
  paymentMethod: true,
  status: true,
  issuedAt: true,
  verifiedAt: true,
  voidedAt: true,
  createdAt: true,
  updatedAt: true,
  student: { select: { id: true, fullName: true, email: true, studentNumber: true } },
  issuedBy: { select: { id: true, fullName: true } },
  walkInSale: {
    select: {
      cashTendered: true,
      changeDue: true,
      cashierId: true,
      cashierNameSnapshot: true,
      clientSaleId: true,
      voidedById: true,
      voidReason: true,
      voidedAt: true
    }
  },
  walkInSaleItems: {
    select: walkInSaleItemSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  }
});

type WalkInReceiptRecord = Prisma.ReceiptGetPayload<{ select: typeof walkInReceiptSelect }>;

function roundToCentavos(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function mapWalkInReceipt(row: WalkInReceiptRecord) {
  return {
    id: row.id,
    receiptCode: row.receiptCode,
    studentId: row.studentId,
    totalAmount: row.totalAmount.toString(),
    paymentMethod: row.paymentMethod,
    status: row.status,
    issuedAt: row.issuedAt.toISOString(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    student: {
      id: row.student.id,
      fullName: row.student.fullName,
      email: row.student.email,
      studentNumber: row.student.studentNumber
    },
    issuedBy: row.issuedBy
      ? { id: row.issuedBy.id, fullName: row.issuedBy.fullName }
      : null,
    sale: row.walkInSale
      ? {
          cashTendered: row.walkInSale.cashTendered.toString(),
          changeDue: row.walkInSale.changeDue.toString(),
          cashierId: row.walkInSale.cashierId,
          cashierName: row.walkInSale.cashierNameSnapshot,
          clientSaleId: row.walkInSale.clientSaleId,
          voidedById: row.walkInSale.voidedById,
          voidReason: row.walkInSale.voidReason,
          voidedAt: row.walkInSale.voidedAt?.toISOString() ?? null
        }
      : null,
    items: row.walkInSaleItems.map((item) => ({
      id: item.id,
      productId: item.productId,
      skuId: item.skuId,
      variantId: item.variantId,
      productName: item.productNameSnapshot,
      options: (item.optionSnapshot as OptionSnapshotEntry[] | null) ?? [],
      quantity: item.quantity,
      unitPrice: item.unitPrice.toString(),
      subtotal: item.subtotal.toString()
    }))
  };
}

export type WalkInReceipt = ReturnType<typeof mapWalkInReceipt>;

function mapTransactionError(error: unknown) {
  if (error instanceof HttpError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return new HttpError(409, "This receipt code has already been used.", "RECEIPT_CODE_TAKEN", { retryable: false });
    }
    if (error.code === "P2034") {
      return new HttpError(409, "Inventory changed while processing. Please try again.", "INVENTORY_WRITE_CONFLICT", { retryable: true });
    }
    if (error.code === "P2024" || error.code === "P2028") {
      return new HttpError(503, "Inventory is temporarily unavailable. Please try again.", "INVENTORY_TRANSACTION_UNAVAILABLE", { retryable: true });
    }
  }
  return error;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function sumTotals(items: Array<{ subtotal: Prisma.Decimal }>) {
  return roundToCentavos(items.reduce((total, item) => total + Number(item.subtotal), 0));
}

function normalizeSaleItems(items: WalkInSaleItemInput[]) {
  const grouped = new Map<string, WalkInSaleItemInput>();
  for (const item of items) {
    const skuId = item.skuId || undefined;
    const variantId = item.variantId || undefined;
    const key = `${item.productId}:${skuId ?? ""}:${variantId ?? ""}`;
    const existing = grouped.get(key);
    if (existing) existing.quantity += item.quantity;
    else grouped.set(key, { productId: item.productId, skuId, variantId, quantity: item.quantity });
  }
  return Array.from(grouped.values()).sort((left, right) => (
    left.productId.localeCompare(right.productId)
    || (left.skuId ?? "").localeCompare(right.skuId ?? "")
    || (left.variantId ?? "").localeCompare(right.variantId ?? "")
  ));
}

function saleRequestFingerprint(input: WalkInSaleInput, items: WalkInSaleItemInput[]) {
  const cashReceived = Number.isFinite(input.cashReceived)
    ? roundToCentavos(input.cashReceived).toFixed(2)
    : String(input.cashReceived);
  return createHash("sha256").update(JSON.stringify({
    studentId: input.studentId,
    receiptCode: input.receiptCode?.trim().toUpperCase() || null,
    cashReceived,
    items
  })).digest("hex");
}

async function replayExistingSale(
  clientSaleId: string,
  performedById: string,
  requestFingerprint: string
) {
  const sale = await prisma.walkInSale.findUnique({
    where: { clientSaleId },
    select: { receiptId: true, cashierId: true, requestFingerprint: true }
  });
  if (!sale) return null;
  if (sale.cashierId !== performedById) {
    throw new HttpError(409, "This sale key was already recorded by another cashier.", "DUPLICATE_SALE_KEY");
  }
  if (sale.requestFingerprint !== requestFingerprint) {
    throw new HttpError(
      409,
      "This sale key belongs to a different purchase. Refresh the page before saving again.",
      "IDEMPOTENCY_PAYLOAD_MISMATCH"
    );
  }
  const row = await prisma.receipt.findUnique({
    where: { id: sale.receiptId },
    select: walkInReceiptSelect
  });
  if (!row) return null;
  return { receipt: row, replayed: true, productStates: new Map(), studentName: row.student.fullName };
}

type RecordWalkInSaleProductState = {
  previousStock: number;
  newStock: number;
  status: PrismaProductStatus;
  name: string;
  lowStockThreshold: number;
};

type RecordWalkInSaleResult = {
  receipt: WalkInReceiptRecord;
  replayed: boolean;
  productStates: Map<string, RecordWalkInSaleProductState>;
  studentName: string;
};

export async function recordWalkInSale(input: WalkInSaleInput) {
  const receiptCode = input.receiptCode?.trim().toUpperCase() || createReceiptCode();
  const items = normalizeSaleItems(input.items);
  const clientSaleId = input.clientSaleId.trim();
  if (!clientSaleId) throw new HttpError(400, "A sale key is required.", "INVALID_SALE_KEY");
  const requestFingerprint = saleRequestFingerprint(input, items);

  const result: RecordWalkInSaleResult = await prisma
    .$transaction(async (tx) => {
      if (clientSaleId) {
        const existing = await tx.walkInSale.findUnique({
          where: { clientSaleId },
          select: { receiptId: true, cashierId: true, requestFingerprint: true }
        });
        if (existing) {
          if (existing.cashierId !== input.performedById) {
            throw new HttpError(409, "This sale key was already recorded by another cashier.", "DUPLICATE_SALE_KEY");
          }
          if (existing.requestFingerprint !== requestFingerprint) {
            throw new HttpError(
              409,
              "This sale key belongs to a different purchase. Refresh the page before saving again.",
              "IDEMPOTENCY_PAYLOAD_MISMATCH"
            );
          }
          const replayed = await tx.receipt.findUnique({
            where: { id: existing.receiptId },
            select: walkInReceiptSelect
          });
          if (!replayed) throw new HttpError(409, "The original sale for this key no longer exists.", "DUPLICATE_SALE_KEY");
          return { receipt: replayed, replayed: true, productStates: new Map(), studentName: replayed.student.fullName };
        }
      }

      const student = await tx.profile.findFirst({
        where: { id: input.studentId, role: "STUDENT" },
        select: { id: true, fullName: true }
      });
      if (!student) throw new HttpError(404, "Student not found.");

      const productIds = Array.from(new Set(items.map((item) => item.productId))).sort();
      for (const productId of productIds) {
        const exists = await lockProductForUpdate(tx, productId);
        if (!exists) throw new HttpError(404, "One of the selected products was not found.");
      }

      const [products, variants, skus] = await Promise.all([
        tx.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            name: true,
            price: true,
            stock: true,
            lowStockThreshold: true,
            status: true,
            isActive: true,
            saleMode: true,
            skuInventoryEnabled: true
          }
        }),
        tx.productVariant.findMany({
          where: { productId: { in: productIds } },
          select: { id: true, productId: true, optionName: true, optionValue: true, stock: true }
        }),
        tx.productSku.findMany({
          where: { productId: { in: productIds } },
          select: {
            id: true,
            productId: true,
            code: true,
            stock: true,
            isActive: true,
            optionValues: { select: { variantId: true } }
          }
        })
      ]);
      const productById = new Map(products.map((product) => [product.id, product]));
      const variantsByProduct = new Map<string, typeof variants>();
      for (const variant of variants) {
        const list = variantsByProduct.get(variant.productId) ?? [];
        list.push(variant);
        variantsByProduct.set(variant.productId, list);
      }
      const skuById = new Map(skus.map((sku) => [sku.id, sku]));
      const variantById = new Map(variants.map((variant) => [variant.id, variant]));

      const itemPlans = items.map((item) => {
        const product = productById.get(item.productId);
        if (!product) throw new HttpError(404, "One of the selected products was not found.");
        if (!product.isActive) throw new HttpError(400, `${product.name} is no longer available.`, "PRODUCT_UNAVAILABLE");

        let sku: typeof skus[number] | undefined;
        let variant: typeof variants[number] | undefined;
        let optionSnapshot: OptionSnapshotEntry[] | null = null;

        if (product.skuInventoryEnabled) {
          if (item.variantId) {
            throw new HttpError(400, `Choose only a combination for ${product.name}.`, "WALK_IN_OPTION_CONFLICT");
          }
          if (!item.skuId) {
            throw new HttpError(400, `Choose a specific combination for ${product.name}.`, "WALK_IN_SKU_REQUIRED");
          }
          sku = skuById.get(item.skuId);
          if (!sku || sku.productId !== product.id || !sku.isActive) {
            throw new HttpError(400, `The selected combination for ${product.name} is no longer available.`, "WALK_IN_SKU_UNAVAILABLE");
          }
          if (sku.stock < item.quantity) {
            throw new HttpError(409, `Only ${sku.stock} pc(s) left of the selected ${product.name} combination.`, "WALK_IN_INSUFFICIENT_STOCK");
          }
          optionSnapshot = sku.optionValues.map((link) => {
            const linkedVariant = variantById.get(link.variantId)!;
            return { optionName: linkedVariant.optionName, optionValue: linkedVariant.optionValue };
          });
        } else if (variantsByProduct.get(product.id)?.length) {
          if (item.skuId) {
            throw new HttpError(400, `Choose only an option for ${product.name}.`, "WALK_IN_OPTION_CONFLICT");
          }
          if (!item.variantId) {
            throw new HttpError(400, `Choose a size or option for ${product.name}.`, "WALK_IN_VARIANT_REQUIRED");
          }
          variant = variantById.get(item.variantId);
          if (!variant || variant.productId !== product.id) {
            throw new HttpError(400, `The selected option for ${product.name} is no longer available.`, "WALK_IN_VARIANT_UNAVAILABLE");
          }
          if (variant.stock < item.quantity) {
            throw new HttpError(409, `Only ${variant.stock} pc(s) left of ${product.name} (${variant.optionValue}).`, "WALK_IN_INSUFFICIENT_STOCK");
          }
          optionSnapshot = [{ optionName: variant.optionName, optionValue: variant.optionValue }];
        } else {
          if (item.skuId || item.variantId) {
            throw new HttpError(400, `${product.name} does not use a size or combination.`, "WALK_IN_OPTION_UNEXPECTED");
          }
          if (product.stock < item.quantity) {
            throw new HttpError(409, `Only ${product.stock} pc(s) left of ${product.name}.`, "WALK_IN_INSUFFICIENT_STOCK");
          }
        }

        const unitPrice = Number(product.price);
        return {
          item,
          product,
          sku,
          variant,
          optionSnapshot,
          unitPrice: new Prisma.Decimal(unitPrice),
          subtotal: new Prisma.Decimal(roundToCentavos(unitPrice * item.quantity))
        };
      });

      const quantityByProduct = new Map<string, number>();
      for (const plan of itemPlans) {
        quantityByProduct.set(plan.product.id, (quantityByProduct.get(plan.product.id) ?? 0) + plan.item.quantity);
      }
      for (const [productId, quantity] of quantityByProduct) {
        const product = productById.get(productId)!;
        if (product.stock < quantity) {
          throw new HttpError(409, `Only ${product.stock} pc(s) left of ${product.name}.`, "WALK_IN_INSUFFICIENT_STOCK");
        }
      }

      const totalAmount = sumTotals(itemPlans);
      if (!Number.isFinite(input.cashReceived) || input.cashReceived < totalAmount) {
        throw new HttpError(
          400,
          `Cash received must cover the PHP ${totalAmount.toFixed(2)} total.`,
          "INVALID_CASH_RECEIVED"
        );
      }
      const changeDue = roundToCentavos(input.cashReceived - totalAmount);

      const now = new Date();
      const updatedProductStates = new Map<string, RecordWalkInSaleProductState>();
      for (const [productId, quantity] of quantityByProduct) {
        const product = productById.get(productId)!;
        const newStock = product.stock - quantity;
        const status = deriveProductStatus(newStock, product.lowStockThreshold, product.status as ProductStatus) as PrismaProductStatus;
        await tx.product.update({
          where: { id: productId },
          data: { stock: newStock, status, updatedAt: now },
          select: { id: true }
        });
        updatedProductStates.set(productId, {
          previousStock: product.stock,
          newStock,
          status,
          name: product.name,
          lowStockThreshold: product.lowStockThreshold
        });
      }

      for (const plan of itemPlans) {
        if (plan.sku) {
          const updatedSku = await tx.productSku.updateMany({
            where: { id: plan.sku.id, stock: { gte: plan.item.quantity } },
            data: { stock: { decrement: plan.item.quantity }, updatedAt: now }
          });
          if (updatedSku.count !== 1) {
            throw new HttpError(409, `Stock for ${plan.product.name} changed while saving. Please try again.`);
          }
          for (const link of plan.sku.optionValues) {
            const updatedVariant = await tx.productVariant.updateMany({
              where: { id: link.variantId, stock: { gte: plan.item.quantity } },
              data: { stock: { decrement: plan.item.quantity }, updatedAt: now }
            });
            if (updatedVariant.count !== 1) {
              throw new HttpError(409, `Option stock for ${plan.product.name} changed while saving. Please try again.`);
            }
          }
        } else if (plan.variant) {
          const updatedVariant = await tx.productVariant.updateMany({
            where: { id: plan.variant.id, stock: { gte: plan.item.quantity } },
            data: { stock: { decrement: plan.item.quantity }, updatedAt: now }
          });
          if (updatedVariant.count !== 1) {
            throw new HttpError(409, `Option stock for ${plan.product.name} changed while saving. Please try again.`);
          }
        }
      }

      const verificationHash = createVerificationHash();
      const publicToken = createPublicVerificationToken();
      const receipt = await tx.receipt.create({
        data: {
          receiptCode,
          studentId: input.studentId,
          totalAmount: new Prisma.Decimal(totalAmount),
          paymentMethod: "CASH",
          status: "VERIFIED",
          verificationHash,
          publicVerificationTokenEncrypted: publicToken.encrypted,
          publicVerificationTokenHash: publicToken.hash,
          issuedById: input.performedById,
          issuedAt: now,
          verifiedAt: now
        },
        select: { id: true }
      });

      const cashier = await tx.profile.findUnique({
        where: { id: input.performedById },
        select: { fullName: true }
      });
      const sale = await tx.walkInSale.create({
        data: {
          receiptId: receipt.id,
          studentId: input.studentId,
          cashierId: input.performedById,
          cashierNameSnapshot: cashier?.fullName ?? "Staff",
          clientSaleId,
          requestFingerprint,
          cashTendered: new Prisma.Decimal(input.cashReceived),
          changeDue: new Prisma.Decimal(changeDue)
        },
        select: { id: true }
      });

      const itemIds: Array<{ itemId: string; plan: typeof itemPlans[number] }> = [];
      for (const plan of itemPlans) {
        const created = await tx.walkInSaleItem.create({
          data: {
            saleId: sale.id,
            receiptId: receipt.id,
            productId: plan.product.id,
            skuId: plan.sku?.id ?? null,
            variantId: plan.variant?.id ?? null,
            productNameSnapshot: plan.product.name,
            optionSnapshot: plan.optionSnapshot ?? undefined,
            quantity: plan.item.quantity,
            unitPrice: plan.unitPrice,
            subtotal: plan.subtotal
          },
          select: { id: true }
        });
        itemIds.push({ itemId: created.id, plan });
      }

      for (const { itemId, plan } of itemIds) {
        const batchCount = await tx.inventoryBatch.count({
          where: { productId: plan.product.id, skuId: plan.sku?.id ?? null }
        });
        if (batchCount === 0) continue;
        await allocateWalkInSaleCostsInTransaction(tx, {
          walkInSaleItemId: itemId,
          productId: plan.product.id,
          skuId: plan.sku?.id ?? null,
          quantity: plan.item.quantity,
          note: `Walk-in sale ${receiptCode}`
        });
      }

      const movements: Prisma.InventoryMovementCreateManyInput[] = [];
      for (const [productId, state] of updatedProductStates) {
        const product = productById.get(productId)!;
        movements.push({
          productId,
          type: "SALE",
          quantity: state.previousStock - state.newStock,
          previousStock: state.previousStock,
          newStock: state.newStock,
          performedById: input.performedById,
          notes: `Walk-in sale ${receiptCode} (${product.name})`
        });
      }
      for (const plan of itemPlans) {
        if (plan.sku) {
          movements.push({
            productId: plan.product.id,
            skuId: plan.sku.id,
            type: "SALE",
            quantity: plan.item.quantity,
            previousStock: plan.sku.stock,
            newStock: plan.sku.stock - plan.item.quantity,
            performedById: input.performedById,
            notes: `Walk-in sale ${receiptCode} (${plan.product.name} SKU ${plan.sku.code ?? "—"})`
          });
        } else if (plan.variant) {
          movements.push({
            productId: plan.product.id,
            variantId: plan.variant.id,
            type: "SALE",
            quantity: plan.item.quantity,
            previousStock: plan.variant.stock,
            newStock: plan.variant.stock - plan.item.quantity,
            performedById: input.performedById,
            notes: `Walk-in sale ${receiptCode} (${plan.product.name} ${plan.variant.optionName}: ${plan.variant.optionValue})`
          });
        }
      }
      if (movements.length) await tx.inventoryMovement.createMany({ data: movements });

      await publishRealtimeEvents(tx, [
        {
          topic: REALTIME_TOPICS.receipts,
          entityId: receipt.id,
          audienceUserIds: [input.studentId],
          audienceRoles: ["STAFF", "ADMIN"],
          payload: { action: "created", status: "VERIFIED" }
        },
        {
          topic: REALTIME_TOPICS.dashboard,
          entityId: receipt.id,
          audienceRoles: ["STAFF", "ADMIN"],
          payload: { action: "receipt-created", status: "VERIFIED" }
        },
        {
          topic: REALTIME_TOPICS.reports,
          entityId: receipt.id,
          audienceRoles: ["STAFF", "ADMIN"],
          payload: { action: "receipt-created", status: "VERIFIED" }
        }
      ]);

      const fresh = await tx.receipt.findUnique({
        where: { id: receipt.id },
        select: walkInReceiptSelect
      });
      return { receipt: fresh!, replayed: false, productStates: updatedProductStates, studentName: student.fullName };
    }, INVENTORY_WRITE_TRANSACTION_OPTIONS)
    .catch(async (error) => {
      if (isUniqueViolation(error) && clientSaleId) {
        const replay = await replayExistingSale(clientSaleId, input.performedById, requestFingerprint);
        if (replay) return replay;
      }
      throw mapTransactionError(error);
    });

  const mappedReceipt = mapWalkInReceipt(result.receipt);

  if (!result.replayed) {
    await createNotificationBestEffort({
      userId: mappedReceipt.studentId,
      type: "RECEIPT",
      title: "Walk-in purchase recorded",
      message: `Your purchase ${mappedReceipt.receiptCode} totaling PHP ${mappedReceipt.totalAmount} has been recorded.`,
      actionUrl: "/student/receipts"
    });

    await safelyRecordAuditLog({
      actorId: input.performedById,
      action: "WALK_IN_SALE_RECORDED",
      entityType: "receipt",
      entityId: mappedReceipt.id,
      summary: `Recorded walk-in sale ${mappedReceipt.receiptCode} for ${result.studentName}.`,
      metadata: {
        receiptCode: mappedReceipt.receiptCode,
        studentId: input.studentId,
        totalAmount: mappedReceipt.totalAmount,
        itemCount: mappedReceipt.items.length,
        cashReceived: input.cashReceived,
        clientSaleId,
        performedById: input.performedById
      }
    });

    for (const state of result.productStates.values()) {
      if (state.previousStock > state.lowStockThreshold && state.newStock <= state.lowStockThreshold) {
        await createNotificationsForRolesBestEffort(["STAFF", "ADMIN"], {
          type: "LOW_STOCK",
          title: `Low stock: ${state.name}`,
          message: `${state.name} is now at ${state.newStock} pcs. Minimum stock is ${state.lowStockThreshold} pcs.`,
          actionUrl: "/staff/inventory"
        });
      }
    }
  }

  return { receipt: mappedReceipt, created: !result.replayed };
}

export async function getWalkInReceipt(receiptId: string) {
  const row = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: walkInReceiptSelect
  });
  if (!row || !row.walkInSale) return null;
  return mapWalkInReceipt(row);
}

export type WalkInSaleListOptions = {
  limit?: number;
  cursor?: string;
  query?: string;
  status?: "PENDING" | "VERIFIED" | "VOIDED";
};

export async function listWalkInSales(options: WalkInSaleListOptions = {}) {
  const limit = normalizePageLimit(options.limit);
  const cursorId = decodeCursor(options.cursor);
  const query = options.query?.trim();
  const rows = await prisma.receipt.findMany({
    where: {
      walkInSale: { isNot: null },
      ...(options.status ? { status: options.status } : {}),
      ...(query ? {
        OR: [
          { receiptCode: { contains: query, mode: "insensitive" } },
          { student: { is: { fullName: { contains: query, mode: "insensitive" as const } } } },
          { student: { is: { studentNumber: { contains: query, mode: "insensitive" as const } } } },
          { walkInSaleItems: { some: { productNameSnapshot: { contains: query, mode: "insensitive" } } } }
        ]
      } : {})
    },
    select: walkInReceiptSelect,
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    take: limit + 1
  });
  return createPage(rows.map(mapWalkInReceipt), limit);
}

export async function voidWalkInSale(input: { receiptId: string; reason: string; voidedById: string }) {
  const reason = input.reason.trim();
  const result = await prisma
    .$transaction(async (tx) => {
      const lockedReceipts = await tx.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
        SELECT id, status
        FROM "receipts"
        WHERE id = ${input.receiptId}::uuid
        FOR UPDATE
      `);
      if (!lockedReceipts.length) throw new HttpError(404, "Receipt not found.");

      const receipt = await tx.receipt.findUnique({
        where: { id: input.receiptId },
        select: {
          id: true,
          receiptCode: true,
          studentId: true,
          reservationId: true,
          status: true,
          totalAmount: true,
          walkInSale: { select: { id: true } },
          walkInSaleItems: { select: walkInSaleItemSelect }
        }
      });
      if (!receipt) throw new HttpError(404, "Receipt not found.");
      if (receipt.reservationId) {
        throw new HttpError(400, "Only walk-in sales can be voided here.", "WALK_IN_VOID_RESTRICTED");
      }
      if (receipt.status === "VOIDED") {
        const unchanged = await tx.receipt.findUnique({
          where: { id: input.receiptId },
          select: walkInReceiptSelect
        });
        return { receipt: unchanged!, changed: false, previousStatus: "VOIDED" as const };
      }
      if (!receipt.walkInSale) {
        throw new HttpError(409, "This walk-in sale header is missing and cannot be voided safely.", "WALK_IN_VOID_HEADER_MISSING");
      }
      const previousStatus = receipt.status;

      const productIds = Array.from(new Set(receipt.walkInSaleItems.map((item) => item.productId))).sort();
      for (const productId of productIds) {
        const exists = await lockProductForUpdate(tx, productId);
        if (!exists) throw new HttpError(404, "A product on this sale no longer exists.");
      }

      const [products, skus, variants] = await Promise.all([
        tx.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true, stock: true, lowStockThreshold: true, status: true }
        }),
        tx.productSku.findMany({
          where: { id: { in: receipt.walkInSaleItems.map((item) => item.skuId).filter((id): id is string => Boolean(id)) } },
          select: { id: true, productId: true, stock: true, optionValues: { select: { variantId: true } } }
        }),
        tx.productVariant.findMany({
          where: {
            OR: [
              { id: { in: receipt.walkInSaleItems.map((item) => item.variantId).filter((id): id is string => Boolean(id)) } },
              { productId: { in: productIds } }
            ]
          },
          select: { id: true, productId: true, stock: true }
        })
      ]);
      const productById = new Map(products.map((product) => [product.id, product]));
      const skuById = new Map(skus.map((sku) => [sku.id, sku]));
      const variantById = new Map(variants.map((variant) => [variant.id, variant]));

      const quantityByProduct = new Map<string, number>();
      for (const item of receipt.walkInSaleItems) {
        quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) ?? 0) + item.quantity);
      }

      const now = new Date();
      const movements: Prisma.InventoryMovementCreateManyInput[] = [];
      for (const [productId, quantity] of quantityByProduct) {
        const product = productById.get(productId)!;
        const newStock = product.stock + quantity;
        const status = deriveProductStatus(newStock, product.lowStockThreshold, product.status as ProductStatus) as PrismaProductStatus;
        await tx.product.update({
          where: { id: productId },
          data: { stock: newStock, status, updatedAt: now },
          select: { id: true }
        });
        movements.push({
          productId,
          type: "ADJUSTMENT",
          quantity,
          previousStock: product.stock,
          newStock,
          performedById: input.voidedById,
          notes: `Walk-in sale ${receipt.receiptCode} voided — ${reason}`
        });
      }

      for (const item of receipt.walkInSaleItems) {
        if (item.skuId) {
          const sku = skuById.get(item.skuId);
          if (!sku) throw new HttpError(409, "A sold combination no longer exists and its stock cannot be restored.", "WALK_IN_VOID_SKU_MISSING");
          await tx.productSku.update({
            where: { id: sku.id },
            data: { stock: { increment: item.quantity }, updatedAt: now },
            select: { id: true }
          });
          movements.push({
            productId: sku.productId,
            skuId: sku.id,
            type: "ADJUSTMENT",
            quantity: item.quantity,
            previousStock: sku.stock,
            newStock: sku.stock + item.quantity,
            performedById: input.voidedById,
            notes: `Walk-in sale ${receipt.receiptCode} voided — ${reason}`
          });
          for (const link of sku.optionValues) {
            const variant = variantById.get(link.variantId);
            if (variant) {
              await tx.productVariant.update({
                where: { id: variant.id },
                data: { stock: { increment: item.quantity }, updatedAt: now },
                select: { id: true }
              });
            }
          }
        } else if (item.variantId) {
          const variant = variantById.get(item.variantId);
          if (!variant) throw new HttpError(409, "A sold option no longer exists and its stock cannot be restored.", "WALK_IN_VOID_VARIANT_MISSING");
          await tx.productVariant.update({
            where: { id: variant.id },
            data: { stock: { increment: item.quantity }, updatedAt: now },
            select: { id: true }
          });
          movements.push({
            productId: variant.productId,
            variantId: variant.id,
            type: "ADJUSTMENT",
            quantity: item.quantity,
            previousStock: variant.stock,
            newStock: variant.stock + item.quantity,
            performedById: input.voidedById,
            notes: `Walk-in sale ${receipt.receiptCode} voided — ${reason}`
          });
        }
        await reverseWalkInSaleCostAllocationsInTransaction(tx, { walkInSaleItemId: item.id });
      }
      if (movements.length) await tx.inventoryMovement.createMany({ data: movements });

      await tx.receipt.update({
        where: { id: receipt.id },
        data: {
          status: "VOIDED",
          voidedAt: now,
          updatedAt: now
        },
        select: { id: true }
      });

      await tx.walkInSale.update({
        where: { id: receipt.walkInSale.id },
        data: {
          voidedById: input.voidedById,
          voidReason: reason,
          voidedAt: now,
          updatedAt: now
        },
        select: { id: true }
      });

      await tx.outboxEvent.create({
        data: {
          type: OUTBOX_EVENT_TYPES.receiptStatusChanged,
          entityId: receipt.id,
          payload: {
            actorId: input.voidedById,
            studentId: receipt.studentId,
            receiptCode: receipt.receiptCode,
            reservationId: null,
            totalAmount: receipt.totalAmount.toString(),
            previousStatus,
            nextStatus: "VOIDED",
            reason
          }
        },
        select: { id: true }
      });

      await publishRealtimeEvents(tx, [
        {
          topic: REALTIME_TOPICS.receipts,
          entityId: receipt.id,
          audienceUserIds: [receipt.studentId],
          audienceRoles: ["STAFF", "ADMIN"],
          payload: { action: "status-changed", previousStatus, nextStatus: "VOIDED" }
        },
        {
          topic: REALTIME_TOPICS.dashboard,
          entityId: receipt.id,
          audienceRoles: ["STAFF", "ADMIN"],
          payload: { action: "receipt-status-changed", nextStatus: "VOIDED" }
        },
        {
          topic: REALTIME_TOPICS.reports,
          entityId: receipt.id,
          audienceRoles: ["STAFF", "ADMIN"],
          payload: { action: "receipt-status-changed", nextStatus: "VOIDED" }
        }
      ]);

      const updated = await tx.receipt.findUnique({
        where: { id: receipt.id },
        select: walkInReceiptSelect
      });
      return { receipt: updated!, changed: true, previousStatus };
    }, INVENTORY_WRITE_TRANSACTION_OPTIONS)
    .catch((error) => {
      throw mapTransactionError(error);
    });

  if (result.changed) {
    await safelyRecordAuditLog({
      actorId: input.voidedById,
      action: "WALK_IN_SALE_VOIDED",
      entityType: "receipt",
      entityId: result.receipt.id,
      summary: `Voided walk-in sale ${result.receipt.receiptCode}.`,
      metadata: {
        receiptCode: result.receipt.receiptCode,
        studentId: result.receipt.studentId,
        totalAmount: result.receipt.totalAmount,
        reason,
        previousStatus: result.previousStatus
      }
    });
  }

  return { receipt: mapWalkInReceipt(result.receipt), changed: result.changed };
}
