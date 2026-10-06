import { z } from "zod";
import { TREASURY_OR_MAX_LENGTH } from "./treasury-official-receipt.js";

const walkInSaleItemSchema = z.object({
  productId: z.string().uuid(),
  skuId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  quantity: z.coerce.number().int().min(1).max(10_000_000)
}).refine((item) => !(item.skuId && item.variantId), {
  message: "Choose either a SKU combination or a variant, not both."
});

const walkInSaleBaseSchema = {
  items: z.array(walkInSaleItemSchema).min(1).max(50),
  buyerName: z.string().trim().min(2).max(120),
  studentId: z.string().uuid().nullish(),
  receiptCode: z.string().trim().min(5).max(64).regex(/^[A-Za-z0-9-]+$/, "Invalid receipt code.").optional(),
  clientSaleId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid sale key.")
};

/**
 * Commissary sales take cash and compute change. Treasury sales are paid at the
 * school Treasury, so the cashier records the inspected OR number instead and
 * must not enter cash. Each branch is strict so neither can carry the other's
 * payment fields.
 */
export const recordWalkInSaleSchema = z.discriminatedUnion("collectionChannel", [
  z.object({
    ...walkInSaleBaseSchema,
    collectionChannel: z.literal("COMMISSARY"),
    cashReceived: z.coerce.number().nonnegative().max(10_000_000).multipleOf(0.01)
  }).strict(),
  z.object({
    ...walkInSaleBaseSchema,
    collectionChannel: z.literal("TREASURER"),
    officialReceiptNumber: z.string().trim().min(1).max(TREASURY_OR_MAX_LENGTH),
    treasuryReceiptInspected: z.literal(true, {
      errorMap: () => ({ message: "Confirm that you inspected the Treasury official receipt." })
    })
  }).strict()
]);

/** Clients released before Treasury support omit the channel; they are Commissary. */
export function parseRecordWalkInSale(body: unknown) {
  const payload = body && typeof body === "object" && !("collectionChannel" in body)
    ? { ...body, collectionChannel: "COMMISSARY" }
    : body;
  return recordWalkInSaleSchema.parse(payload);
}
