import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const REQUIRED_CONFIRMATION = "I_CONFIRM_LOCAL_WESCOMM_TEST_DATABASE";

function failClosed(message) {
  console.error(`PayMongo database test refused to run: ${message}`);
  process.exit(1);
}

const confirmation = process.env.WESCOMM_RUN_ISOLATED_DB_TESTS;
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

if (confirmation !== REQUIRED_CONFIRMATION) {
  failClosed(
    `set WESCOMM_RUN_ISOLATED_DB_TESTS=${REQUIRED_CONFIRMATION} only for an isolated local test database.`,
  );
}
if (!testDatabaseUrl) {
  failClosed("TEST_DATABASE_URL is required; DATABASE_URL and DIRECT_URL are intentionally ignored.");
}

let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(testDatabaseUrl);
} catch {
  failClosed("TEST_DATABASE_URL is not a valid PostgreSQL URL.");
}

if (!new Set(["postgres:", "postgresql:"]).has(parsedDatabaseUrl.protocol)) {
  failClosed("TEST_DATABASE_URL must use the postgres or postgresql protocol.");
}

const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
if (!localHosts.has(parsedDatabaseUrl.hostname.toLowerCase())) {
  failClosed("only a loopback PostgreSQL host (127.0.0.1, localhost, or ::1) is allowed.");
}

const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, ""));
const normalizedDatabaseName = databaseName.toLowerCase();
if (
  !normalizedDatabaseName.includes("wescomm")
  || !/(^|[_-])(test|ci|sandbox)([_-]|$)/.test(normalizedDatabaseName)
) {
  failClosed("the database name must contain both 'wescomm' and a test/ci/sandbox marker.");
}
if ((parsedDatabaseUrl.searchParams.get("schema") ?? "public") !== "public") {
  failClosed("the isolated verifier requires schema=public to match the checked migrations.");
}

// Replace every inherited endpoint before importing application modules. This
// prevents dotenv or a developer shell from redirecting the verifier elsewhere.
process.env.NODE_ENV = "test";
process.env.DOTENV_CONFIG_PATH = "__wescomm_isolated_test_no_env_file__";
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
delete process.env.VERCEL_TARGET_ENV;
process.env.DATABASE_URL = testDatabaseUrl;
process.env.DIRECT_URL = testDatabaseUrl;
process.env.FRONTEND_ORIGIN = "http://127.0.0.1:3000";
process.env.FRONTEND_ORIGINS = "http://127.0.0.1:3000";
process.env.PAYMONGO_RETURN_ORIGIN = "http://127.0.0.1:3000";
process.env.PAYMONGO_ENABLED = "false";
process.env.PAYMONGO_SECRET_KEY = "";
process.env.PAYMONGO_WEBHOOK_SECRET = "";
process.env.PAYMONGO_LIVEMODE = "false";
process.env.VAPID_PUBLIC_KEY = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.DATA_ENCRYPTION_KEYS = "";
process.env.DATA_ENCRYPTION_CURRENT_VERSION = "v1";
process.env.AUTH_ENABLE_DEV_LOGIN = "false";
process.env.AUTH_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN = "false";
process.env.NEXT_PUBLIC_ENABLE_TEMP_PRODUCTION_STAFF_LOGIN = "false";

const { PrismaClient } = await import("@prisma/client");
const safetyClient = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

let mockServer;
let appPrisma;
let fixtureStudentId;
let fixtureEventIds = [];
let fixtureReservationIds = [];
let fixturePaymentIds = [];
let failure;

function makePaymentEvent({
  eventId,
  paymentId,
  attemptId,
  reservationId,
  referenceCode,
  checkoutSessionId,
  amountCentavos,
  paidAtSeconds,
}) {
  return {
    providerEventId: eventId,
    eventType: "checkout_session.payment.paid",
    livemode: false,
    checkoutSession: {
      id: checkoutSessionId,
      referenceNumber: referenceCode,
      metadata: {
        online_payment_id: paymentId,
        online_payment_attempt_id: attemptId,
        reservation_id: reservationId,
      },
      paymentIntentId: `pi_test_${eventId}`,
      payments: [{
        id: `pay_test_${eventId}`,
        status: "paid",
        amountCentavos,
        currency: "PHP",
        feeCentavos: 275,
        netAmountCentavos: amountCentavos - 275,
        paymentIntentId: `pi_test_${eventId}`,
        sourceType: "gcash",
        paidAtSeconds,
      }],
    },
  };
}

function payloadHash(label) {
  return createHash("sha256").update(label).digest("hex");
}

