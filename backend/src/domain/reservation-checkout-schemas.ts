import { z } from "zod";
import { RESERVATION_STATUSES } from "../types/app.js";

/**
 * Cash-only payment contract for NEW reservations.
 *
 * - Students may only reserve with "PAY_AT_COMMISSARY"; the payment method is
 *   server-owned, but the field stays in the schema so legacy clients that
 *   send GCash/e-wallet values get an explicit rejection instead of a silent
 *   conversion.
 * - `preferredCollectionChannel` chooses where the student pays in cash:
 *   the Commissary or the Treasury. It is a payment location only.
 * - Staff settlement (completion) accepts only CASH, with the collection
 *   channel recorded on the payment record.
 * - Historical PAYMONGO_GCASH / GCASH records remain untouched and readable.
 */
export const STUDENT_RESERVATION_PAYMENT_METHODS = ["PAY_AT_COMMISSARY"] as const;
export const STAFF_SETTLEMENT_PAYMENT_METHODS = ["CASH"] as const;

export const createReservationSchema = z.object({
  paymentMethod: z.enum(STUDENT_RESERVATION_PAYMENT_METHODS).default("PAY_AT_COMMISSARY"),
  preferredCollectionChannel: z.enum(["COMMISSARY", "TREASURER"] as const).default("COMMISSARY"),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pickup date must use YYYY-MM-DD."),
  pickupSlotId: z.string().uuid(),
  pickupPolicyVersion: z.number().int().positive(),
  policyAcceptance: z.object({
    accepted: z.boolean().optional(),
    version: z.string().trim().min(1).max(32).optional()
  }).strict().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        skuId: z.string().uuid().optional(),
        variantSummary: z.string().trim().max(500).optional(),
        quantity: z.number().int().positive().max(20)
      })
    )
    .min(1)
    .max(25)
});

export const updateStatusSchema = z.object({
  status: z.enum(RESERVATION_STATUSES),
  settlement: z.object({
    paymentMethod: z.enum(STAFF_SETTLEMENT_PAYMENT_METHODS),
    collectionChannel: z.enum(["COMMISSARY", "TREASURER"] as const),
    officialReceiptNumber: z.string().trim().max(100).optional()
  }).optional()
});
