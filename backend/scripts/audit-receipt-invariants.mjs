import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env" });

const prisma = new PrismaClient();

try {
  const [
    duplicateReservationReceipts,
    completedWithoutReceipt,
    completedWithoutPayment,
    inconsistentReservationReceipts,
    receiptsMissingPublicVerificationToken
  ] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        "reservation_id" AS "reservationId",
        COUNT(*)::integer AS "receiptCount",
        ARRAY_AGG("id" ORDER BY "created_at", "id") AS "receiptIds"
      FROM "receipts"
      WHERE "reservation_id" IS NOT NULL
      GROUP BY "reservation_id"
      HAVING COUNT(*) > 1
      ORDER BY "reservation_id"
    `,
    prisma.$queryRaw`
      SELECT
        reservation."id",
        reservation."reference_code" AS "referenceCode",
        reservation."status"::text AS "reservationStatus",
        reservation."student_id" AS "studentId",
        reservation."total_amount"::text AS "totalAmount",
        reservation."payment_method"::text AS "paymentMethod"
      FROM "reservations" reservation
      WHERE reservation."status" = 'COMPLETED'::"reservation_status"
        AND NOT EXISTS (
          SELECT 1
          FROM "receipts" receipt
          WHERE receipt."reservation_id" = reservation."id"
        )
      ORDER BY reservation."created_at", reservation."id"
    `,
    prisma.$queryRaw`
      SELECT
        reservation."id",
        reservation."reference_code" AS "referenceCode",
        reservation."status"::text AS "reservationStatus",
        reservation."student_id" AS "studentId",
        reservation."total_amount"::text AS "totalAmount"
      FROM "reservations" reservation
      WHERE reservation."status" = 'COMPLETED'::"reservation_status"
        AND NOT EXISTS (
          SELECT 1
          FROM "payments" payment
          WHERE payment."reservation_id" = reservation."id"
        )
      ORDER BY reservation."created_at", reservation."id"
    `,
    prisma.$queryRaw`
      SELECT
        receipt."id" AS "receiptId",
        receipt."reservation_id" AS "reservationId",
        reservation."reference_code" AS "referenceCode",
        receipt."student_id" AS "receiptStudentId",
        reservation."student_id" AS "reservationStudentId",
        receipt."total_amount"::text AS "receiptTotalAmount",
        reservation."total_amount"::text AS "reservationTotalAmount",
        receipt."payment_method"::text AS "receiptPaymentMethod",
        payment."amount"::text AS "paymentAmount",
        payment."payment_method"::text AS "paymentMethod",
        payment."collection_channel"::text AS "collectionChannel",
        payment."status"::text AS "paymentStatus",
        receipt."status"::text AS "receiptStatus"
      FROM "receipts" receipt
      INNER JOIN "reservations" reservation ON reservation."id" = receipt."reservation_id"
      LEFT JOIN "payments" payment ON payment."reservation_id" = reservation."id"
      WHERE reservation."status" <> 'COMPLETED'::"reservation_status"
        OR receipt."student_id" <> reservation."student_id"
        OR receipt."total_amount" IS DISTINCT FROM reservation."total_amount"
        OR payment."id" IS NULL
        OR payment."amount" IS DISTINCT FROM reservation."total_amount"
        OR payment."amount" IS DISTINCT FROM receipt."total_amount"
        OR receipt."payment_method" IS DISTINCT FROM payment."payment_method"
        OR (
          receipt."status" = 'VERIFIED'::"receipt_status"
          AND payment."status" <> 'PAID'::"payment_record_status"
        )
        OR (
          receipt."status" = 'VOIDED'::"receipt_status"
          AND payment."status" NOT IN (
            'VOIDED'::"payment_record_status",
            'REFUNDED'::"payment_record_status"
          )
        )
        OR receipt."status" = 'PENDING'::"receipt_status"
      ORDER BY reservation."created_at", receipt."id"
    `,
    prisma.$queryRaw`
      SELECT
        receipt."id",
        receipt."receipt_code" AS "receiptCode"
      FROM "receipts" receipt
      WHERE receipt."public_verification_token_encrypted" IS NULL
        OR receipt."public_verification_token_hash" IS NULL
      ORDER BY receipt."created_at", receipt."id"
    `
  ]);

  const report = {
    ok: duplicateReservationReceipts.length === 0
      && completedWithoutReceipt.length === 0
      && completedWithoutPayment.length === 0
      && inconsistentReservationReceipts.length === 0
      && receiptsMissingPublicVerificationToken.length === 0,
    duplicateReservationReceipts,
    completedWithoutReceipt,
    completedWithoutPayment,
    inconsistentReservationReceipts,
    receiptsMissingPublicVerificationToken
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
