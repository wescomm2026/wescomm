import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  BackendAuthProfile,
  BackendPickupPolicy,
  BackendReportSummary,
  BackendReservation
} from "../lib/api";
import type { StaffProduct } from "../lib/staff-api";
import { authorizeMockedWorkspace, dismissWelcomeGate } from "./helpers";

const staffProfile: BackendAuthProfile = {
  id: "91000000-0000-4000-8000-000000000001",
  role: "STAFF",
  studentNumber: null,
  fullName: "Operations QA Staff",
  email: "operations.qa@wesleyan.edu.ph",
  phone: null,
  department: "Commissary",
  address: null,
  avatarUrl: null
};

const adminProfile: BackendAuthProfile = {
  ...staffProfile,
  id: "91000000-0000-4000-8000-000000000002",
  role: "ADMIN",
  fullName: "Operations QA Admin",
  email: "operations.admin@wesleyan.edu.ph"
};

const morningSlotId = "92000000-0000-4000-8000-000000000001";
const afternoonSlotId = "92000000-0000-4000-8000-000000000002";

function pickupPolicy(version = 7): BackendPickupPolicy {
  return {
    id: `92000000-0000-4000-8000-${String(version).padStart(12, "0")}`,
    version,
    timezone: "Asia/Manila",
    minAdvanceDays: 1,
    maxAdvanceDays: 14,
    minDate: "2026-08-03",
    maxDate: "2026-08-17",
    serverDate: "2026-08-02",
    effectiveAt: "2026-08-02T00:00:00.000Z",
    isActive: true,
    reason: "Weekday commissary schedule",
    createdById: staffProfile.id,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    days: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      enabled: weekday >= 1 && weekday <= 5
    })),
    timeSlots: [
      { id: morningSlotId, label: "Morning pickup", startMinute: 600, endMinute: 720, isActive: true, sortOrder: 0 },
      { id: afternoonSlotId, label: "Afternoon pickup", startMinute: 780, endMinute: 900, isActive: true, sortOrder: 1 },
      { id: "92000000-0000-4000-8000-000000000003", label: "Inactive window", startMinute: 900, endMinute: 960, isActive: false, sortOrder: 2 }
    ],
    closures: [{
      id: "92000000-0000-4000-8000-000000000004",
      date: "2026-08-05",
      reason: "Campus holiday"
    }]
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function handleShellRequest(route: Route, profile: BackendAuthProfile) {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/backend/auth/me") {
    await json(route, { profile });
    return true;
  }
  if (path === "/api/backend/notifications") {
    await json(route, { notifications: [], nextCursor: null });
    return true;
  }
  if (path === "/api/backend/notifications/unread-count") {
    await json(route, { unreadCount: 0 });
    return true;
  }
  if (path === "/api/backend/realtime/events") {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
    return true;
  }
  return false;
}

