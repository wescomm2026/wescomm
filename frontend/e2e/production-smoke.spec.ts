import { createClient } from "@supabase/supabase-js";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL?.trim() ?? "";
const supabaseURL = process.env.E2E_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = process.env.E2E_SUPABASE_ANON_KEY?.trim() ?? "";
const supabaseServiceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
const enabled = process.env.E2E_LIVE_MUTATION_SMOKE === "true"
  && baseURL === "https://wescomm.store"
  && Boolean(supabaseURL && supabaseAnonKey && supabaseServiceRoleKey);

type AppRole = "STUDENT" | "STAFF" | "ADMIN";
type JsonRecord = Record<string, any>;

let studentId = "";
let reservationId = "";
let reservationReference = "";
let productId = "";
let receiptId = "";
let reservationStatus = "";
let stockRestored = false;
let receiptVoided = false;
let cancellationProbeId = "";
let cancellationProbeStatus = "";
let reservationVariantSummary = "";
let selectedProductOptions: Array<{ optionName: string; optionValue: string }> = [];
let restoreVariantQuantities: Array<{ variantId: string; quantity: number }> = [];

function normalizeOption(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function reservationSelection(product: JsonRecord) {
  const variants = Array.isArray(product.variants) ? product.variants as JsonRecord[] : [];
  if (!variants.length) return { summary: "", selections: [] as Array<{ optionName: string; optionValue: string }> };

  const groups = new Map<string, { optionName: string; variants: JsonRecord[] }>();
  for (const variant of variants) {
    const key = normalizeOption(variant.optionName);
    const group = groups.get(key) ?? { optionName: String(variant.optionName), variants: [] };
    group.variants.push(variant);
    groups.set(key, group);
  }

  const productStock = Number(product.stock);
  const selections: Array<{ optionName: string; optionValue: string }> = [];
  for (const group of Array.from(groups.values())) {
    const total = group.variants.reduce((sum: number, variant: JsonRecord) => sum + Number(variant.stock ?? 0), 0);
    const available = group.variants.find((variant: JsonRecord) => Number(variant.stock) >= 1);
    if (total !== productStock || !available) return null;
    selections.push({ optionName: group.optionName, optionValue: String(available.optionValue) });
  }

  return {
    summary: selections.map((selection) => `${selection.optionName}: ${selection.optionValue}`).join(", "),
    selections
  };
}

function reservationItem() {
  return {
    productId,
    quantity: 1,
    ...(reservationVariantSummary ? { variantSummary: reservationVariantSummary } : {})
  };
}

function restoreStockData(notes: string) {
  return {
    mode: "add" as const,
    quantity: 1,
    ...(restoreVariantQuantities.length ? { variantQuantities: restoreVariantQuantities } : {}),
    notes
  };
}

function originHeader() {
  return { Origin: new URL(baseURL).origin };
}

async function responseJson(response: APIResponse, label: string) {
  const body = await response.json().catch(() => null);
  expect(response.status(), `${label}: ${JSON.stringify(body)}`).toBeLessThan(400);
  console.log(JSON.stringify({
    smoke: label,
    status: response.status(),
    requestId: response.headers()["x-request-id"] ?? null,
    serverTiming: response.headers()["server-timing"] ?? null
  }));
  return body as JsonRecord;
}

async function loginWithOneTimeLink(page: Page, email: string, expectedRole: AppRole) {
  const admin = createClient(supabaseURL, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const verifier = createClient(supabaseURL, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const generated = await admin.auth.admin.generateLink({ type: "magiclink", email });
  expect(generated.error, `generate QA link for ${email}`).toBeNull();
  const tokenHash = generated.data.properties?.hashed_token;
  expect(tokenHash, `one-time token for ${email}`).toBeTruthy();

  const verified = await verifier.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash! });
  expect(verified.error, `verify QA link for ${email}`).toBeNull();
  const accessToken = verified.data.session?.access_token;
  expect(accessToken, `Supabase access token for ${email}`).toBeTruthy();

  const response = await page.request.post("/api/auth/session", {
    headers: { ...originHeader(), Authorization: `Bearer ${accessToken}` }
  });
  const body = await responseJson(response, `login:${expectedRole.toLowerCase()}`);
  expect(body.profile?.email).toBe(email);
  expect(body.profile?.role).toBe(expectedRole);
  return body.profile as JsonRecord;
}

async function logout(page: Page) {
  await page.request.post("/api/auth/logout", { headers: originHeader() }).catch(() => undefined);
}

async function startRealtimeProbe(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const events: JsonRecord[] = [];
    const stream = new EventSource("/api/realtime/events", { withCredentials: true });
    const timeout = window.setTimeout(() => {
      stream.close();
      reject(new Error("Authenticated realtime stream did not become ready."));
    }, 15_000);
    (window as unknown as { __wescommSmokeRealtime?: JsonRecord }).__wescommSmokeRealtime = { stream, events };
    stream.addEventListener("update", (event) => {
      events.push(JSON.parse((event as MessageEvent<string>).data));
    });
    stream.addEventListener("ready", () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  }));
}

