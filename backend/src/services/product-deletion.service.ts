import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { lockProductForUpdate } from "../utils/product-transaction.js";
import { INVENTORY_WRITE_TRANSACTION_OPTIONS } from "./inventory.service.js";
import { OUTBOX_EVENT_TYPES } from "./outbox.service.js";
import { managedProductImagePath } from "./upload.service.js";

const TRANSACTIONAL_MOVEMENT_TYPES = [
  "SALE",
  "RESERVATION_HOLD",
  "RESERVATION_CANCEL",
  "RESERVATION_NO_SHOW"
] as const;

async function dependencyCounts(client: Pick<Prisma.TransactionClient, "reservationItem" | "inventoryMovement">, productId: string) {
  const [reservationItems, transactionalMovements] = await Promise.all([
    client.reservationItem.count({ where: { productId } }),
    client.inventoryMovement.count({
      where: { productId, type: { in: [...TRANSACTIONAL_MOVEMENT_TYPES] } }
    })
  ]);
  return { reservationItems, transactionalMovements };
}

export async function getProductDeletionEligibility(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, isActive: true }
  });
  if (!product) throw new HttpError(404, "Product not found.");
  const dependencies = await dependencyCounts(prisma, productId);
  const reasons = [
    ...(product.isActive ? ["Archive the product before permanent deletion."] : []),
    ...(dependencies.reservationItems ? [`${dependencies.reservationItems} reservation line item(s) require this product history.`] : []),
    ...(dependencies.transactionalMovements ? [`${dependencies.transactionalMovements} transactional inventory movement(s) require this product history.`] : [])
  ];
  return { productId, productName: product.name, eligible: reasons.length === 0, dependencies, reasons };
}

export async function permanentlyDeleteProduct(input: {
  productId: string;
  actorId: string;
  confirmation: string;
  reason: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const locked = await lockProductForUpdate(tx, input.productId);
    if (!locked) throw new HttpError(404, "Product not found.");
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { id: true, name: true, isActive: true, imageUrl: true, imageStoragePath: true }
    });
    if (!product) throw new HttpError(404, "Product not found.");
    if (product.isActive) {
      throw new HttpError(409, "Archive the product before permanent deletion.", "PRODUCT_MUST_BE_ARCHIVED");
    }
    if (input.confirmation.trim().toLowerCase() !== product.name.trim().toLowerCase()) {
      throw new HttpError(400, "Type the exact product name to confirm permanent deletion.", "PRODUCT_DELETE_CONFIRMATION_MISMATCH");
    }

    const dependencies = await dependencyCounts(tx, product.id);
    if (dependencies.reservationItems || dependencies.transactionalMovements) {
      throw new HttpError(
        409,
        "This product has required transaction history and must remain archived.",
        "PRODUCT_HISTORY_REQUIRED",
        dependencies
      );
    }

    const imagePath = managedProductImagePath(product.imageStoragePath, product.imageUrl);
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "PRODUCT_PERMANENTLY_DELETED",
        entityType: "product",
        entityId: product.id,
        summary: `Permanently deleted archived product ${product.name}.`,
        metadata: {
          name: product.name,
          reason: input.reason,
          imageCleanupQueued: Boolean(imagePath),
          dependencies
        }
      },
      select: { id: true }
    });
    if (imagePath) {
      await tx.outboxEvent.create({
        data: {
          type: OUTBOX_EVENT_TYPES.productImageDelete,
          entityId: product.id,
          payload: { path: imagePath }
        },
        select: { id: true }
      });
    }
    await tx.product.delete({ where: { id: product.id }, select: { id: true } });
    return { id: product.id, name: product.name, imageCleanupQueued: Boolean(imagePath) };
  }, {
    ...INVENTORY_WRITE_TRANSACTION_OPTIONS,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable
  }).catch((error) => {
    if (error instanceof HttpError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "Product activity changed during deletion. Review it and try again.", "PRODUCT_DELETE_CONFLICT");
    }
    throw error;
  });

  return result;
}