test("staff policy activation previews impact and preserves staff-review counts", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One full policy transaction is sufficient.");
  let policies = [pickupPolicy()];
  let previewPayload: Record<string, unknown> | null = null;
  let activationPayload: Record<string, unknown> | null = null;
  const unhandled: string[] = [];
  await authorizeMockedWorkspace(page, "STAFF");

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (await handleShellRequest(route, staffProfile)) return;

    if (path === "/api/backend/pickup/policies/current" && request.method() === "GET") {
      return json(route, { policy: policies[0] });
    }
    if (path === "/api/backend/pickup/policies/preview" && request.method() === "POST") {
      previewPayload = request.postDataJSON();
      return json(route, {
        preview: {
          currentVersion: 7,
          nextVersion: 8,
          affectedCount: 1,
          autoRescheduledCount: 0,
          needsReviewCount: 1,
          previewFingerprint: "a".repeat(64),
          affectedReservations: [{
            id: "93000000-0000-4000-8000-000000000001",
            referenceCode: "WES-POLICY-REVIEW",
            pickupStart: "2026-08-08T02:00:00.000Z",
            pickupEnd: "2026-08-08T04:00:00.000Z",
            scheduleRevision: 2,
            action: "NEEDS_REVIEW",
            reason: "Saturday is disabled in the proposed policy",
            proposedPickupStart: null,
            proposedPickupEnd: null,
            proposedSlotLabel: null
          }],
          truncated: false
        }
      });
    }
    if (path === "/api/backend/pickup/policies" && request.method() === "POST") {
      activationPayload = request.postDataJSON();
      const nextPolicy = { ...pickupPolicy(8), reason: "Open Saturday for enrollment", isActive: true };
      policies = [nextPolicy, { ...policies[0], isActive: false }];
      return json(route, {
        policy: nextPolicy,
        affectedCount: 1,
        autoRescheduledCount: 0,
        needsReviewCount: 1,
        idempotentReplay: false
      });
    }

    unhandled.push(`${request.method()} ${path}`);
    return json(route, { error: "Unexpected API request in pickup policy test." }, 500);
  });

  await page.goto("/staff/pickup-schedule");
  await dismissWelcomeGate(page);
  await expect(page.getByRole("heading", { name: "Pickup schedule" })).toBeVisible();
  await expect(page.getByText("Campus holiday", { exact: true })).toBeVisible();

  await expect(page.getByText("Current active version", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Policy history", { exact: true })).toHaveCount(0);
  const saturday = page.locator('button[aria-label^="Saturday:"]');
  await expect(saturday).toHaveAttribute("aria-pressed", "false");
  await saturday.click();
  await expect(saturday).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();

  const review = page.getByRole("alertdialog", { name: "Save pickup schedule changes?" });
  await expect(review).toBeVisible();
  await expect(review.getByText(/0 will be moved automatically; 1 need staff review/)).toBeVisible();
  expect((previewPayload as unknown as { days: Array<{ weekday: number; enabled: boolean }> }).days)
    .toContainEqual({ weekday: 6, enabled: true });

  await review.getByLabel("Change note").fill("Open Saturday for enrollment");
  await review.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByText(/Pickup schedule updated.*0 reservation.*safely moved.*1 still need staff review/)).toBeVisible();
  expect((activationPayload as unknown as { reason: string }).reason).toBe("Open Saturday for enrollment");
  expect(unhandled).toEqual([]);
});

