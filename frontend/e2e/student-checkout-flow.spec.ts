import { expect, test, type Route } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

const student = {
  id: "86000000-0000-4000-8000-000000000001",
  role: "STUDENT",
  studentNumber: "QA-CHECKOUT-001",
  departmentId: "86000000-0000-4000-8000-000000000006",
  onboardingCompletedAt: "2026-08-01T08:00:00.000Z",
  fullName: "Checkout QA Student",
  email: "checkout.qa@wesleyan.edu.ph",
  phone: null,
  department: "QA Fixtures",
  address: null,
  avatarUrl: null
} as const;
const productId = "86000000-0000-4000-8000-000000000002";
const pickupSlotId = "86000000-0000-4000-8000-000000000003";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function pickupPolicy(version: number) {
  return {
    id: `86000000-0000-4000-8000-${String(version).padStart(12, "0")}`,
    version,
    timezone: "Asia/Manila",
    minAdvanceDays: 1,
    maxAdvanceDays: 14,
    minDate: "2026-08-03",
    maxDate: "2026-08-17",
    serverDate: "2026-08-02",
    effectiveAt: "2026-08-02T00:00:00.000Z",
    isActive: true,
    reason: "QA pickup policy",
    createdById: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    days: Array.from({ length: 7 }, (_, weekday) => ({ weekday, enabled: weekday >= 1 && weekday <= 5 })),
    timeSlots: [{ id: pickupSlotId, label: "Morning pickup", startMinute: 600, endMinute: 720, isActive: true, sortOrder: 0 }],
    closures: []
  };
}

function successfulReservation() {
  return {
    id: "86000000-0000-4000-8000-000000000004",
    studentId: student.id,
    referenceCode: "WES-2026-QA000001",
    status: "PENDING",
    pickupStart: "2026-08-03T02:00:00.000Z",
    pickupEnd: "2026-08-03T04:00:00.000Z",
    pickupReviewStatus: "NONE",
    pickupReviewReason: null,
    scheduleRevision: 1,
    pickupPolicyVersion: 7,
    pickupSlot: { id: pickupSlotId, label: "Morning pickup", startMinute: 600, endMinute: 720, capacity: 2 },
    paymentMethod: "PAY_AT_COMMISSARY",
    totalAmount: "125.00",
    staffNotes: null,
    createdAt: "2026-08-02T08:00:00.000Z",
    updatedAt: "2026-08-02T08:00:00.000Z",
    student: null,
    payment: null,
    items: [{
      id: "86000000-0000-4000-8000-000000000005",
      productId,
      productNameSnapshot: "Checkout QA Notebook",
      skuCodeSnapshot: null,
      optionSnapshot: [],
      variantSummary: null,
      quantity: 1,
      unitPrice: "125.00",
      subtotal: "125.00",
      product: { id: productId, name: "Checkout QA Notebook", description: "Two-step checkout test item", imageUrl: null, price: "125.00", status: "IN_STOCK", stock: 4, category: { id: "qa-category", name: "School Supplies", slug: "school-supplies" } }
    }]
  };
}

