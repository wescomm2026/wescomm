import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import { assertPickupWindowCapacity } from "../services/pickup-capacity.service.js";
import { HttpError } from "../utils/http-error.js";

async function reserveWithSerializationRetry(input: {
  studentId: string;
  referenceCode: string;
  pickupStart: Date;
  pickupEnd: Date;
}) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        await assertPickupWindowCapacity({
          tx: transaction,
          pickupStart: input.pickupStart,
          pickupEnd: input.pickupEnd,
          slot: { capacity: 1 }
        });
        return transaction.reservation.create({
          data: {
            studentId: input.studentId,
            referenceCode: input.referenceCode,
            pickupStart: input.pickupStart,
            pickupEnd: input.pickupEnd
          },
          select: { id: true }
        });
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 20_000
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2034"
        && attempt < 6
      ) continue;
      throw error;
    }
  }
  throw new Error("Pickup capacity retry exhausted unexpectedly.");
}

test("PostgreSQL capacity one admits exactly one of three simultaneous pickup requests", async () => {
  const suffix = randomUUID();
  const studentIds = Array.from({ length: 3 }, () => randomUUID());
  const pickupStart = new Date("2030-01-15T01:00:00.000Z");
  const pickupEnd = new Date("2030-01-15T02:00:00.000Z");

  try {
    await prisma.profile.createMany({
      data: studentIds.map((id, index) => ({
        id,
        fullName: `Pickup Capacity Student ${index}`,
        email: `pickup-capacity-${suffix}-${index}@example.invalid`,
        role: "STUDENT" as const
      }))
    });

    const outcomes = await Promise.allSettled(studentIds.map((studentId, index) => (
      reserveWithSerializationRetry({
        studentId,
        referenceCode: `CAP-${suffix.slice(0, 8)}-${index}`,
        pickupStart,
        pickupEnd
      })
    )));
    const successes = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");

    assert.equal(successes.length, 1);
    assert.equal(failures.length, 2);
    assert.ok(failures.every((outcome) => (
      outcome.reason instanceof HttpError && outcome.reason.code === "PICKUP_SLOT_FULL"
    )));
    assert.equal(await prisma.reservation.count({
      where: { pickupStart, pickupEnd, studentId: { in: studentIds } }
    }), 1);
  } finally {
    await prisma.profile.deleteMany({ where: { id: { in: studentIds } } });
  }
});