test("authorized reschedule submits the selected policy version and schedule revision", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One full reschedule transaction is sufficient.");
  const reservation: BackendReservation = {
    id: "93000000-0000-4000-8000-000000000010",
    studentId: "93000000-0000-4000-8000-000000000011",
    referenceCode: "WES-REVIEW-0010",
    status: "CONFIRMED",
    pickupStart: "2026-08-04T02:00:00.000Z",
    pickupEnd: "2026-08-04T04:00:00.000Z",
    pickupReviewStatus: "NEEDS_REVIEW",
    pickupReviewReason: "The pickup window was retired",
    scheduleRevision: 3,
    pickupPolicyVersion: 6,
    pickupSlot: null,
    paymentMethod: "PAY_AT_COMMISSARY",
    totalAmount: "450.00",
    payment: null,
    createdAt: "2026-08-01T02:00:00.000Z",
    updatedAt: "2026-08-02T02:00:00.000Z",
    student: {
      id: "93000000-0000-4000-8000-000000000011",
      fullName: "Schedule QA Student",
      email: "schedule.student@wesleyan.edu.ph",
      studentNumber: "2026-0010"
    },
    items: [{
      id: "93000000-0000-4000-8000-000000000012",
      productId: "93000000-0000-4000-8000-000000000013",
      variantSummary: null,
      quantity: 1,
      unitPrice: "450.00",
      subtotal: "450.00",
      product: null
    }]
  };
  let reschedulePayload: Record<string, unknown> | null = null;
  const unhandled: string[] = [];
  await authorizeMockedWorkspace(page, "STAFF");

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (await handleShellRequest(route, staffProfile)) return;
    if (path === "/api/backend/reservations" && request.method() === "GET") {
      return json(route, { items: [reservation], nextCursor: null });
    }
    if (path === "/api/backend/pickup/availability" && request.method() === "GET") {
      return json(route, { policy: pickupPolicy() });
    }
    if (path === "/api/backend/pickup/availability/slots" && request.method() === "GET") {
      const url = new URL(request.url());
      return json(route, {
        availability: {
          pickupDate: url.searchParams.get("pickupDate"),
          pickupPolicyVersion: 7,
          slots: [
            { slotId: morningSlotId, capacity: 1, booked: 1, remaining: 0, isFull: true },
            { slotId: afternoonSlotId, capacity: null, booked: 0, remaining: null, isFull: false }
          ]
        }
      });
    }
    if (path === `/api/backend/reservations/${reservation.id}/pickup` && request.method() === "PATCH") {
      reschedulePayload = request.postDataJSON();
      return json(route, {
        reservation: {
          ...reservation,
          pickupStart: "2026-08-06T05:00:00.000Z",
          pickupEnd: "2026-08-06T07:00:00.000Z",
          pickupReviewStatus: "RESCHEDULED",
          pickupReviewReason: null,
          pickupPolicyVersion: 7,
          pickupSlot: pickupPolicy().timeSlots[1],
          scheduleRevision: 4,
          updatedAt: "2026-08-03T02:00:00.000Z"
        }
      });
    }
    unhandled.push(`${request.method()} ${path}`);
    return json(route, { error: "Unexpected API request in reschedule test." }, 500);
  });

  await page.goto("/staff/reservations");
  await dismissWelcomeGate(page);
  const row = page.getByRole("article").filter({ hasText: reservation.referenceCode });
  await expect(row.getByText(/Needs review: The pickup window was retired/)).toBeVisible();
  await row.getByRole("button", { name: "Review schedule" }).click();

  const dialog = page.getByRole("dialog", { name: `Reschedule ${reservation.referenceCode}` });
  await expect(dialog.getByRole("button", { name: /2026-08-05, unavailable: Campus holiday/ })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: /2026-08-08, unavailable: No pickup on this day/ })).toBeDisabled();
  await dialog.getByRole("button", { name: "2026-08-06, available" }).click();
  await expect(dialog.getByRole("button", { name: "Morning pickup, Full" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Afternoon pickup" }).click();
  await dialog.getByLabel("Reason for rescheduling").fill("Student approved the new afternoon schedule");
  await dialog.getByRole("button", { name: "Save and notify student" }).click();

  await expect(page.getByText(/pickup rescheduled.*student was notified.*previous schedule remains in history/)).toBeVisible();
  expect(reschedulePayload).toEqual({
    expectedScheduleRevision: 3,
    pickupDate: "2026-08-06",
    pickupSlotId: afternoonSlotId,
    pickupPolicyVersion: 7,
    reason: "Student approved the new afternoon schedule"
  });
  expect(unhandled).toEqual([]);
});

test("receipt status and payment method filters are combined server-side", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One server-filter contract is sufficient.");
  const receiptQueries: string[] = [];
  const unhandled: string[] = [];
  await authorizeMockedWorkspace(page, "STAFF");

  await page.route("**/api/backend/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    if (await handleShellRequest(route, staffProfile)) return;
    if (path === "/api/backend/receipts" && route.request().method() === "GET") {
      receiptQueries.push(requestUrl.search);
      return json(route, { items: [], nextCursor: null });
    }
    unhandled.push(`${route.request().method()} ${path}`);
    return json(route, { error: "Unexpected API request in receipt filter test." }, 500);
  });

  await page.goto("/staff/receipt-verification");
  await dismissWelcomeGate(page);
  await expect(page.getByRole("heading", { name: "Verify digital receipts" })).toBeVisible();
  const filters = page.getByRole("combobox");
  await filters.nth(0).selectOption({ label: "Verified" });
  await filters.nth(1).selectOption("ONLINE_GCASH");

  await expect.poll(() => receiptQueries.some((query) => query.includes("status=VERIFIED") && query.includes("paymentChannel=ONLINE_GCASH"))).toBe(true);
  expect(unhandled).toEqual([]);
});

function reportSummary(preset: BackendReportSummary["range"]["preset"]): BackendReportSummary {
  return {
    range: {
      preset,
      from: preset === "ALL_TIME" ? null : "2026-07-01",
      to: "2026-07-31",
      granularity: preset === "ALL_TIME" ? "MONTHLY" : "DAILY",
      label: preset === "LAST_MONTH" ? "Last Month" : preset === "ALL_TIME" ? "All Time" : "Last 30 Days"
    },
    totalSales: 1500,
    onlineGcashRevenue: 900,
    payAtCommissaryRevenue: 600,
    paymentMethodBreakdown: {
      onlineGcash: { amount: 900, receipts: 3 },
      payAtCommissary: { amount: 600, receipts: 2 }
    },
    totalReservations: 8,
    pendingReservations: 1,
    lowStockItems: 2,
    outOfStockItems: 1,
    totalProducts: 12,
    inventoryValue: 25000,
    activeUsers: 40,
    roleCounts: { students: 35, staff: 4, admins: 1 },
    receiptsToVerify: 1,
    totalReceipts: 5,
    activeConversations: 2,
    salesTrend: [{ key: "2026-07-01", day: "Jul 1", sales: 1500, receipts: 5 }],
    categorySales: [{ category: "Uniforms", amount: 1500 }],
    reservationStatusDistribution: [{ status: "COMPLETED", label: "Completed", value: 5, percent: 100 }],
    inventoryInsights: []
  };
}