test("an open pickup picker expires a selected slot when its start time passes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "The slot-boundary refresh needs one deterministic clock run.");
  await page.clock.install({ time: new Date("2026-08-03T01:59:58.000Z") });
  let slotAvailabilityCalls = 0;

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/backend/auth/me") return json(route, { profile: student });
    if (path === "/api/backend/restrictions/me") return json(route, { restrictionSummary: { activeRestriction: null, consecutiveOffenses: 0, offenses: [], policy: { firstRestrictionAt: 3 } } });
    if (path === "/api/backend/notifications") return json(route, { notifications: [] });
    if (path === "/api/backend/notifications/unread-count") return json(route, { unreadCount: 0 });
    if (path === "/api/backend/realtime/updates") return json(route, { cursor: "0", hasMore: false, events: [] });
    if (path === "/api/backend/push/public-key") return json(route, { enabled: false, publicKey: "" });
    if (path === "/api/backend/wishlist") return json(route, { wishlist: [] });
    if (path === "/api/backend/products") return json(route, { products: [{ id: productId, name: "Checkout QA Notebook", description: "Slot expiry test item", imageUrl: null, price: "125.00", oldPrice: null, status: "IN_STOCK", stock: 5, category: { id: "qa-category", name: "School Supplies", slug: "school-supplies" }, variants: [] }] });
    if (path === "/api/backend/payments/options") return json(route, { paymongoGcash: { enabled: false, livemode: false } });
    if (path === "/api/backend/pickup/availability") {
      const policy = pickupPolicy(7);
      return json(route, {
        policy: {
          ...policy,
          minAdvanceDays: 0,
          maxAdvanceDays: 0,
          minDate: "2026-08-03",
          maxDate: "2026-08-03",
          serverDate: "2026-08-03",
          days: policy.days.map((day) => ({ ...day, enabled: true }))
        }
      });
    }
    if (path === "/api/backend/pickup/availability/slots") {
      slotAvailabilityCalls += 1;
      const expired = slotAvailabilityCalls > 1;
      return json(route, {
        availability: {
          pickupDate: "2026-08-03",
          pickupPolicyVersion: 7,
          serverTime: expired ? "2026-08-03T02:00:00.250Z" : "2026-08-03T01:59:58.000Z",
          slots: [{
            slotId: pickupSlotId,
            capacity: 2,
            booked: 0,
            remaining: 2,
            isFull: false,
            isExpired: expired,
            isUnavailable: expired,
            unavailableReason: expired ? "PICKUP_SLOT_EXPIRED" : null
          }]
        }
      });
    }
    return json(route, { error: `Unexpected mocked request: ${request.method()} ${path}` }, 500);
  });

  await page.goto("/student/shop");
  await dismissWelcomeGate(page);
  await page.getByRole("button", { name: "Reserve Now" }).first().click();
  const checkout = page.getByRole("dialog", { name: "Item and pickup details" });
  await checkout.getByRole("button", { name: "2026-08-03, available" }).click();
  const availableSlot = checkout.getByRole("button", { name: "Morning pickup, 2 spots left" });
  await expect(availableSlot).toBeEnabled();
  await expect(availableSlot).toHaveAttribute("aria-pressed", "true");
  await expect(checkout.getByRole("button", { name: "Next: Payment" })).toBeEnabled();

  await page.clock.fastForward(2_500);

  await expect.poll(() => slotAvailabilityCalls).toBeGreaterThan(1);
  await expect(checkout.getByRole("button", { name: "Morning pickup, Time passed" })).toBeDisabled();
  await expect(checkout.getByRole("button", { name: "Next: Payment" })).toBeDisabled();
});

