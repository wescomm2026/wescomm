import { Prisma, type ReceiptStatus as PrismaReceiptStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";
import {
  maskPublicPersonName,
  maskPublicReferenceCode,
  maskPublicStudentNumber,
  summarizePublicReceiptItems
} from "../domain/public-receipt.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { prisma } from "../lib/prisma.js";
import { safelyRecordAuditLog } from "./audit-log.service.js";
import {
  createNotificationBestEffort,
  createNotificationsForRolesBestEffort
} from "./notification.service.js";
import { OUTBOX_EVENT_TYPES } from "./outbox.service.js";
import { publishRealtimeEvents, publishRealtimeEventsBestEffort, REALTIME_TOPICS } from "./realtime-event.service.js";
import {
  type AppRole,
  type PaymentMethod,
  type RawProfile,
  type RawProfileSummary,
  firstRow,
  mapProfileSummary
} from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import { createPage, decodeCursor, normalizePageLimit } from "../utils/cursor-pagination.js";

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

const receiptRecordSelect = Prisma.validator<Prisma.ReceiptSelect>()({
  id: true,
  receiptCode: true,
  studentId: true,
  reservationId: true,
  totalAmount: true,
  paymentMethod: true,
  status: true,
  verificationHash: true,
  receiptImageUrl: true,
  receiptPdfUrl: true,
  issuedById: true,
  issuedAt: true,
  createdAt: true,
  updatedAt: true,
  student: { select: { id: true, fullName: true, email: true, studentNumber: true } },
  issuedBy: { select: { id: true, fullName: true, email: true, studentNumber: true } },
  reservation: {
    select: {
      id: true,
      referenceCode: true,
      status: true,
      pickupStart: true,
      pickupEnd: true,
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          productId: true,
          variantSummary: true,
          quantity: true,
          unitPrice: true,
          subtotal: true,
          product: { select: { id: true, name: true, description: true, imageUrl: true, price: true } }
        }
      }
    }
  }
});

type ReceiptRecord = Prisma.ReceiptGetPayload<{ select: typeof receiptRecordSelect }>;

function mapPrismaReceipt(receipt: ReceiptRecord) {
  return {
    id: receipt.id,
    receiptCode: receipt.receiptCode,
    studentId: receipt.studentId,
    reservationId: receipt.reservationId,
    totalAmount: receipt.totalAmount.toString(),
    paymentMethod: receipt.paymentMethod,
    status: receipt.status,
    verificationHash: receipt.verificationHash,
    receiptImageUrl: receipt.receiptImageUrl,
    receiptPdfUrl: receipt.receiptPdfUrl,
    issuedById: receipt.issuedById,
    issuedAt: receipt.issuedAt.toISOString(),
    createdAt: receipt.createdAt.toISOString(),
    updatedAt: receipt.updatedAt.toISOString(),
    student: {
      id: receipt.student.id,
      fullName: receipt.student.fullName,
      email: receipt.student.email,
      studentNumber: receipt.student.studentNumber
    },
    issuedBy: receipt.issuedBy
      ? {
          id: receipt.issuedBy.id,
          fullName: receipt.issuedBy.fullName,
          email: receipt.issuedBy.email,
          studentNumber: receipt.issuedBy.studentNumber
        }
      : null,
    reservation: receipt.reservation
      ? {
          id: receipt.reservation.id,
          referenceCode: receipt.reservation.referenceCode,
          status: receipt.reservation.status,
          pickupStart: receipt.reservation.pickupStart?.toISOString() ?? null,
          pickupEnd: receipt.reservation.pickupEnd?.toISOString() ?? null,
          items: receipt.reservation.items.map((item) => ({
            id: item.id,
            productId: item.productId,
            variantSummary: item.variantSummary,
            quantity: item.quantity,
            unitPrice: item.unitPrice.toString(),
            subtotal: item.subtotal.toString(),
            product: {
              id: item.product.id,
              name: item.product.name,
              description: item.product.description,
              imageUrl: item.product.imageUrl,
              price: item.product.price.toString()
            }
          }))
        }
      : null
  };
}

async function publishReceiptCreated(input: { receiptId: string; studentId: string; status: string }) {
  await publishRealtimeEventsBestEffort([
    {
      topic: REALTIME_TOPICS.receipts,
      entityId: input.receiptId,
      audienceUserIds: [input.studentId],
      audienceRoles: ["STAFF", "ADMIN"],
      payload: { action: "created", status: input.status }
    },
    {
      topic: REALTIME_TOPICS.dashboard,
      entityId: input.receiptId,
      audienceRoles: ["STAFF", "ADMIN"],
      payload: { action: "receipt-created", status: input.status }
    },
    {
      topic: REALTIME_TOPICS.reports,
      entityId: input.receiptId,
      audienceRoles: ["STAFF", "ADMIN"],
      payload: { action: "receipt-created", status: input.status }
    }
  ]);
}

export type ReceiptListOptions = {
  receiptCode?: string;
  status?: "PENDING" | "VERIFIED" | "VOIDED";
  query?: string;
  dateFrom?: Date;
  dateTo?: Date;
  cursor?: string;
  limit?: number;
};

