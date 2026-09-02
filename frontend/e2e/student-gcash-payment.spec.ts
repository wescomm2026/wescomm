import { expect, test, type Page, type Route } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

const student = {
  id: "81000000-0000-4000-8000-000000000001",
  role: "STUDENT",
  studentNumber: "QA-PAY-001",
  fullName: "Payment QA Student",
  email: "payment.qa@wesleyan.edu.ph",
  phone: null,
  department: null,
  address: null,
  avatarUrl: null
} as const;
const productId = "82000000-0000-4000-8000-000000000001";
const reservationId = "83000000-0000-4000-8000-000000000001";
const paymentId = "84000000-0000-4000-8000-000000000001";
const pickupSlotId = "85000000-0000-4000-8000-000000000001";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function commonApiResponse(route: Route) {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/backend/auth/me") return json(route, { profile: student });
  if (path === "/api/backend/restrictions/me") {
    return json(route, {
      restrictionSummary: {
        activeRestriction: null,
        consecutiveOffenses: 0,
        offenses: [],
        policy: { firstRestrictionAt: 3 }
      }
    });
  }
  if (path === "/api/backend/notifications") return json(route, { notifications: [] });
  if (path === "/api/backend/push/public-key") return json(route, { enabled: false, publicKey: "" });
  if (path === "/api/backend/wishlist") return json(route, { wishlist: [] });
  if (path === "/api/backend/pickup/availability") {
    return json(route, {
      policy: {
        id: "85000000-0000-4000-8000-000000000099",
        version: 7,
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
        timeSlots: [
          { id: pickupSlotId, label: "Morning pickup", startMinute: 600, endMinute: 720, isActive: true, sortOrder: 0 },
          { id: "85000000-0000-4000-8000-000000000002", label: "Inactive slot", startMinute: 780, endMinute: 840, isActive: false, sortOrder: 1 }
        ],
        closures: [{ id: "85000000-0000-4000-8000-000000000003", date: "2026-08-05", reason: "Campus holiday" }]
      }
    });
  }
  if (path === "/api/backend/pickup/availability/slots") {
    const url = new URL(route.request().url());
    return json(route, {
      availability: {
        pickupDate: url.searchParams.get("pickupDate"),
        pickupPolicyVersion: 7,
        slots: [{ slotId: pickupSlotId, capacity: null, booked: 0, remaining: null, isFull: false }]
      }
    });
  }
  return null;
}

test("cart checkout sends only server-owned GCash identifiers before trusted redirect", async ({ page }) => {
  let reservationBody: Record<string, unknown> | null = null;
  let paymentBody: Record<string, unknown> | null = null;
  let reservationKey = "";
  let paymentKey = "";

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const common = commonApiResponse(route);
    if (common) return common;

    if (path === "/api/backend/products") {
      return json(route, {
        products: [{
          id: productId,
          name: "GCash QA Notebook",
          description: "Online payment test item",
          imageUrl: null,
          price: "125.00",
          oldPrice: null,
          status: "IN_STOCK",
          stock: 5,
          category: { id: "qa-category", name: "School Supplies", slug: "school-supplies" },
          variants: []
        }]
      });
    }
    if (path === "/api/backend/payments/options") {
      return json(route, { paymongoGcash: { enabled: true, livemode: false } });
    }
    if (path === "/api/backend/reservations" && request.method() === "POST") {
      reservationBody = request.postDataJSON();
      reservationKey = request.headers()["idempotency-key"] ?? "";
      return json(route, {
        reservation: {
          id: reservationId,
          studentId: student.id,
          referenceCode: "RSV-GCASH-QA",
          status: "PENDING",
          pickupStart: "2026-08-03T02:00:00.000Z",
          pickupEnd: "2026-08-03T04:00:00.000Z",
          paymentMethod: "PAYMONGO_GCASH",
          totalAmount: "125.00",
          staffNotes: null,
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
          items: []
        },
        idempotentReplay: false
      }, 201);
    }
    if (path === "/api/backend/payments/gcash/checkout" && request.method() === "POST") {
      paymentBody = request.postDataJSON();
      paymentKey = request.headers()["idempotency-key"] ?? "";
      return json(route, {
        payment: {
          id: paymentId,
          reservationId,
          status: "AWAITING_PAYMENT",
          amountMinor: 12500,
          currency: "PHP",
          livemode: false,
          canResume: true,
          canRetry: false
        },
        checkoutUrl: `https://checkout.paymongo.com/test/${paymentId}`
      });
    }

    return json(route, { error: `Unexpected mocked request: ${request.method()} ${path}` }, 500);
  });
  await page.route("https://checkout.paymongo.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<title>PayMongo test checkout</title>"
  }));

  await page.goto("/student/shop");
  await dismissWelcomeGate(page);
  await page.getByRole("button", { name: "Add to Cart" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add to Cart" }).click();
  await page.getByRole("button", { name: /Open cart with 1 item/ }).click();
  await page.getByRole("button", { name: "Checkout Cart" }).click();

  let checkout = page.getByRole("dialog", { name: "Review Items & Pickup" });
  await checkout.getByRole("button", { name: "2026-08-03, available" }).click();
  await checkout.getByRole("button", { name: "Next: Payment" }).click();
  expect(reservationBody).toBeNull();

  checkout = page.getByRole("dialog", { name: "Payment & Review" });
  await expect(checkout.getByText("Test mode", { exact: true })).toBeVisible();
  await expect(checkout.getByText("No real money will be charged.", { exact: true })).toBeVisible();
  await checkout.getByRole("radio", { name: /Pay Online via GCash/ }).check();
  await checkout.getByRole("button", { name: "Continue to GCash" }).click();
  await page.waitForURL(`https://checkout.paymongo.com/test/${paymentId}`);

  expect(reservationBody).toMatchObject({
    paymentMethod: "PAYMONGO_GCASH",
    pickupDate: "2026-08-03",
    pickupSlotId,
    pickupPolicyVersion: 7
  });
  expect(reservationBody).not.toHaveProperty("amount");
  expect(reservationBody).not.toHaveProperty("status");
  expect(paymentBody).toEqual({ reservationId });
  expect(paymentBody).not.toHaveProperty("amountMinor");
  expect(reservationKey).not.toBe("");
  expect(paymentKey).not.toBe("");
  expect(paymentKey).not.toBe(reservationKey);
});

test("payment return ignores URL claims and renders only the backend status", async ({ page }) => {
  let status = "AWAITING_PAYMENT";

  await page.route("**/api/backend/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const common = commonApiResponse(route);
    if (common) return common;

    if (path === `/api/backend/payments/${paymentId}`) {
      return json(route, {
        payment: {
          id: paymentId,
          reservationId,
          status,
          amountMinor: 12500,
          currency: "PHP",
          livemode: false,
          canResume: status === "AWAITING_PAYMENT",
          canRetry: false,
          providerReference: status === "PAID" ? "pay_test_confirmed" : null
        }
      });
    }
    return json(route, { error: `Unexpected mocked request: ${path}` }, 500);
  });

  await page.goto(`/student/payments/${paymentId}?status=paid&cancelled=false`);
  await dismissWelcomeGate(page);
  await expect(page.getByRole("heading", { name: "Complete your GCash payment" })).toBeVisible();
  await expect(page.getByText("Paid", { exact: true })).toHaveCount(0);

  status = "PAID";
  await page.getByRole("button", { name: "Refresh Status" }).click();
  await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  await expect(page.getByText("pay_test_confirmed", { exact: true })).toBeVisible();
});