test("Reserve Now writes only on final confirmation and recovers from a changed pickup policy", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One complete checkout state transition is sufficient.");
  let availabilityCalls = 0;
  let reservationCalls = 0;
  let reservationBody: Record<string, unknown> | null = null;
  let pickupPolicyChanged = false;

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/backend/auth/me") return json(route, { profile: student });
    if (path === "/api/backend/restrictions/me") return json(route, { restrictionSummary: { activeRestriction: null, consecutiveOffenses: 0, offenses: [], policy: { firstRestrictionAt: 3 } } });
    if (path === "/api/backend/notifications") return json(route, { notifications: [] });
    if (path === "/api/backend/push/public-key") return json(route, { enabled: false, publicKey: "" });
    if (path === "/api/backend/wishlist") return json(route, { wishlist: [] });
    if (path === "/api/backend/products") return json(route, { products: [{ id: productId, name: "Checkout QA Notebook", description: "Two-step checkout test item", imageUrl: null, price: "125.00", oldPrice: null, status: "IN_STOCK", stock: 5, category: { id: "qa-category", name: "School Supplies", slug: "school-supplies" }, variants: [] }] });
    if (path === "/api/backend/payments/options") return json(route, { paymongoGcash: { enabled: true, livemode: false } });
    if (path === "/api/backend/pickup/availability") {
      availabilityCalls += 1;
      return json(route, { policy: pickupPolicy(pickupPolicyChanged ? 8 : 7) });
    }
    if (path === "/api/backend/pickup/availability/slots") {
      const url = new URL(request.url());
      return json(route, {
        availability: {
          pickupDate: url.searchParams.get("pickupDate"),
          pickupPolicyVersion: pickupPolicyChanged ? 8 : 7,
          slots: [{ slotId: pickupSlotId, capacity: 2, booked: 1, remaining: 1, isFull: false }]
        }
      });
    }
    if (path === "/api/backend/reservations" && request.method() === "POST") {
      reservationCalls += 1;
      reservationBody = request.postDataJSON();
      pickupPolicyChanged = true;
      return json(route, { error: "The pickup schedule changed. Refresh the available dates and choose again.", code: "PICKUP_POLICY_CHANGED" }, 409);
    }
    return json(route, { error: `Unexpected mocked request: ${request.method()} ${path}` }, 500);
  });

  await page.goto("/student/shop");
  await dismissWelcomeGate(page);
  await page.getByRole("button", { name: "Reserve Now" }).first().click();

  let checkout = page.getByRole("dialog", { name: "Item and pickup details" });
  await expect(checkout.getByText(/Policy v/)).toHaveCount(0);
  await checkout.getByRole("button", { name: "2026-08-03, available" }).click();
  await expect(checkout.getByText("1 spot left", { exact: true })).toBeVisible();
  await checkout.getByRole("button", { name: "Next: Payment" }).click();
  expect(reservationCalls).toBe(0);

  checkout = page.getByRole("dialog", { name: "Payment and collection" });
  await expect(
    checkout.getByRole("group", { name: "How would you like to pay?" }).getByText("Cash", { exact: true })
  ).toBeVisible();
  await checkout.getByRole("radio", { name: /Treasury/ }).check();
  await checkout.getByRole("button", { name: "Back" }).click();

  checkout = page.getByRole("dialog", { name: "Item and pickup details" });
  await expect(checkout.getByRole("button", { name: "2026-08-03, available" })).toHaveAttribute("aria-pressed", "true");
  await checkout.getByRole("button", { name: "Next: Payment" }).click();
  checkout = page.getByRole("dialog", { name: "Payment and collection" });
  await expect(
    checkout.getByRole("group", { name: "How would you like to pay?" }).getByText("Cash", { exact: true })
  ).toBeVisible();
  await expect(checkout.getByRole("radio", { name: /Treasury/ })).toBeChecked();
  const availabilityBeforeConfirm = availabilityCalls;
  await checkout.getByRole("checkbox", { name: /I agree to the Terms & Conditions/ }).check();
  await checkout.getByRole("button", { name: "Confirm Reservation" }).click();

  checkout = page.getByRole("dialog", { name: "Item and pickup details" });
  await expect(checkout.getByRole("alert")).toContainText("Pickup availability changed");
  await expect.poll(() => availabilityCalls).toBeGreaterThan(availabilityBeforeConfirm);
  expect(reservationCalls).toBe(1);
  expect(reservationBody).not.toHaveProperty("paymentMethod");
  expect(reservationBody).toMatchObject({
    preferredCollectionChannel: "TREASURER",
    pickupDate: "2026-08-03",
    pickupSlotId,
    pickupPolicyVersion: 7,
    policyAcceptance: { accepted: true, version: "2026-09-02" }
  });
});

