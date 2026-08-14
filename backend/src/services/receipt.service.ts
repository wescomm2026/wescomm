import { randomBytes } from "node:crypto";
import {
  maskPublicPersonName,
  maskPublicReferenceCode,
  maskPublicStudentNumber,
  summarizePublicReceiptItems
} from "../domain/public-receipt.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";
import { createNotification, createNotificationsForRoles } from "./notification.service.js";
import {
  type AppRole,
  type PaymentMethod,
  type RawProfile,
  type RawProfileSummary,
  firstRow,
  mapProfileSummary
} from "../types/app.js";
import { HttpError } from "../utils/http-error.js";

type RawReceiptProduct = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: string | number;
};

type RawReceiptReservationItem = {
  id: string;
  product_id: string;
  variant_summary: string | null;
  quantity: number;
  unit_price: string | number;
  subtotal: string | number;
  product: RawReceiptProduct | RawReceiptProduct[] | null;
};

type RawReceiptReservation = {
  id: string;
  reference_code: string;
  status: string;
  pickup_start: string | null;
  pickup_end: string | null;
  items: RawReceiptReservationItem[] | null;
};

type RawReceipt = {
  id: string;
  receipt_code: string;
  student_id: string;
  reservation_id: string | null;
  total_amount: string | number;
  payment_method: PaymentMethod;
  status: string;
  verification_hash: string;
  receipt_image_url: string | null;
  receipt_pdf_url: string | null;
  issued_by_id: string | null;
  issued_at: string;
  created_at: string;
  updated_at: string;
  student: RawProfileSummary | RawProfileSummary[] | null;
  issuedBy: RawProfileSummary | RawProfileSummary[] | null;
  reservation: RawReceiptReservation | RawReceiptReservation[] | null;
};

type RawReceiptSourceReservation = {
  id: string;
  student_id: string;
  reference_code: string;
  status: string;
  payment_method: PaymentMethod;
  total_amount: string | number;
};

type RawPublicReceipt = {
  receipt_code: string;
  total_amount: string | number;
  payment_method: PaymentMethod;
  status: string;
  issued_at: string;
  student: Pick<RawProfile, "full_name" | "student_number"> | Array<Pick<RawProfile, "full_name" | "student_number">> | null;
  reservation:
    | {
        reference_code: string;
        status: string;
        items: Array<{
          quantity: number;
        }> | null;
      }
    | Array<{
        reference_code: string;
        status: string;
        items: Array<{
          quantity: number;
        }> | null;
      }>
    | null;
};

const receiptSelect = `
  id,
  receipt_code,
  student_id,
  reservation_id,
  total_amount,
  payment_method,
  status,
  verification_hash,
  receipt_image_url,
  receipt_pdf_url,
  issued_by_id,
  issued_at,
  created_at,
  updated_at,
  student:profiles!receipts_student_id_fkey(id,full_name,email,student_number),
  issuedBy:profiles!receipts_issued_by_id_fkey(id,full_name,email,student_number),
  reservation:reservations(
    id,
    reference_code,
    status,
    pickup_start,
    pickup_end,
    items:reservation_items(
      id,
      product_id,
      variant_summary,
      quantity,
      unit_price,
      subtotal,
      product:products(id,name,description,image_url,price)
    )
  )
`;

const publicReceiptSelect = `
  receipt_code,
  total_amount,
  payment_method,
  status,
  issued_at,
  student:profiles!receipts_student_id_fkey(full_name,student_number),
  reservation:reservations(
    reference_code,
    status,
    items:reservation_items(
      quantity
    )
  )
`;

function createReceiptCode() {
  const year = new Date().getFullYear();
  const suffix = randomBytes(5).toString("hex").toUpperCase();
  return `RCT-${year}-${suffix}`;
}

function createVerificationHash() {
  return randomBytes(32).toString("hex");
}

function mapPublicReceipt(row: RawPublicReceipt) {
  const student = firstRow(row.student);
  const reservation = firstRow(row.reservation);
  const itemSummary = summarizePublicReceiptItems(reservation?.items);

  return {
    receiptCode: row.receipt_code,
    totalAmount: row.total_amount,
    paymentMethod: row.payment_method,
    status: row.status,
    issuedAt: row.issued_at,
    student: {
      displayName: maskPublicPersonName(student?.full_name),
      studentNumber: maskPublicStudentNumber(student?.student_number)
    },
    reservation: reservation
      ? {
          referenceCode: maskPublicReferenceCode(reservation.reference_code),
          status: reservation.status,
          itemCount: itemSummary.itemCount,
          totalQuantity: itemSummary.totalQuantity
        }
      : null
  };
}