try {
  const identityRows = await safetyClient.$queryRawUnsafe(`
    SELECT
      current_database() AS database_name,
      inet_server_addr()::text AS server_address
  `);
  const identity = identityRows[0];
  const serverAddress = identity?.server_address ?? "";
  const loopbackServer = identity?.server_address === null
    || serverAddress === "::1"
    || /^127\./.test(serverAddress);
  const githubServiceContainer = process.env.GITHUB_ACTIONS === "true" && (
    /^10\./.test(serverAddress)
    || /^192\.168\./.test(serverAddress)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(serverAddress)
  );

  assert.equal(identity?.database_name, databaseName, "connected database name differs from TEST_DATABASE_URL");
  assert.ok(
    loopbackServer || githubServiceContainer,
    `PostgreSQL reported a non-loopback server address: ${identity?.server_address ?? "unknown"}`,
  );

  const migrationRows = await safetyClient.$queryRawUnsafe(`
    SELECT migration_name
    FROM public._prisma_migrations
    WHERE migration_name = '20260801000000_add_paymongo_checkout_payments'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  `);
  assert.equal(
    migrationRows.length,
    1,
    "PayMongo migration is not applied. Migrate a fresh local test database before running this verifier.",
  );

  // Audit logs and in-app notifications commit atomically with the webhook.
  // Only post-commit Web Push is best-effort; route it to a local rejecting
  // stub so this test can never contact Supabase or another external service.
  mockServer = createServer((request, response) => {
    request.resume();
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: "intentional local test stub" }));
  });
  await new Promise((resolve, reject) => {
    mockServer.once("error", reject);
    mockServer.listen(0, "127.0.0.1", resolve);
  });
  const mockAddress = mockServer.address();
  assert.ok(mockAddress && typeof mockAddress === "object");
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${mockAddress.port}`;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "wescomm-isolated-test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "wescomm-isolated-test-service-role-key";

  const [{ processPaymongoWebhook }, prismaModule] = await Promise.all([
    import("../dist/services/paymongo-webhook.service.js"),
    import("../dist/lib/prisma.js"),
  ]);
  appPrisma = prismaModule.prisma;

  const suffix = randomUUID().replaceAll("-", "");
  fixtureStudentId = randomUUID();
  const paidReservationId = randomUUID();
  const paidPaymentId = randomUUID();
  const paidAttemptId = randomUUID();
  const lateReservationId = randomUUID();
  const latePaymentId = randomUUID();
  const lateAttemptId = randomUUID();
  const rejectedReservationId = randomUUID();
  const rejectedPaymentId = randomUUID();
  const rejectedAttemptId = randomUUID();
  const paidEventId = `evt_paid_${suffix}`;
  const duplicateEventId = paidEventId;
  const lateEventId = `evt_late_${suffix}`;
  const rejectedEventId = `evt_rejected_${suffix}`;
  fixtureEventIds = [paidEventId, duplicateEventId, lateEventId, rejectedEventId];
  fixtureReservationIds = [paidReservationId, lateReservationId, rejectedReservationId];
  fixturePaymentIds = [paidPaymentId, latePaymentId, rejectedPaymentId];
  const amountCentavos = 12_345;
  const paidAtSeconds = Math.floor(Date.now() / 1_000);
  const checkoutExpiresAt = new Date(Date.now() + 30 * 60 * 1_000);

  await appPrisma.profile.create({
    data: {
      id: fixtureStudentId,
      fullName: "PayMongo isolated test student",
      email: `paymongo-db-${suffix}@example.test`,
      studentNumber: `PM-${suffix.slice(0, 12)}`,
      role: "STUDENT",
    },
  });

  const fixtures = [
    {
      reservationId: paidReservationId,
      paymentId: paidPaymentId,
      attemptId: paidAttemptId,
      referenceCode: `PM-PAID-${suffix}`,
      paymentStatus: "AWAITING_PAYMENT",
      checkoutSessionId: `cs_paid_${suffix}`,
      cancelledAt: null,
    },
    {
      reservationId: lateReservationId,
      paymentId: latePaymentId,
      attemptId: lateAttemptId,
      referenceCode: `PM-LATE-${suffix}`,
      paymentStatus: "CANCELLED",
      checkoutSessionId: `cs_late_${suffix}`,
      cancelledAt: new Date(),
    },
    {
      reservationId: rejectedReservationId,
      paymentId: rejectedPaymentId,
      attemptId: rejectedAttemptId,
      referenceCode: `PM-REJECT-${suffix}`,
      paymentStatus: "AWAITING_PAYMENT",
      checkoutSessionId: `cs_rejected_${suffix}`,
      cancelledAt: null,
    },
  ];

  for (const fixture of fixtures) {
    await appPrisma.reservation.create({
      data: {
        id: fixture.reservationId,
        studentId: fixtureStudentId,
        referenceCode: fixture.referenceCode,
        status: "PENDING",
        paymentMethod: "PAYMONGO_GCASH",
        totalAmount: "123.45",
      },
    });
    await appPrisma.onlinePayment.create({
      data: {
        id: fixture.paymentId,
        reservationId: fixture.reservationId,
        status: fixture.paymentStatus,
        amountCentavos,
        livemode: false,
        providerCheckoutSessionId: fixture.checkoutSessionId,
        checkoutUrl: `https://checkout.paymongo.com/${fixture.checkoutSessionId}`,
        checkoutExpiresAt,
        cancelledAt: fixture.cancelledAt,
      },
    });
    await appPrisma.onlinePaymentAttempt.create({
      data: {
        id: fixture.attemptId,
        onlinePaymentId: fixture.paymentId,
        attemptNumber: 1,
        status: "ACTIVE",
        providerIdempotencyKey: `wescomm-db-test-${fixture.attemptId}`,
        requestHash: payloadHash(`request-${fixture.attemptId}`),
        requestPayload: {
          reference_number: fixture.referenceCode,
          payment_method_types: ["gcash"],
          amount_centavos: amountCentavos,
        },
        providerCheckoutSessionId: fixture.checkoutSessionId,
        checkoutUrl: `https://checkout.paymongo.com/${fixture.checkoutSessionId}`,
        livemode: false,
        checkoutExpiresAt,
      },
    });
  }

  const paidEvent = makePaymentEvent({
    eventId: paidEventId,
    paymentId: paidPaymentId,
    attemptId: paidAttemptId,
    reservationId: paidReservationId,
    referenceCode: `PM-PAID-${suffix}`,
    checkoutSessionId: `cs_paid_${suffix}`,
    amountCentavos,
    paidAtSeconds,
  });
  const concurrentPaidResults = await Promise.all([
    processPaymongoWebhook({
      event: paidEvent,
      payloadHash: payloadHash(paidEventId),
    }),
    processPaymongoWebhook({
      event: paidEvent,
      payloadHash: payloadHash(paidEventId),
    }),
  ]);
  assert.equal(
    concurrentPaidResults.filter((result) => result.processed).length,
    1,
    "exactly one concurrent delivery must apply the paid transition",
  );
  assert.equal(
    concurrentPaidResults.filter((result) => result.duplicate).length,
    1,
    "the competing identical delivery must be acknowledged as a duplicate",
  );
  const paidResult = concurrentPaidResults.find((result) => result.processed);
  assert.deepEqual(paidResult, {
    acknowledged: true,
    duplicate: false,
    processed: true,
    rejected: false,
  });

  const paidRow = await appPrisma.onlinePayment.findUniqueOrThrow({
    where: { id: paidPaymentId },
    include: { reservation: true, webhookEvents: true },
  });
  assert.equal(paidRow.status, "PAID");
  assert.equal(paidRow.reservation.status, "PENDING", "webhook must not advance fulfillment");
  assert.equal(paidRow.webhookEvents.length, 1);
  assert.equal(paidRow.webhookEvents[0].status, "PROCESSED");
  assert.equal(paidRow.webhookEvents[0].reasonCode, null);
  const paidAttempt = await appPrisma.onlinePaymentAttempt.findUniqueOrThrow({
    where: { id: paidAttemptId },
  });
  assert.equal(paidAttempt.status, "PAID");
  assert.equal(paidAttempt.providerCheckoutSessionId, `cs_paid_${suffix}`);
  assert.equal(paidAttempt.providerPaymentIntentId, `pi_test_${paidEventId}`);
  assert.equal(paidAttempt.providerPaymentId, `pay_test_${paidEventId}`);
  assert.equal(
    await appPrisma.auditLog.count({
      where: { entityType: "online_payment", entityId: paidPaymentId, action: "ONLINE_PAYMENT_CONFIRMED" },
    }),
    1,
    "paid transition and its audit record must commit together",
  );
  assert.ok(
    await appPrisma.notification.findUnique({
      where: { dedupeKey: `payment-paid:${paidPaymentId}` },
    }),
    "paid transition must create its durable student notification",
  );

  const duplicateResult = await processPaymongoWebhook({
    event: paidEvent,
    payloadHash: payloadHash(paidEventId),
  });
  assert.equal(duplicateResult.duplicate, true);
  assert.equal(
    await appPrisma.paymongoWebhookEvent.count({ where: { providerEventId: paidEventId } }),
    1,
    "duplicate delivery must not create another event row",
  );
  assert.equal(
    await appPrisma.auditLog.count({
      where: { entityType: "online_payment", entityId: paidPaymentId },
    }),
    1,
    "duplicate delivery must not duplicate the financial audit record",
  );

  const lateEvent = makePaymentEvent({
    eventId: lateEventId,
    paymentId: latePaymentId,
    attemptId: lateAttemptId,
    reservationId: lateReservationId,
    referenceCode: `PM-LATE-${suffix}`,
    checkoutSessionId: `cs_late_${suffix}`,
    amountCentavos,
    paidAtSeconds,
  });
  const lateResult = await processPaymongoWebhook({
    event: lateEvent,
    payloadHash: payloadHash(lateEventId),
  });
  assert.equal(lateResult.processed, true);
  assert.equal(
    (await appPrisma.onlinePayment.findUniqueOrThrow({ where: { id: latePaymentId } })).status,
    "REFUND_REVIEW_REQUIRED",
    "a late payment after cancellation must be quarantined for refund review",
  );
  assert.ok(
    await appPrisma.notification.findUnique({
      where: { dedupeKey: `payment-refund-review:${latePaymentId}` },
    }),
    "late payment must create a durable refund-review notification",
  );

  const rejectedEvent = makePaymentEvent({
    eventId: rejectedEventId,
    paymentId: rejectedPaymentId,
    attemptId: rejectedAttemptId,
    reservationId: rejectedReservationId,
    referenceCode: `PM-REJECT-${suffix}`,
    checkoutSessionId: `cs_rejected_${suffix}`,
    amountCentavos: amountCentavos + 1,
    paidAtSeconds,
  });
  const rejectedResult = await processPaymongoWebhook({
    event: rejectedEvent,
    payloadHash: payloadHash(rejectedEventId),
  });
  assert.equal(rejectedResult.rejected, true);
  const rejectedRow = await appPrisma.paymongoWebhookEvent.findUniqueOrThrow({
    where: { providerEventId: rejectedEventId },
  });
  assert.equal(rejectedRow.status, "REJECTED");
  assert.equal(rejectedRow.reasonCode, "PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH");
  assert.equal(
    (await appPrisma.onlinePayment.findUniqueOrThrow({ where: { id: rejectedPaymentId } })).status,
    "AWAITING_PAYMENT",
    "a mismatched confirmation must not mark a payment paid",
  );
  assert.equal(
    await appPrisma.auditLog.count({
      where: {
        entityType: "online_payment",
        entityId: rejectedPaymentId,
        action: "ONLINE_PAYMENT_WEBHOOK_REJECTED",
      },
    }),
    1,
    "rejected confirmations must be quarantined with a durable audit record",
  );

  // Allow any detached best-effort push work to settle against the local-only
  // configuration before cleanup and shutdown.
  await new Promise((resolve) => setTimeout(resolve, 250));
  console.log("Isolated PayMongo database lifecycle verification passed.");
} catch (error) {
  failure = error;
} finally {
  if (appPrisma && fixtureEventIds.length > 0) {
    try {
      await appPrisma.paymongoWebhookEvent.deleteMany({
        where: { providerEventId: { in: [...new Set(fixtureEventIds)] } },
      });
      if (fixturePaymentIds.length > 0) {
        await appPrisma.auditLog.deleteMany({
          where: {
            entityType: "online_payment",
            entityId: { in: fixturePaymentIds },
          },
        });
        await appPrisma.onlinePaymentAttempt.deleteMany({
          where: { onlinePaymentId: { in: fixturePaymentIds } },
        });
        await appPrisma.onlinePayment.deleteMany({
          where: { id: { in: fixturePaymentIds } },
        });
      }
      if (fixtureReservationIds.length > 0) {
        await appPrisma.reservation.deleteMany({
          where: { id: { in: fixtureReservationIds } },
        });
      }
      if (fixtureStudentId) {
        await appPrisma.profile.deleteMany({ where: { id: fixtureStudentId } });
      }
    } catch (cleanupError) {
      failure ??= cleanupError;
    }
  }
  if (appPrisma) await appPrisma.$disconnect();
  await safetyClient.$disconnect();
  if (mockServer) {
    await new Promise((resolve) => mockServer.close(resolve));
  }
}

if (failure) {
  console.error("Isolated PayMongo database lifecycle verification failed.");
  console.error(failure instanceof Error ? failure.stack ?? failure.message : failure);
  process.exitCode = 1;
}