test("historical reports request the selected range and render payment-method revenue", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One historical report contract is sufficient.");
  const presets: string[] = [];
  const unhandled: string[] = [];
  await authorizeMockedWorkspace(page, "ADMIN");

  await page.route("**/api/backend/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    if (await handleShellRequest(route, adminProfile)) return;
    if (path === "/api/backend/admin/reports/summary") {
      const preset = requestUrl.searchParams.get("preset") ?? "LAST_30_DAYS";
      presets.push(preset);
      return json(route, { summary: reportSummary(preset as BackendReportSummary["range"]["preset"]) });
    }
    unhandled.push(`${route.request().method()} ${path}`);
    return json(route, { error: "Unexpected API request in report range test." }, 500);
  });

  await page.goto("/admin/reports");
  await dismissWelcomeGate(page);
  await expect(page.getByRole("heading", { name: "Sales, inventory value, and planning analytics" })).toBeVisible();
  await page.getByLabel("Revenue period").selectOption("LAST_MONTH");

  await expect.poll(() => presets.includes("LAST_MONTH")).toBe(true);
  await expect(page.getByText("PHP 900.00", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("PHP 600.00", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Range: Last Month. Exports use this exact verified-receipt range.")).toBeVisible();
  expect(unhandled).toEqual([]);
});

test("Admin can permanently delete an eligible archived product with exact confirmation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One destructive-action confirmation contract is sufficient.");
  const product: StaffProduct = {
    id: "94000000-0000-4000-8000-000000000001",
    categoryId: "94000000-0000-4000-8000-000000000002",
    name: "Disposable QA Draft Product",
    description: "No transaction history",
    imageUrl: "https://storage.example.test/product-images/disposable.png",
    imageStoragePath: "product-images/disposable.png",
    price: "25.00",
    oldPrice: null,
    status: "IN_STOCK",
    stock: 0,
    lowStockThreshold: 1,
    isActive: false,
    saleMode: "CLOTH_ONLY",
    skuInventoryEnabled: false,
    inventoryReconciledAt: null,
    category: {
      id: "94000000-0000-4000-8000-000000000002",
      name: "QA",
      slug: "qa",
      isActive: true
    },
    variants: [],
    skus: []
  };
  let deletePayload: Record<string, unknown> | null = null;
  let deleted = false;
  const unhandled: string[] = [];
  await authorizeMockedWorkspace(page, "ADMIN");

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const path = requestUrl.pathname;
    if (await handleShellRequest(route, adminProfile)) return;
    if (path === "/api/backend/staff/products" && request.method() === "GET") {
      const archived = requestUrl.searchParams.get("visibility") === "ARCHIVED";
      return json(route, {
        products: archived && !deleted ? [product] : [],
        categories: [product.category],
        nextCursor: null
      });
    }
    if (path === `/api/backend/staff/products/${product.id}/deletion-eligibility` && request.method() === "GET") {
      return json(route, {
        eligibility: {
          productId: product.id,
          productName: product.name,
          eligible: true,
          dependencies: { reservationItems: 0, transactionalMovements: 0 },
          reasons: []
        }
      });
    }
    if (path === `/api/backend/staff/products/${product.id}/permanent` && request.method() === "DELETE") {
      deletePayload = request.postDataJSON();
      deleted = true;
      return json(route, { deletedProduct: { id: product.id, name: product.name, imageCleanupQueued: true } });
    }
    unhandled.push(`${request.method()} ${path}`);
    return json(route, { error: "Unexpected API request in permanent deletion test." }, 500);
  });

  await page.goto("/admin/inventory");
  await dismissWelcomeGate(page);
  await page.getByRole("button", { name: "Archived items" }).click();
  const row = page.getByRole("article").filter({ hasText: product.name });
  await row.getByRole("button", { name: "Delete permanently" }).click();

  const dialog = page.getByRole("alertdialog", { name: `Delete ${product.name} permanently?` });
  const confirmButton = dialog.getByRole("button", { name: "Delete permanently" });
  await expect(confirmButton).toBeDisabled();
  await dialog.getByLabel("Deletion reason").fill("Created only for an automated QA cleanup test");
  await dialog.getByLabel("Type the exact product name to confirm").fill(product.name);
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  await expect(row).toBeHidden();
  await expect(page.getByText(/permanently deleted.*queued for secure storage cleanup/)).toBeVisible();
  expect(deletePayload).toEqual({
    confirmation: product.name,
    reason: "Created only for an automated QA cleanup test"
  });
  expect(unhandled).toEqual([]);
});
