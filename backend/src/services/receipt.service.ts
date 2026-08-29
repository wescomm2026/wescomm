import { Prisma, type ReceiptStatus as PrismaReceiptStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import {
  maskPublicPersonName,
  maskPublicReferenceCode,
  maskPublicStudentNumber,
  summarizePublicReceiptItems
} from "../domain/public-receipt.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { prisma } from "../lib/prisma.js";
import { OUTBOX_EVENT_TYPES } from "./outbox.service.js";
import { publishRealtimeEvents, REALTIME_TOPICS } from "./realtime-event.service.js";
import {
  type AppRole,
  type PaymentMethod,
  type RawProfile,
  firstRow
} from "../types/app.js";
import { HttpError } from "../utils/http-error.js";
import { createPage, decodeCursor, normalizePageLimit } from "../utils/cursor-pagination.js";
import {
  decryptSensitiveText,
  encryptSensitiveText,
  hashHighEntropyLookup
} from "../utils/field-encryption.js";

const RECEIPT_TOKEN_CONTEXT = "receipt.public-verification-token";

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

function createPublicVerificationToken() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    encrypted: encryptSensitiveText(token, RECEIPT_TOKEN_CONTEXT),
    hash: hashHighEntropyLookup(token, RECEIPT_TOKEN_CONTEXT)
  };
}

function publicVerificationUrl(encryptedToken: string | null) {
  if (!encryptedToken) return null;
  const token = decryptSensitiveText(encryptedToken, RECEIPT_TOKEN_CONTEXT);
  if (!token) return null;
  const url = new URL("/verify-receipt", env.FRONTEND_ORIGIN);
  url.hash = `v=${encodeURIComponent(token)}`;
  return url.toString();
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

const receiptRecordSelect = Prisma.validator<Prisma.ReceiptSelect>()({
  id: true,
  receiptCode: true,
  studentId: true,
  reservationId: true,
  totalAmount: true,
  paymentMethod: true,
  status: true,
  verificationHash: true,
  publicVerificationTokenEncrypted: true,
  publicVerificationTokenHash: true,
  receiptImageUrl: true,
  receiptPdfUrl: true,
  issuedById: true,
  issuedAt: true,
  verifiedAt: true,
  voidedAt: true,
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
    publicVerificationUrl: publicVerificationUrl(receipt.publicVerificationTokenEncrypted),
    receiptImageUrl: receipt.receiptImageUrl,
    receiptPdfUrl: receipt.receiptPdfUrl,
    issuedById: receipt.issuedById,
    issuedAt: receipt.issuedAt.toISOString(),
    verifiedAt: receipt.verifiedAt?.toISOString() ?? null,
    voidedAt: receipt.voidedAt?.toISOString() ?? null,
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

export type ReceiptListOptions = {
  receiptCode?: string;
  status?: "PENDING" | "VERIFIED" | "VOIDED";
  paymentChannel?: "ONLINE_GCASH" | "AT_COMMISSARY";
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
  if (options.paymentChannel === "ONLINE_GCASH") where.paymentMethod = "PAYMONGO_GCASH";
  if (options.paymentChannel === "AT_COMMISSARY") {
    where.paymentMethod = { in: ["PAY_AT_COMMISSARY", "E_WALLET_AT_PICKUP", "CASH", "GCASH"] };
  }
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

export async function verifyReceiptToken(token: string) {
  const tokenHash = hashHighEntropyLookup(token, RECEIPT_TOKEN_CONTEXT);
  const receipt = await prisma.receipt.findUnique({
    where: { publicVerificationTokenHash: tokenHash },
    select: {
      receiptCode: true,
      totalAmount: true,
      paymentMethod: true,
      status: true,
      issuedAt: true,
      student: { select: { fullName: true, studentNumber: true } },
      reservation: {
        select: {
          referenceCode: true,
          status: true,
          items: { select: { quantity: true } }
        }
      }
    }
  });
  if (!receipt) return null;
  const itemSummary = summarizePublicReceiptItems(receipt.reservation?.items);
  return {
    receiptCode: receipt.receiptCode,
    totalAmount: receipt.totalAmount.toString(),
    paymentMethod: receipt.paymentMethod,
    status: receipt.status,
    issuedAt: receipt.issuedAt.toISOString(),
    student: {
      displayName: maskPublicPersonName(receipt.student.fullName),
      studentNumber: maskPublicStudentNumber(receipt.student.studentNumber)
    },
    reservation: receipt.reservation
      ? {
          referenceCode: maskPublicReferenceCode(receipt.reservation.referenceCode),
          status: receipt.reservation.status,
          itemCount: itemSummary.itemCount,
          totalQuantity: itemSummary.totalQuantity
        }
      : null
  };
}

export async function ensureReceiptForCompletedReservationInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    reservation: {
      id: string;
      studentId: string;
      referenceCode: string;
      status: "COMPLETED";
      paymentMethod: PaymentMethod;
      totalAmount: Prisma.Decimal;
    };
    issuedById: string;
  }
) {
  const receiptCode = createReceiptCode();
  const verificationHash = createVerificationHash();
  const publicToken = createPublicVerificationToken();
  const receipt = await tx.receipt.upsert({
    where: { reservationId: input.reservation.id },
    update: {},
    create: {
      receiptCode,
      verificationHash,
      publicVerificationTokenEncrypted: publicToken.encrypted,
      publicVerificationTokenHash: publicToken.hash,
      studentId: input.reservation.studentId,
      reservationId: input.reservation.id,
      totalAmount: input.reservation.totalAmount,
      paymentMethod: input.reservation.paymentMethod,
      issuedById: input.issuedById,
      status: "PENDING"
    },
    select: receiptRecordSelect
  });
  const created = receipt.verificationHash === verificationHash;

  if (created) {
    await tx.outboxEvent.create({
      data: {
        type: OUTBOX_EVENT_TYPES.receiptCreated,
        entityId: receipt.id,
        payload: {
          actorId: input.issuedById,
          studentId: receipt.studentId,
          receiptCode: receipt.receiptCode,
          reservationId: input.reservation.id,
          referenceCode: input.reservation.referenceCode,
          totalAmount: receipt.totalAmount.toString(),
          status: receipt.status
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
        payload: { action: "created", status: receipt.status }
      },
      {
        topic: REALTIME_TOPICS.dashboard,
        entityId: receipt.id,
        audienceRoles: ["STAFF", "ADMIN"],
        payload: { action: "receipt-created", status: receipt.status }
      },
      {
        topic: REALTIME_TOPICS.reports,
        entityId: receipt.id,
        audienceRoles: ["STAFF", "ADMIN"],
        payload: { action: "receipt-created", status: receipt.status }
      }
    ]);
  }

  return { receipt: mapPrismaReceipt(receipt), created };
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
        ...(input.nextStatus === "VERIFIED" ? { verifiedAt: now, voidedAt: null } : { voidedAt: now }),
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

export async function backfillReceiptPublicVerificationTokens(input: { limit?: number } = {}) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const rows = await prisma.receipt.findMany({
    where: { publicVerificationTokenHash: null },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true }
  });
  let updated = 0;
  for (const row of rows) {
    const token = createPublicVerificationToken();
    const result = await prisma.receipt.updateMany({
      where: { id: row.id, publicVerificationTokenHash: null },
      data: {
        publicVerificationTokenEncrypted: token.encrypted,
        publicVerificationTokenHash: token.hash
      }
    });
    updated += result.count;
  }
  return { updated, remainingPossible: rows.length === limit };
}