test("pickup payment keeps a failed state visible, retries safely, and shows the saved state", async ({ page }, testInfo) => {
  if (testInfo.project.name === "desktop-chromium") await page.emulateMedia({ reducedMotion: "reduce" });
  const reservation = successfulReservation();
  let reservationAttempts = 0;
  const idempotencyKeys: string[] = [];

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/backend/auth/me") return json(route, { profile: student });
    if (path === "/api/backend/restrictions/me") return json(route, { restrictionSummary: { activeRestriction: null, consecutiveOffenses: 0, offenses: [], policy: { firstRestrictionAt: 3 } } });
    if (path === "/api/backend/notifications") return json(route, { notifications: [] });
    if (path === "/api/backend/push/public-key") return json(route, { enabled: false, publicKey: "" });
    if (path === "/api/backend/wishlist") return json(route, { wishlist: [] });
    if (path === "/api/backend/products") return json(route, { products: [{ id: productId, name: "Checkout QA Notebook", description: "Two-step checkout test item", imageUrl: null, price: "125.00", oldPrice: null, status: "IN_STOCK", stock: 5, category: { id: "qa-category", name: "School Supplies", slug: "school-supplies" }, variants: [] }] });
    if (path === "/api/backend/payments/options") return json(route, { paymongoGcash: { enabled: false, livemode: false } });
    if (path === "/api/backend/pickup/availability") return json(route, { policy: pickupPolicy(7) });
    if (path === "/api/backend/pickup/availability/slots") return json(route, { availability: { pickupDate: "2026-08-03", pickupPolicyVersion: 7, slots: [{ slotId: pickupSlotId, capacity: 2, booked: 0, remaining: 2, isFull: false, isExpired: false, isUnavailable: false, unavailableReason: null }] } });
    if (path === "/api/backend/reservations" && request.method() === "POST") {
      reservationAttempts += 1;
      idempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
      if (reservationAttempts === 1) {
        return json(route, {
          error: "WESCOMM could not complete this request right now. Please try again.",
          code: "UNEXPECTED_ERROR",
          requestId: "qa-reservation-failure"
        }, 500);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      return json(route, { reservation });
    }
    if (path === "/api/backend/reservations" && request.method() === "GET") return json(route, { items: [reservation], nextCursor: null });
    return json(route, { error: `Unexpected mocked request: ${request.method()} ${path}` }, 500);
  });

  await page.goto("/student/shop");
  await dismissWelcomeGate(page);
  await page.getByRole("button", { name: "Reserve Now" }).first().click();
  let checkout = page.getByRole("dialog", { name: "Item and pickup details" });
  await checkout.getByRole("button", { name: "2026-08-03, available" }).click();
  await checkout.getByRole("button", { name: "Next: Payment" }).click();
  checkout = page.getByRole("dialog", { name: "Payment and collection" });
  await expect(
    checkout.getByRole("group", { name: "How would you like to pay?" }).getByText("Cash", { exact: true })
  ).toBeVisible();
  await checkout.getByRole("radio", { name: /Commissary/ }).check();
  await checkout.getByRole("checkbox", { name: /I agree to the Terms & Conditions/ }).check();
  await checkout.getByRole("button", { name: "Confirm Reservation" }).click();

  const savingDialog = page.getByRole("dialog", { name: "Saving Reservation" });
  await expect(savingDialog).toBeVisible();
  await expect(savingDialog.locator(testInfo.project.name === "desktop-chromium"
    ? 'img[src="/assets/wescomm_saving_reservation_static.svg"]'
    : 'img[src="/assets/wescomm_saving_reservation.svg"]')).toBeVisible();
  const failedDialog = page.getByRole("dialog", { name: "Reservation not saved" });
  await expect(failedDialog).toBeVisible();
  await expect(failedDialog.getByRole("alert")).toContainText("Support reference: qa-reservation-failure");
  await failedDialog.getByRole("button", { name: "Review and try again" }).click();

  checkout = page.getByRole("dialog", { name: "Payment and collection" });
  await expect(checkout.getByRole("alert")).toContainText("Support reference: qa-reservation-failure");
  await checkout.getByRole("button", { name: "Confirm Reservation" }).click();
  await expect(page.getByRole("dialog", { name: "Saving Reservation" })).toBeVisible();

  const savedDialog = page.getByRole("dialog", { name: "Reservation Saved" });
  await expect(savedDialog).toBeVisible();
  await expect(savedDialog.getByTestId("saved-reservation-reference")).toContainText(reservation.referenceCode);
  expect(reservationAttempts).toBe(2);
  expect(idempotencyKeys[0]).not.toBe("");
  expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  await expect(page).toHaveURL(/\/student\/shop$/);
  await savedDialog.getByRole("button", { name: "View Reservation" }).click();
  await expect(page).toHaveURL(new RegExp(`/student/reservations#reservation-${reservation.id}$`));
  await expect(page.locator(`#reservation-${reservation.id}`)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("cart reservation Done closes the confirmation and stays in the shop", async ({ page }) => {
  const reservation = successfulReservation();

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/backend/auth/me") return json(route, { profile: student });
    if (path === "/api/backend/restrictions/me") return json(route, { restrictionSummary: { activeRestriction: null, consecutiveOffenses: 0, offenses: [], policy: { firstRestrictionAt: 3 } } });
    if (path === "/api/backend/notifications") return json(route, { notifications: [] });
    if (path === "/api/backend/push/public-key") return json(route, { enabled: false, publicKey: "" });
    if (path === "/api/backend/wishlist") return json(route, { wishlist: [] });
    if (path === "/api/backend/products") return json(route, { products: [{ id: productId, name: "Checkout QA Notebook", description: "Two-step checkout test item", imageUrl: null, price: "125.00", oldPrice: null, status: "IN_STOCK", stock: 5, category: { id: "qa-category", name: "School Supplies", slug: "school-supplies" }, variants: [] }] });
    if (path === "/api/backend/payments/options") return json(route, { paymongoGcash: { enabled: false, livemode: false } });
    if (path === "/api/backend/pickup/availability") return json(route, { policy: pickupPolicy(7) });
    if (path === "/api/backend/pickup/availability/slots") return json(route, { availability: { pickupDate: "2026-08-03", pickupPolicyVersion: 7, slots: [{ slotId: pickupSlotId, capacity: 2, booked: 0, remaining: 2, isFull: false, isExpired: false, isUnavailable: false, unavailableReason: null }] } });
    if (path === "/api/backend/reservations" && request.method() === "POST") return json(route, { reservation });
    return json(route, { error: `Unexpected mocked request: ${request.method()} ${path}` }, 500);
  });

  await page.goto("/student/shop");
  await dismissWelcomeGate(page);
  await page.getByRole("button", { name: "Add to Cart" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add to Cart" }).click();
  await page.getByRole("button", { name: /Open cart with 1 item/ }).click();
  await page.getByRole("button", { name: "Checkout Cart" }).click();
  let checkout = page.getByRole("dialog", { name: "Review Items & Pickup" });
  await checkout.getByRole("button", { name: "2026-08-03, available" }).click();
  await checkout.getByRole("button", { name: "Next: Payment" }).click();
  checkout = page.getByRole("dialog", { name: "Payment & Review" });
  await expect(
    checkout.getByRole("group", { name: "How would you like to pay?" }).getByText("Cash", { exact: true })
  ).toBeVisible();
  await checkout.getByRole("radio", { name: /Commissary/ }).check();
  await checkout.getByRole("checkbox", { name: /I agree to the Terms & Conditions/ }).check();
  await checkout.getByRole("button", { name: "Confirm Reservation" }).click();

  const savedDialog = page.getByRole("dialog", { name: "Reservation Saved" });
  await expect(savedDialog).toBeVisible();
  await expect(savedDialog.getByTestId("saved-reservation-reference")).toContainText(reservation.referenceCode);
  await savedDialog.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/\/student\/shop$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open cart with 0 items/ })).toBeVisible();
});
