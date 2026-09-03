import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env" });

const APPLY_CONFIRMATION = "I_CONFIRM_WESCOMM_RECEIPT_REPAIR";
const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();
let servicePrisma = null;

try {
  const missing = await prisma.reservation.findMany({
    where: { status: "COMPLETED", receipt: null },
    select: { id: true, referenceCode: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });

  if (!apply) {
    console.log(JSON.stringify({ apply: false, missingCount: missing.length, reservations: missing }, null, 2));
  } else {
    if (process.env.WESCOMM_RECEIPT_REPAIR_CONFIRMATION !== APPLY_CONFIRMATION) {
      throw new Error(`Set WESCOMM_RECEIPT_REPAIR_CONFIRMATION=${APPLY_CONFIRMATION} to use --apply.`);
    }

    const actorId = process.env.RECEIPT_REPAIR_ACTOR_ID?.trim();
    if (!actorId) throw new Error("RECEIPT_REPAIR_ACTOR_ID is required with --apply.");
    const actor = await prisma.profile.findUnique({ where: { id: actorId }, select: { role: true } });
    if (!actor || !["STAFF", "ADMIN"].includes(actor.role)) {
      throw new Error("RECEIPT_REPAIR_ACTOR_ID must identify an existing STAFF or ADMIN profile.");
    }

    const [{ updateReservationStatus }, servicePrismaModule] = await Promise.all([
      import("../dist/services/reservation.service.js"),
      import("../dist/lib/prisma.js")
    ]);
    servicePrisma = servicePrismaModule.prisma;
    const repaired = [];
    for (const reservation of missing) {
      const result = await updateReservationStatus(reservation.id, "COMPLETED", actorId);
      repaired.push({
        reservationId: reservation.id,
        referenceCode: reservation.referenceCode,
        receiptId: result.receipt?.id ?? null
      });
    }

    console.log(JSON.stringify({ apply: true, repairedCount: repaired.length, repaired }, null, 2));
  }
} finally {
  await Promise.all([
    prisma.$disconnect(),
    servicePrisma?.$disconnect()
  ]);
}
