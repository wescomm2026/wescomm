import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";

const baseURL = process.env.E2E_BASE_URL?.trim() ?? "";
const supabaseURL = process.env.E2E_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = process.env.E2E_SUPABASE_ANON_KEY?.trim() ?? "";
const supabaseServiceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
const studentCount = Math.min(Math.max(Number(process.env.LOAD_TEST_STUDENTS ?? 8), 4), 12);

if (
  process.env.E2E_LIVE_LOAD_TEST !== "true"
  || baseURL !== "https://wescomm.vercel.app"
  || !supabaseURL
  || !supabaseAnonKey
  || !supabaseServiceRoleKey
) {
  throw new Error("Production load smoke requires the exact production URL, explicit opt-in, and local Supabase QA credentials.");
}

const service = createClient(supabaseURL, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const metrics = [];
const createdUserIds = [];
const reservationIds = [];
const reservationReferences = [];
const conversationIds = [];
const notificationActionUrls = [];
const operationalReservations = [];
let staffActor = null;
let adminActor = null;
let productId = "";

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(Math.ceil(sorted.length * ratio) - 1, sorted.length - 1)];
}

async function timedRequest(actor, path, options = {}, label = path) {
  const startedAt = performance.now();
  let response;
  let body = null;
  try {
    response = await fetch(`${baseURL}${path}`, {
      ...options,
      headers: {
        ...(actor?.cookie ? { Cookie: actor.cookie } : {}),
        ...(options.method && options.method !== "GET" ? { Origin: new URL(baseURL).origin } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });
    body = await response.json().catch(() => null);
    return { response, body };
  } finally {
    metrics.push({
      label,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      status: response?.status ?? 0,
      serverTiming: response?.headers.get("server-timing") ?? null,
      requestId: response?.headers.get("x-request-id") ?? null
    });
  }
}

function expectStatus(result, allowed, label) {
  assert.ok(allowed.includes(result.response.status), `${label} returned ${result.response.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function createSession(email, expectedRole) {
  const verifier = createClient(supabaseURL, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const generated = await service.auth.admin.generateLink({ type: "magiclink", email });
  assert.equal(generated.error, null, `Unable to generate QA login for ${email}.`);
  const tokenHash = generated.data.properties?.hashed_token;
  assert.ok(tokenHash, `Missing QA token for ${email}.`);
  const verified = await verifier.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  assert.equal(verified.error, null, `Unable to verify QA login for ${email}.`);
  const accessToken = verified.data.session?.access_token;
  assert.ok(accessToken, `Missing access token for ${email}.`);

  const result = await timedRequest(null, "/api/auth/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` }
  }, `session:${expectedRole.toLowerCase()}`);
  const body = expectStatus(result, [201], `session:${email}`);
  assert.equal(body.profile.role, expectedRole, `${email} has the wrong QA role.`);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, `Backend session cookie was not issued for ${email}.`);
  return { id: body.profile.id, email, role: expectedRole, cookie };
}

async function createTemporaryStudents(runId) {
  const actors = [];
  for (let index = 0; index < studentCount; index += 1) {
    const email = `wescomm.load.${runId}.${index}@wesleyan.edu.ph`;
    const created = await service.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: `WESCOMM Load Student ${index + 1}` }
    });
    assert.equal(created.error, null, `Unable to create temporary load user ${index + 1}.`);
    assert.ok(created.data.user?.id, `Temporary load user ${index + 1} has no id.`);
    createdUserIds.push(created.data.user.id);
    actors.push(await createSession(email, "STUDENT"));
  }
  return actors;
}

async function createLoadProduct(runId) {
  const categories = expectStatus(
    await timedRequest(staffActor, "/api/staff/products/categories", {}, "staff:categories"),
    [200],
    "staff categories"
  ).categories;
  assert.ok(categories.length, "Production has no category for the isolated load product.");
  const result = await timedRequest(staffActor, "/api/staff/products", {
    method: "POST",
    body: JSON.stringify({
      categoryId: categories[0].id,
      name: `WESCOMM Load Probe ${runId}`,
      description: "Temporary controlled production concurrency probe.",
      price: 1,
      status: "IN_STOCK",
      stock: 1,
      lowStockThreshold: 0,
      notes: `Automated load probe ${runId}`
    })
  }, "staff:product-create");
  const body = expectStatus(result, [201], "load product create");
  productId = body.product.id;
  notificationActionUrls.push(`/staff/inventory?productId=${encodeURIComponent(productId)}`);
}

async function createReservation(actor, suffix) {
  const result = await timedRequest(actor, "/api/reservations", {
    method: "POST",
    headers: { "Idempotency-Key": `load-${suffix}-${crypto.randomUUID()}` },
    body: JSON.stringify({
      paymentMethod: "PAY_AT_COMMISSARY",
      items: [{ productId, quantity: 1 }]
    })
  }, "command:reservation-create");
  if (result.response.status < 400 && result.body?.reservation) {
    reservationIds.push(result.body.reservation.id);
    reservationReferences.push(result.body.reservation.referenceCode);
    notificationActionUrls.push(`/staff/reservations?query=${encodeURIComponent(result.body.reservation.referenceCode)}`);
  }
  return result;
}