function mapReceipt(row: RawReceipt) {
  const reservation = firstRow(row.reservation);

  return {
    id: row.id,
    receiptCode: row.receipt_code,
    studentId: row.student_id,
    reservationId: row.reservation_id,
    totalAmount: row.total_amount,
    paymentMethod: row.payment_method,
    status: row.status,
    verificationHash: row.verification_hash,
    receiptImageUrl: row.receipt_image_url,
    receiptPdfUrl: row.receipt_pdf_url,
    issuedById: row.issued_by_id,
    issuedAt: row.issued_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    student: mapProfileSummary(row.student),
    issuedBy: mapProfileSummary(row.issuedBy),
    reservation: reservation
      ? {
          id: reservation.id,
          referenceCode: reservation.reference_code,
          status: reservation.status,
          pickupStart: reservation.pickup_start,
          pickupEnd: reservation.pickup_end,
          items: (reservation.items ?? []).map((item) => {
            const product = firstRow(item.product);

            return {
              id: item.id,
              productId: item.product_id,
              variantSummary: item.variant_summary,
              quantity: item.quantity,
              unitPrice: item.unit_price,
              subtotal: item.subtotal,
              product: product
                ? {
                    id: product.id,
                    name: product.name,
                    description: product.description,
                    imageUrl: product.image_url,
                    price: product.price
                  }
                : null
            };
          })
        }
      : null
  };
}

async function getReceiptByIdOrThrow(receiptId: string) {
  const { data, error } = await supabaseAdmin
    .from("receipts")
    .select(receiptSelect)
    .eq("id", receiptId)
    .maybeSingle();

  if (error) throw HttpError.fromSupabase(error);
  if (!data) throw new HttpError(404, "Receipt not found.");

  return mapReceipt(data as unknown as RawReceipt);
}

export async function listReceipts(userId: string, role: AppRole) {
  let query = supabaseAdmin.from("receipts").select(receiptSelect).order("issued_at", { ascending: false });
  if (role === "STUDENT") query = query.eq("student_id", userId);

  const { data, error } = await query;
  if (error) throw HttpError.fromSupabase(error);
  return ((data ?? []) as unknown as RawReceipt[]).map(mapReceipt);
}

export async function verifyReceipt(receiptCode: string) {
  const { data, error } = await supabaseAdmin
    .from("receipts")
    .select(publicReceiptSelect)
    .eq("receipt_code", receiptCode)
    .maybeSingle();

  if (error) throw HttpError.fromSupabase(error);
  return data ? mapPublicReceipt(data as unknown as RawPublicReceipt) : null;
}

export async function createReceipt(input: {
  studentId: string;
  reservationId?: string;
  totalAmount: number;
  issuedById: string;
  paymentMethod?: PaymentMethod;
}) {
  const receiptCode = createReceiptCode();
  const verificationHash = createVerificationHash();

  const { data, error } = await supabaseAdmin
    .from("receipts")
    .insert({
      receipt_code: receiptCode,
      verification_hash: verificationHash,
      student_id: input.studentId,
      reservation_id: input.reservationId ?? null,
      total_amount: input.totalAmount,
      payment_method: input.paymentMethod ?? "CASH",
      issued_by_id: input.issuedById,
      status: "VERIFIED"
    })
    .select(receiptSelect)
    .single();

  if (error) throw HttpError.fromSupabase(error);
  const receipt = mapReceipt(data as unknown as RawReceipt);

  await createNotification({
    userId: input.studentId,
    type: "RECEIPT",
    title: "Digital receipt ready",
    message: `${receipt.receiptCode} is verified and ready to download.`
  });

  await safelyRecordAuditLog({
    actorId: input.issuedById,
    action: "RECEIPT_CREATED",
    entityType: "receipt",
    entityId: receipt.id,
    summary: `Created receipt ${receipt.receiptCode}.`,
    metadata: {
      receiptCode: receipt.receiptCode,
      studentId: receipt.studentId,
      totalAmount: receipt.totalAmount,
      reservationId: receipt.reservationId
    }
  });

  return receipt;
}

