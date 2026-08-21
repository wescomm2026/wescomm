import assert from "node:assert/strict";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env" });

const productionOrigin = "https://wescomm.vercel.app";
const mutationGate = process.env.E2E_LIVE_MUTATION_SMOKE;
const maintenanceSecret = process.env.PAYMENT_MAINTENANCE_SECRET;

if (mutationGate !== "true") {
  throw new Error("Set E2E_LIVE_MUTATION_SMOKE=true to run the production outbox retry probe.");
}
if (!maintenanceSecret) {
  throw new Error("PAYMENT_MAINTENANCE_SECRET is required.");
}

const prisma = new PrismaClient();
const eventId = crypto.randomUUID();
const syntheticStudentId = crypto.randomUUID();
const syntheticEntityId = crypto.randomUUID();

async function invokeMaintenance() {
  const response = await fetch(`${productionOrigin}/api/payments/maintenance`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${maintenanceSecret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ limit: 50 })
  });
  const body = await response.json();
  assert.equal(response.status, 200, `Maintenance returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function readProbe() {
  const event = await prisma.outboxEvent.findUnique({
    where: { id: eventId },
    select: {
      attemptCount: true,
      availableAt: true,
      lockedAt: true,
      processedAt: true,
      lastError: true
    }
  });
  assert.ok(event, "Synthetic outbox event disappeared before verification.");
  return event;
}

try {
  await prisma.outboxEvent.create({
    data: {
      id: eventId,
      type: "RESERVATION_STATUS_CHANGED",
      entityId: syntheticEntityId,
      payload: {
        actorId: null,
        studentId: syntheticStudentId,
        referenceCode: "WES-OUTBOX-RETRY-PROBE",
        previousStatus: "PENDING",
        nextStatus: "CONFIRMED",
        notificationTitle: "Outbox retry probe",
        notificationMessage: "Synthetic QA event; this must never reach a real user.",
        notificationType: "SYSTEM"
      }
    }
  });

  const firstMaintenance = await invokeMaintenance();
  const firstAttempt = await readProbe();
  assert.equal(firstAttempt.attemptCount, 1);
  assert.equal(firstAttempt.processedAt, null);
  assert.equal(firstAttempt.lockedAt, null);
  assert.ok(firstAttempt.lastError, "A failed event must retain its error.");
  assert.ok(firstAttempt.availableAt.getTime() > Date.now(), "A failed event must be rescheduled with backoff.");

  await prisma.outboxEvent.update({
    where: { id: eventId },
    data: { availableAt: new Date(0) }
  });

  const secondMaintenance = await invokeMaintenance();
  const secondAttempt = await readProbe();
  assert.equal(secondAttempt.attemptCount, 2);
  assert.equal(secondAttempt.processedAt, null);
  assert.equal(secondAttempt.lockedAt, null);
  assert.ok(secondAttempt.lastError, "A retried failure must retain its latest error.");
  assert.ok(secondAttempt.availableAt.getTime() > Date.now(), "A retried failure must receive a new backoff.");

  console.log(JSON.stringify({
    ok: true,
    eventId,
    attempts: secondAttempt.attemptCount,
    firstWorkerResult: firstMaintenance.outbox,
    secondWorkerResult: secondMaintenance.outbox,
    unlockedAfterFailure: secondAttempt.lockedAt === null,
    retainedForRetry: secondAttempt.processedAt === null && Boolean(secondAttempt.lastError)
  }));
} finally {
  await prisma.outboxEvent.deleteMany({ where: { id: eventId } });
  await prisma.$disconnect();
}