async function runReadBurst(students) {
  const requests = students.flatMap((student) => [
    timedRequest(student, "/api/auth/me", {}, "read:student-auth"),
    timedRequest(student, "/api/products", {}, "read:catalog"),
    timedRequest(student, "/api/reservations?limit=20", {}, "read:student-reservations"),
    timedRequest(student, "/api/receipts?limit=20", {}, "read:student-receipts")
  ]);
  const results = await Promise.all(requests);
  results.forEach((result) => expectStatus(result, [200], "student read burst"));
}

async function runLastStockContention(students, runId) {
  const attempts = await Promise.all(students.map((student, index) => createReservation(student, `${runId}-last-${index}`)));
  const winners = attempts.filter((result) => result.response.status === 201);
  const conflicts = attempts.filter((result) => result.response.status === 409);
  assert.equal(winners.length, 1, `Last-stock contention produced ${winners.length} successful reservations.`);
  assert.equal(conflicts.length, students.length - 1, "Every losing last-stock request must return a controlled 409.");
  assert.equal(attempts.some((result) => result.response.status >= 500), false, "Last-stock contention produced a server error.");

  const winner = winners[0];
  const winnerActor = students[attempts.indexOf(winner)];
  const winnerId = winner.body.reservation.id;
  const cancelled = await timedRequest(winnerActor, `/api/reservations/${winnerId}/cancel`, {
    method: "POST"
  }, "command:last-stock-cancel");
  expectStatus(cancelled, [200], "last-stock winner cancellation");
}

async function runOperationalConcurrency(students, runId) {
  const restock = await timedRequest(staffActor, `/api/staff/products/${productId}/restock`, {
    method: "POST",
    body: JSON.stringify({ mode: "add", quantity: students.length - 1, notes: `Operational load phase ${runId}` })
  }, "command:load-product-restock");
  expectStatus(restock, [200], "load product restock");

  const [reservationResults, reportResults] = await Promise.all([
    Promise.all(students.map((student, index) => createReservation(student, `${runId}-ops-${index}`))),
    Promise.all([
      ...Array.from({ length: 6 }, () => timedRequest(adminActor, "/api/admin/reports/summary", {}, "read:admin-reports")),
      ...students.map((student) => timedRequest(student, "/api/reservations?limit=20", {}, "read:active-student-dashboard"))
    ])
  ]);
  reservationResults.forEach((result) => expectStatus(result, [201], "operational reservation create"));
  reportResults.forEach((result) => expectStatus(result, [200], "report/dashboard during reservations"));

  reservationResults.forEach((result, index) => operationalReservations.push({
    id: result.body.reservation.id,
    actor: students[index],
    status: "PENDING"
  }));

  const [confirmResults, concurrentReports] = await Promise.all([
    Promise.all(operationalReservations.map((reservation) => timedRequest(
      staffActor,
      `/api/reservations/${reservation.id}/status`,
      { method: "PATCH", body: JSON.stringify({ status: "CONFIRMED" }) },
      "command:staff-confirm"
    ))),
    Promise.all(Array.from({ length: 4 }, () => timedRequest(adminActor, "/api/admin/reports/summary", {}, "read:admin-reports-active")))
  ]);
  confirmResults.forEach((result, index) => {
    expectStatus(result, [200], "concurrent staff confirm");
    operationalReservations[index].status = "CONFIRMED";
  });
  concurrentReports.forEach((result) => expectStatus(result, [200], "reports during staff updates"));

  const cancellations = await Promise.all(operationalReservations.map((reservation) => timedRequest(
    staffActor,
    `/api/reservations/${reservation.id}/status`,
    { method: "PATCH", body: JSON.stringify({ status: "CANCELLED" }) },
    "command:staff-cancel"
  )));
  cancellations.forEach((result, index) => {
    expectStatus(result, [200], "concurrent staff cancellation");
    operationalReservations[index].status = "CANCELLED";
  });
}