export async function createReceiptForReservation(reservationId: string, issuedById: string) {
  const { data: existingReceipt, error: existingError } = await supabaseAdmin
    .from("receipts")
    .select(receiptSelect)
    .eq("reservation_id", reservationId)
    .maybeSingle();

  if (existingError) throw HttpError.fromSupabase(existingError);
  if (existingReceipt) return mapReceipt(existingReceipt as unknown as RawReceipt);

  const { data: reservationData, error: reservationError } = await supabaseAdmin
    .from("reservations")
    .select("id,student_id,reference_code,status,payment_method,total_amount")
    .eq("id", reservationId)
    .single();

  if (reservationError) throw HttpError.fromSupabase(reservationError);

  const reservation = reservationData as RawReceiptSourceReservation;
  if (reservation.status !== "COMPLETED") {
    throw new HttpError(400, "Receipt can only be generated for a completed reservation.");
  }

  const receiptCode = createReceiptCode();
  const verificationHash = createVerificationHash();

  const { data, error } = await supabaseAdmin
    .from("receipts")
    .insert({
      receipt_code: receiptCode,
      verification_hash: verificationHash,
      student_id: reservation.student_id,
      reservation_id: reservation.id,
      total_amount: reservation.total_amount,
      payment_method: reservation.payment_method,
      issued_by_id: issuedById,
      status: "PENDING"
    })
    .select(receiptSelect)
    .single();

  if (error) throw HttpError.fromSupabase(error);
  const receipt = mapReceipt(data as unknown as RawReceipt);

  await Promise.all([
    createNotification({
      userId: reservation.student_id,
      type: "RECEIPT",
      title: "Digital receipt generated",
      message: `${receipt.receiptCode} was created for ${reservation.reference_code} and is waiting for verification.`
    }),
    createNotificationsForRoles(["STAFF", "ADMIN"], {
      type: "RECEIPT",
      title: "Receipt needs verification",
      message: `${receipt.receiptCode} was generated for ${reservation.reference_code}.`
    })
  ]);

  await safelyRecordAuditLog({
    actorId: issuedById,
    action: "RECEIPT_GENERATED",
    entityType: "receipt",
    entityId: receipt.id,
    summary: `Generated receipt ${receipt.receiptCode} for ${reservation.reference_code}.`,
    metadata: {
      receiptCode: receipt.receiptCode,
      reservationId: reservation.id,
      referenceCode: reservation.reference_code,
      totalAmount: receipt.totalAmount
    }
  });

  return receipt;
}

export async function markReceiptVerified(receiptId: string, verifiedById: string) {
  const currentReceipt = await getReceiptByIdOrThrow(receiptId);

  if (currentReceipt.status === "VOIDED") {
    throw new HttpError(400, "Voided receipts cannot be verified.");
  }

  if (currentReceipt.status === "VERIFIED") {
    return currentReceipt;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("receipts")
    .update({
      status: "VERIFIED",
      issued_by_id: verifiedById,
      issued_at: now,
      updated_at: now
    })
    .eq("id", receiptId)
    .select(receiptSelect)
    .single();

  if (error) throw HttpError.fromSupabase(error);
  const receipt = mapReceipt(data as unknown as RawReceipt);

  await createNotification({
    userId: receipt.studentId,
    type: "RECEIPT",
    title: "Digital receipt verified",
    message: `${receipt.receiptCode} is now verified and ready to download.`
  });

  await safelyRecordAuditLog({
    actorId: verifiedById,
    action: "RECEIPT_VERIFIED",
    entityType: "receipt",
    entityId: receipt.id,
    summary: `Verified receipt ${receipt.receiptCode}.`,
    metadata: {
      receiptCode: receipt.receiptCode,
      studentId: receipt.studentId,
      reservationId: receipt.reservationId,
      totalAmount: receipt.totalAmount
    }
  });

  return receipt;
}

export async function voidReceipt(receiptId: string, voidedById: string, reason?: string) {
  const currentReceipt = await getReceiptByIdOrThrow(receiptId);

  if (currentReceipt.status === "VOIDED") {
    return currentReceipt;
  }

  const { data, error } = await supabaseAdmin
    .from("receipts")
    .update({
      status: "VOIDED",
      issued_by_id: voidedById,
      updated_at: new Date().toISOString()
    })
    .eq("id", receiptId)
    .select(receiptSelect)
    .single();

  if (error) throw HttpError.fromSupabase(error);
  const receipt = mapReceipt(data as unknown as RawReceipt);
  const cleanReason = reason?.trim();

  await createNotification({
    userId: receipt.studentId,
    type: "RECEIPT",
    title: "Digital receipt voided",
    message: cleanReason
      ? `${receipt.receiptCode} was voided by commissary staff. Reason: ${cleanReason}`
      : `${receipt.receiptCode} was voided by commissary staff.`
  });

  await safelyRecordAuditLog({
    actorId: voidedById,
    action: "RECEIPT_VOIDED",
    entityType: "receipt",
    entityId: receipt.id,
    summary: `Voided receipt ${receipt.receiptCode}.`,
    metadata: {
      receiptCode: receipt.receiptCode,
      studentId: receipt.studentId,
      reservationId: receipt.reservationId,
      totalAmount: receipt.totalAmount,
      previousStatus: currentReceipt.status,
      reason: cleanReason ?? null
    }
  });

  return receipt;
}