export async function listReceipts(userId: string, role: AppRole, options: ReceiptListOptions = {}) {
  const limit = normalizePageLimit(options.limit);
  const cursorId = decodeCursor(options.cursor);
  const where: Prisma.ReceiptWhereInput = role === "STUDENT" ? { studentId: userId } : {};
  if (options.receiptCode) where.receiptCode = options.receiptCode;
  if (options.status) where.status = options.status as PrismaReceiptStatus;
  if (options.dateFrom || options.dateTo) {
    where.issuedAt = {
      ...(options.dateFrom ? { gte: options.dateFrom } : {}),
      ...(options.dateTo ? { lte: options.dateTo } : {})
    };
  }
  if (options.query?.trim()) {
    const query = options.query.trim();
    where.OR = [
      { receiptCode: { contains: query, mode: "insensitive" } },
      { reservation: { is: { referenceCode: { contains: query, mode: "insensitive" } } } },
      ...(role === "STUDENT" ? [] : [{
        student: {
          is: {
            OR: [
              { fullName: { contains: query, mode: "insensitive" as const } },
              { email: { contains: query, mode: "insensitive" as const } },
              { studentNumber: { contains: query, mode: "insensitive" as const } }
            ]
          }
        }
      }])
    ];
  }

  const rows = await prisma.receipt.findMany({
    where,
    select: receiptRecordSelect,
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    take: limit + 1
  });
  return createPage(rows.map(mapPrismaReceipt), limit);
}

export async function getReceipt(userId: string, role: AppRole, receiptId: string) {
  const receipt = await prisma.receipt.findFirst({
    where: { id: receiptId, ...(role === "STUDENT" ? { studentId: userId } : {}) },
    select: receiptRecordSelect
  });
  if (!receipt) throw new HttpError(404, "Receipt not found.");
  return mapPrismaReceipt(receipt);
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
  await publishReceiptCreated({ receiptId: receipt.id, studentId: receipt.studentId, status: receipt.status });

  await createNotificationBestEffort({
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
  await publishReceiptCreated({ receiptId: receipt.id, studentId: receipt.studentId, status: receipt.status });

  await Promise.all([
    createNotificationBestEffort({
      userId: reservation.student_id,
      type: "RECEIPT",
      title: "Digital receipt generated",
      message: `${receipt.receiptCode} was created for ${reservation.reference_code} and is waiting for verification.`,
      actionUrl: "/student/receipts"
    }),
    createNotificationsForRolesBestEffort(["STAFF", "ADMIN"], {
      type: "RECEIPT",
      title: "Receipt needs verification",
      message: `${receipt.receiptCode} was generated for ${reservation.reference_code}.`,
      actionUrl: `/staff/receipt-verification?receiptId=${encodeURIComponent(receipt.id)}`
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
  return updateReceiptStatusInTransaction({
    receiptId,
    actorId: verifiedById,
    nextStatus: "VERIFIED"
  });
}

export async function voidReceipt(receiptId: string, voidedById: string, reason?: string) {
  return updateReceiptStatusInTransaction({
    receiptId,
    actorId: voidedById,
    nextStatus: "VOIDED",
    reason: reason?.trim() || null
  });
}

async function updateReceiptStatusInTransaction(input: {
  receiptId: string;
  actorId: string;
  nextStatus: "VERIFIED" | "VOIDED";
  reason?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.receipt.findUnique({
      where: { id: input.receiptId },
      select: receiptRecordSelect
    });
    if (!current) throw new HttpError(404, "Receipt not found.");
    if (input.nextStatus === "VERIFIED" && current.status === "VOIDED") {
      throw new HttpError(400, "Voided receipts cannot be verified.");
    }
    if (current.status === input.nextStatus) return mapPrismaReceipt(current);

    const now = new Date();
    const receipt = await tx.receipt.update({
      where: { id: input.receiptId },
      data: {
        status: input.nextStatus,
        issuedById: input.actorId,
        ...(input.nextStatus === "VERIFIED" ? { issuedAt: now } : {}),
        updatedAt: now
      },
      select: receiptRecordSelect
    });

    await tx.outboxEvent.create({
      data: {
        type: OUTBOX_EVENT_TYPES.receiptStatusChanged,
        entityId: receipt.id,
        payload: {
          actorId: input.actorId,
          studentId: receipt.studentId,
          receiptCode: receipt.receiptCode,
          reservationId: receipt.reservationId,
          totalAmount: receipt.totalAmount.toString(),
          previousStatus: current.status,
          nextStatus: input.nextStatus,
          reason: input.reason ?? null
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
        payload: { action: "status-changed", previousStatus: current.status, nextStatus: input.nextStatus }
      },
      {
        topic: REALTIME_TOPICS.dashboard,
        entityId: receipt.id,
        audienceRoles: ["STAFF", "ADMIN"],
        payload: { action: "receipt-status-changed", nextStatus: input.nextStatus }
      },
      {
        topic: REALTIME_TOPICS.reports,
        entityId: receipt.id,
        audienceRoles: ["STAFF", "ADMIN"],
        payload: { action: "receipt-status-changed", nextStatus: input.nextStatus }
      }
    ]);

    return mapPrismaReceipt(receipt);
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 10_000
  }).catch((error) => {
    if (error instanceof HttpError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(
        409,
        "Receipt changed while processing. Please refresh and try again.",
        "RECEIPT_STATUS_CONFLICT",
        { retryable: true }
      );
    }
    throw error;
  });
}