async function runSupportConcurrency(students, runId) {
  const participants = students.slice(0, Math.min(students.length, 4));
  const created = await Promise.all(participants.map((student, index) => timedRequest(student, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ subject: `Load support ${runId}-${index}`, message: "Controlled simultaneous support probe." })
  }, "command:support-create")));
  const conversations = created.map((result) => {
    const body = expectStatus(result, [201], "support conversation create");
    conversationIds.push(body.conversation.id);
    notificationActionUrls.push(`/staff/messages?conversationId=${encodeURIComponent(body.conversation.id)}`);
    return body.conversation;
  });

  const handoffs = await Promise.all(conversations.map((conversation, index) => timedRequest(
    participants[index],
    `/api/conversations/${conversation.id}/handoff`,
    { method: "POST", body: JSON.stringify({ reason: "Controlled production load test." }) },
    "command:support-handoff"
  )));
  handoffs.forEach((result) => expectStatus(result, [200], "support handoff"));

  const accepts = await Promise.all(conversations.map((conversation) => timedRequest(
    staffActor,
    `/api/conversations/${conversation.id}/accept`,
    { method: "POST" },
    "command:support-accept"
  )));
  accepts.forEach((result) => expectStatus(result, [200], "support accept"));

  const simultaneousMessages = conversations.flatMap((conversation, index) => [
    timedRequest(participants[index], `/api/conversations/${conversation.id}/messages`, {
      method: "POST", body: JSON.stringify({ message: "Student-side simultaneous reply." })
    }, "command:support-student-message"),
    timedRequest(staffActor, `/api/conversations/${conversation.id}/messages`, {
      method: "POST", body: JSON.stringify({ message: "Staff-side simultaneous reply." })
    }, "command:support-staff-message")
  ]);
  (await Promise.all(simultaneousMessages)).forEach((result) => expectStatus(result, [201], "simultaneous support message"));

  const resolves = await Promise.all(conversations.map((conversation) => timedRequest(
    staffActor,
    `/api/conversations/${conversation.id}/status`,
    { method: "PATCH", body: JSON.stringify({ status: "RESOLVED" }) },
    "command:support-resolve"
  )));
  resolves.forEach((result) => expectStatus(result, [200], "support resolve"));
}

async function cleanup() {
  if (staffActor) {
    for (const reservation of operationalReservations) {
      if (!["CANCELLED", "COMPLETED", "NO_SHOW"].includes(reservation.status)) {
        await timedRequest(staffActor, `/api/reservations/${reservation.id}/status`, {
          method: "PATCH", body: JSON.stringify({ status: "CANCELLED" })
        }, "cleanup:reservation-cancel").catch(() => undefined);
      }
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const notificationIds = [];
  if (notificationActionUrls.length) {
    const notificationRows = await service
      .from("notifications")
      .select("id")
      .in("action_url", [...new Set(notificationActionUrls)]);
    notificationIds.push(...(notificationRows.data ?? []).map((row) => row.id));
    await service.from("notifications").delete().in("action_url", [...new Set(notificationActionUrls)]);
  }
  const entityIds = [...new Set([
    ...reservationIds,
    ...conversationIds,
    ...notificationIds,
    ...(productId ? [productId] : [])
  ])];
  if (entityIds.length) {
    await service.from("audit_logs").delete().in("entity_id", entityIds);
    await service.from("outbox_events").delete().in("entity_id", entityIds);
    await service.from("realtime_events").delete().in("entity_id", entityIds);
  }

  for (const userId of createdUserIds) {
    await service.auth.admin.deleteUser(userId).catch(() => undefined);
  }

  if (productId) {
    await service.from("inventory_movements").delete().eq("product_id", productId);
    await service.from("product_variants").delete().eq("product_id", productId);
    await service.from("products").delete().eq("id", productId);
  }
}

function printAndValidateMetrics() {
  const failed = metrics.filter((metric) => metric.status === 0 || metric.status >= 500);
  assert.equal(failed.length, 0, `Production load probe saw server/network failures: ${JSON.stringify(failed)}`);
  const groups = new Map();
  for (const metric of metrics) {
    const values = groups.get(metric.label) ?? [];
    values.push(metric.durationMs);
    groups.set(metric.label, values);
  }
  const summary = Array.from(groups, ([label, values]) => ({
    label,
    count: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: Math.max(...values)
  })).sort((left, right) => right.p95Ms - left.p95Ms);
  const readP95 = percentile(metrics.filter((metric) => metric.label.startsWith("read:")).map((metric) => metric.durationMs), 0.95);
  const commandP95 = percentile(metrics.filter((metric) => metric.label.startsWith("command:")).map((metric) => metric.durationMs), 0.95);
  console.log(JSON.stringify({
    ok: true,
    students: studentCount,
    requests: metrics.length,
    readP95Ms: readP95,
    commandP95Ms: commandP95,
    slowestOperations: summary.slice(0, 12)
  }, null, 2));
  assert.ok(readP95 < 5_000, `Production read p95 ${readP95}ms exceeded the controlled 5s safety ceiling.`);
  assert.ok(commandP95 < 5_000, `Production command p95 ${commandP95}ms exceeded the controlled 5s safety ceiling.`);
}

const runId = `${Date.now()}`;
try {
  [staffActor, adminActor] = await Promise.all([
    createSession("staff@wesleyan.edu.ph", "STAFF"),
    createSession("admin@wesleyan.edu.ph", "ADMIN")
  ]);
  const students = await createTemporaryStudents(runId);
  await createLoadProduct(runId);
  await runReadBurst(students);
  await runLastStockContention(students, runId);
  await runOperationalConcurrency(students, runId);
  await runSupportConcurrency(students, runId);
  printAndValidateMetrics();
} finally {
  await cleanup();
}