async function expectRealtimeEvent(page: Page, topic: string, entityId: string) {
  await expect.poll(() => page.evaluate(({ expectedTopic, expectedEntityId }) => {
    const probe = (window as unknown as {
      __wescommSmokeRealtime?: { events: JsonRecord[] };
    }).__wescommSmokeRealtime;
    return Boolean(probe?.events.some((event) => event.topic === expectedTopic && event.entityId === expectedEntityId));
  }, { expectedTopic: topic, expectedEntityId: entityId }), { timeout: 15_000 }).toBe(true);
}

async function stopRealtimeProbe(page: Page) {
  await page.evaluate(() => {
    const holder = window as unknown as {
      __wescommSmokeRealtime?: { stream: EventSource; events: JsonRecord[] };
    };
    holder.__wescommSmokeRealtime?.stream.close();
    delete holder.__wescommSmokeRealtime;
  });
}

test.describe.serial("production mutation smoke", () => {
  test.describe.configure({ timeout: 240_000 });
  test.skip(!enabled, "Requires explicit live-smoke opt-in and local Supabase QA credentials.");

  test.afterEach(async ({ page }) => logout(page));


function futurePickupWindow(days = 2) {
  const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(target);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return {
    pickupStart: new Date(`${date}T10:00:00+08:00`).toISOString(),
    pickupEnd: new Date(`${date}T12:00:00+08:00`).toISOString()
  };
}

test("student dashboard, catalog, reservation, receipts, notifications, and support", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Run the live mutation sequence only once.");
    const student = await loginWithOneTimeLink(page, "student@wesleyan.edu.ph", "STUDENT");
    studentId = student.id;

    for (const path of ["/student/dashboard", "/student/shop", "/student/reservations", "/student/receipts", "/student/support"]) {
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response?.status(), path).toBe(200);
    }

    const [productsResponse, reservationsResponse, receiptsResponse, notificationsResponse, conversationsResponse] = await Promise.all([
      page.request.get("/api/products"),
      page.request.get("/api/reservations?limit=20"),
      page.request.get("/api/receipts?limit=20"),
      page.request.get("/api/notifications?limit=20"),
      page.request.get("/api/conversations?limit=20")
    ]);
    const productsBody = await responseJson(productsResponse, "student:catalog");
    await responseJson(reservationsResponse, "student:reservations");
    await responseJson(receiptsResponse, "student:receipts");
    await responseJson(notificationsResponse, "student:notifications");
    await responseJson(conversationsResponse, "student:support");

    const productChoice = (productsBody.products as JsonRecord[])
      .map((item) => ({ item, selection: reservationSelection(item) }))
      .find(({ item, selection }) => (
        item.isActive !== false
        && item.status !== "OUT_OF_STOCK"
        && Number(item.stock) >= 1
        && selection !== null
      ));
    const product = productChoice?.item;
    expect(product, "an in-stock QA reservation product").toBeTruthy();
    if (!product || !productChoice?.selection) {
      throw new Error("No option-consistent in-stock product is available for the production reservation smoke test.");
    }
    productId = product.id;
    reservationVariantSummary = productChoice.selection.summary;
    selectedProductOptions = productChoice.selection.selections;

    const admin = createClient(supabaseURL, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const variantResult = await admin
      .from("product_variants")
      .select("id,option_name,option_value")
      .eq("product_id", productId);
    expect(variantResult.error, "load exact QA option identifiers for reversible cleanup").toBeNull();
    const liveVariants = variantResult.data ?? [];
    restoreVariantQuantities = liveVariants.map((variant) => ({
      variantId: variant.id,
      quantity: selectedProductOptions.some((selection) => (
        normalizeOption(selection.optionName) === normalizeOption(variant.option_name)
        && normalizeOption(selection.optionValue) === normalizeOption(variant.option_value)
      )) ? 1 : 0
    }));
    if (selectedProductOptions.length) {
      expect(restoreVariantQuantities.filter((entry) => entry.quantity === 1)).toHaveLength(selectedProductOptions.length);
    }

    await startRealtimeProbe(page);

    const cancellationKey = `prod-smoke-cancel-${Date.now()}-${crypto.randomUUID()}`;
    const cancellationCreate = await page.request.post("/api/reservations", {
      headers: { ...originHeader(), "Idempotency-Key": cancellationKey },
      data: {
        paymentMethod: "PAY_AT_COMMISSARY",
        ...futurePickupWindow(),
        items: [reservationItem()]
      }
    });
    const cancellationReservation = await responseJson(cancellationCreate, "student:reservation-cancel-probe-create");
    cancellationProbeId = cancellationReservation.reservation.id;
    cancellationProbeStatus = cancellationReservation.reservation.status;
    const cancellationResponse = await page.request.post(`/api/reservations/${cancellationProbeId}/cancel`, {
      headers: originHeader()
    });
    const cancelled = await responseJson(cancellationResponse, "student:reservation-cancel");
    cancellationProbeStatus = cancelled.reservation.status;
    expect(cancellationProbeStatus).toBe("CANCELLED");
    await expectRealtimeEvent(page, "reservations", cancellationProbeId);

    const idempotencyKey = `prod-smoke-${Date.now()}-${crypto.randomUUID()}`;
    const createResponse = await page.request.post("/api/reservations", {
      headers: { ...originHeader(), "Idempotency-Key": idempotencyKey },
      data: {
        paymentMethod: "PAY_AT_COMMISSARY",
        ...futurePickupWindow(),
        items: [reservationItem()]
      }
    });
    const created = await responseJson(createResponse, "student:reservation-create");
    reservationId = created.reservation.id;
    reservationReference = created.reservation.referenceCode;
    reservationStatus = created.reservation.status;
    expect(reservationStatus).toBe("PENDING");
    expect(createResponse.headers()["idempotent-replayed"]).toBe("false");
    await expectRealtimeEvent(page, "reservations", reservationId);

    const replayResponse = await page.request.post("/api/reservations", {
      headers: { ...originHeader(), "Idempotency-Key": idempotencyKey },
      data: {
        paymentMethod: "PAY_AT_COMMISSARY",
        ...futurePickupWindow(),
        items: [reservationItem()]
      }
    });
    const replay = await responseJson(replayResponse, "student:reservation-idempotent-replay");
    expect(replay.reservation.id).toBe(reservationId);
    expect(replayResponse.headers()["idempotent-replayed"]).toBe("true");
    await stopRealtimeProbe(page);
  });

  test("staff reservation lifecycle, receipt verification, inventory restore, and reports", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Run the live mutation sequence only once.");
    expect(reservationId).toBeTruthy();
    await loginWithOneTimeLink(page, "staff@wesleyan.edu.ph", "STAFF");

    try {
      for (const path of ["/staff/reservations", "/staff/receipt-verification", "/staff/inventory", "/staff/messages", "/staff/reports"]) {
        const response = await page.goto(path, { waitUntil: "domcontentloaded" });
        expect(response?.status(), path).toBe(200);
      }

      await responseJson(await page.request.get(`/api/reservations?limit=25&referenceCode=${encodeURIComponent(reservationReference)}`), "staff:reservation-list");
      await responseJson(await page.request.get("/api/staff/products?limit=25"), "staff:inventory");
      await responseJson(await page.request.get("/api/conversations?limit=20"), "staff:support");
      const restrictionOverview = await responseJson(
        await page.request.get("/api/staff/restrictions?limit=1&status=ALL"),
        "staff:restriction-page"
      );
      expect(restrictionOverview.overview.students.length).toBeLessThanOrEqual(1);
      const noShowPage = await responseJson(
        await page.request.get("/api/staff/restrictions/no-shows?limit=1"),
        "staff:no-show-page"
      );
      expect(noShowPage.page.items.length).toBeLessThanOrEqual(1);

      for (const nextStatus of ["CONFIRMED", "READY_FOR_PICKUP", "COMPLETED"] as const) {
        const response = await page.request.patch(`/api/reservations/${reservationId}/status`, {
          headers: originHeader(),
          data: { status: nextStatus }
        });
        const body = await responseJson(response, `staff:reservation-${nextStatus.toLowerCase()}`);
        reservationStatus = body.reservation.status;
        expect(reservationStatus).toBe(nextStatus);
        if (body.receipt?.id) receiptId = body.receipt.id;
      }

      expect(receiptId, "completion-generated receipt").toBeTruthy();
      const verifyResponse = await page.request.patch(`/api/receipts/${receiptId}/verify`, {
        headers: originHeader()
      });
      const verified = await responseJson(verifyResponse, "staff:receipt-verify");
      expect(verified.receipt.status).toBe("VERIFIED");

      const voidResponse = await page.request.patch(`/api/receipts/${receiptId}/void`, {
        headers: originHeader(),
        data: { reason: "Automated production smoke test; transaction inventory is restored." }
      });
      const voided = await responseJson(voidResponse, "staff:receipt-void");
      expect(voided.receipt.status).toBe("VOIDED");
      receiptVoided = true;

      const restockResponse = await page.request.post(`/api/staff/products/${productId}/restock`, {
        headers: originHeader(),
        data: restoreStockData(`Restore production smoke reservation ${reservationReference}.`)
      });
      await responseJson(restockResponse, "staff:inventory-restore");
      stockRestored = true;

      await responseJson(await page.request.get("/api/staff/reports/summary"), "staff:reports-cold");
      await responseJson(await page.request.get("/api/staff/reports/summary"), "staff:reports-cache");
    } finally {
      if (receiptId && !receiptVoided) {
        await page.request.patch(`/api/receipts/${receiptId}/void`, {
          headers: originHeader(),
          data: { reason: "Production smoke cleanup." }
        }).catch(() => undefined);
      }
      if (reservationId && !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(reservationStatus)) {
        await page.request.patch(`/api/reservations/${reservationId}/status`, {
          headers: originHeader(),
          data: { status: "CANCELLED" }
        }).catch(() => undefined);
      }
      if (cancellationProbeId && cancellationProbeStatus !== "CANCELLED") {
        await page.request.patch(`/api/reservations/${cancellationProbeId}/status`, {
          headers: originHeader(),
          data: { status: "CANCELLED" }
        }).catch(() => undefined);
      }
      if (reservationStatus === "COMPLETED" && productId && !stockRestored) {
        await page.request.post(`/api/staff/products/${productId}/restock`, {
          headers: originHeader(),
          data: restoreStockData(`Emergency restore for production smoke ${reservationReference}.`)
        }).catch(() => undefined);
      }
    }
  });

  test("student receives resulting receipt and notifications", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Run the live mutation sequence only once.");
    await loginWithOneTimeLink(page, "student@wesleyan.edu.ph", "STUDENT");
    const receiptPage = await responseJson(
      await page.request.get(`/api/receipts?limit=20&query=${encodeURIComponent(reservationReference)}`),
      "student:resulting-receipt"
    );
    expect((receiptPage.items ?? receiptPage.receipts).some((receipt: JsonRecord) => receipt.id === receiptId)).toBe(true);

    await expect.poll(async () => {
      const response = await page.request.get("/api/notifications?limit=50");
      const body = await response.json();
      return (body.notifications as JsonRecord[]).filter((notification) => (
        String(notification.message).includes(reservationReference)
        || String(notification.actionUrl ?? "").includes(receiptId)
      )).length;
    }, { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test("admin users, reversible role change, audit logs, dashboard, and reports", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Run the live mutation sequence only once.");
    await loginWithOneTimeLink(page, "admin@wesleyan.edu.ph", "ADMIN");

    for (const path of ["/admin/dashboard", "/admin/users", "/admin/audit-logs", "/admin/reports"]) {
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response?.status(), path).toBe(200);
    }

    const users = await responseJson(
      await page.request.get("/api/admin/users?limit=25&query=student%40wesleyan.edu.ph"),
      "admin:users"
    );
    const testStudent = (users.items ?? users.users).find((user: JsonRecord) => user.id === studentId);
    expect(testStudent?.role).toBe("STUDENT");

    let restoreRequired = false;
    try {
      const promote = await page.request.patch(`/api/admin/users/${studentId}/role`, {
        headers: originHeader(), data: { role: "STAFF" }
      });
      const promoted = await responseJson(promote, "admin:role-staff");
      expect(promoted.user.role).toBe("STAFF");
      restoreRequired = true;

      const restore = await page.request.patch(`/api/admin/users/${studentId}/role`, {
        headers: originHeader(), data: { role: "STUDENT" }
      });
      const restored = await responseJson(restore, "admin:role-student");
      expect(restored.user.role).toBe("STUDENT");
      restoreRequired = false;
    } finally {
      if (restoreRequired) {
        await page.request.patch(`/api/admin/users/${studentId}/role`, {
          headers: originHeader(), data: { role: "STUDENT" }
        }).catch(() => undefined);
      }
    }

    await responseJson(await page.request.get("/api/admin/audit-logs?limit=25"), "admin:audit-logs");
    await responseJson(await page.request.get("/api/admin/dashboard/summary"), "admin:dashboard-summary");
    await responseJson(await page.request.get("/api/admin/reports/summary"), "admin:reports");
  });
});
