import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import { updateReservationStatus } from "../services/reservation.service.js";

test("PostgreSQL keeps completion and its reservation receipt atomic and idempotent", async () => {
  const suffix = randomUUID();
  const studentId = randomUUID();
  const staffId = randomUUID();
  const reservationIds = [randomUUID(), randomUUID()];
  const referenceCodes = [`RCT-ATOMIC-${suffix}`, `RCT-RACE-${suffix}`];

  try {
    await prisma.profile.createMany({
      data: [
        { id: studentId, fullName: "Receipt Integrity Student", email: `receipt-student-${suffix}@example.invalid`, role: "STUDENT" },
        { id: staffId, fullName: "Receipt Integrity Staff", email: `receipt-staff-${suffix}@example.invalid`, role: "STAFF" }
      ]
    });
    await prisma.reservation.createMany({
      data: reservationIds.map((id, index) => ({
        id,
        studentId,
        referenceCode: referenceCodes[index],
        status: "READY_FOR_PICKUP" as const,
        paymentMethod: "CASH" as const,
        totalAmount: index === 0 ? 321.45 : 98.76
      }))
    });

    await assert.rejects(updateReservationStatus(reservationIds[0], "COMPLETED", randomUUID()));
    assert.equal(
      (await prisma.reservation.findUniqueOrThrow({ where: { id: reservationIds[0] }, select: { status: true } })).status,
      "READY_FOR_PICKUP"
    );
    assert.equal(await prisma.receipt.count({ where: { reservationId: reservationIds[0] } }), 0);

    const completed = await updateReservationStatus(reservationIds[0], "COMPLETED", staffId);
    assert.equal(completed.reservation.status, "COMPLETED");
    assert.equal(completed.receipt?.studentId, studentId);
    assert.equal(completed.receipt?.totalAmount, "321.45");
    assert.equal(completed.receipt?.paymentMethod, "CASH");
    assert.equal(completed.receipt?.status, "PENDING");

    const replay = await updateReservationStatus(reservationIds[0], "COMPLETED", staffId);
    assert.equal(replay.receipt?.id, completed.receipt?.id);
    assert.equal(await prisma.receipt.count({ where: { reservationId: reservationIds[0] } }), 1);

    await prisma.receipt.delete({ where: { id: completed.receipt!.id } });
    const repaired = await updateReservationStatus(reservationIds[0], "COMPLETED", staffId);
    assert.ok(repaired.receipt?.id);
    assert.notEqual(repaired.receipt?.id, completed.receipt?.id);
    assert.equal(await prisma.receipt.count({ where: { reservationId: reservationIds[0] } }), 1);

    const concurrent = await Promise.allSettled([
      updateReservationStatus(reservationIds[1], "COMPLETED", staffId),
      updateReservationStatus(reservationIds[1], "COMPLETED", staffId)
    ]);
    assert.ok(concurrent.some((result) => result.status === "fulfilled"));
    assert.equal(
      (await prisma.reservation.findUniqueOrThrow({ where: { id: reservationIds[1] }, select: { status: true } })).status,
      "COMPLETED"
    );
    assert.equal(await prisma.receipt.count({ where: { reservationId: reservationIds[1] } }), 1);
  } finally {
    const receipts = await prisma.receipt.findMany({
      where: { reservationId: { in: reservationIds } },
      select: { id: true }
    });
    const entityIds = [...reservationIds, ...receipts.map((receipt) => receipt.id)];
    await prisma.realtimeEvent.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.outboxEvent.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.receipt.deleteMany({ where: { reservationId: { in: reservationIds } } });
    await prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } });
    await prisma.profile.deleteMany({ where: { id: { in: [studentId, staffId] } } });
  }
});
