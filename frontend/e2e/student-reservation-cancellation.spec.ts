import { expect, test, type Route } from "@playwright/test";
import type { BackendReservation } from "../lib/api";
import { dismissWelcomeGate } from "./helpers";

const student = {
  id: "91000000-0000-4000-8000-000000000001",
  role: "STUDENT",
  studentNumber: "QA-CANCEL-001",
  fullName: "Cancellation QA Student",
  email: "cancellation.qa@wesleyan.edu.ph",
  phone: null,
  department: null,
  address: null,
  avatarUrl: null
} as const;

function reservation(
  idSuffix: string,
  referenceCode: string,
  status: BackendReservation["status"],
  paymentMethod: BackendReservation["paymentMethod"],
  paymentStatus?: NonNullable<BackendReservation["payment"]>["status"]
): BackendReservation {
  const id = `92000000-0000-4000-8000-0000000000${idSuffix}`;
  return {
    id,
    studentId: student.id,
    referenceCode,
    status,
    pickupStart: status === "PENDING" ? null : "2026-08-20T01:00:00.000Z",
    pickupEnd: status === "PENDING" ? null : "2026-08-20T02:00:00.000Z",
    paymentMethod,
    totalAmount: "125.00",
    staffNotes: null,
    createdAt: "2026-08-14T01:00:00.000Z",
    updatedAt: "2026-08-14T01:00:00.000Z",
    payment: paymentStatus ? {
      id: `93000000-0000-4000-8000-0000000000${idSuffix}`,
      reservationId: id,
      status: paymentStatus,
      amountMinor: 12_500,
      currency: "PHP",
      livemode: false,
      canResume: false,
      canRetry: false
    } : null,
    items: [{
      id: `94000000-0000-4000-8000-0000000000${idSuffix}`,
      productId: `95000000-0000-4000-8000-0000000000${idSuffix}`,
      variantSummary: null,
      quantity: 1,
      unitPrice: "125.00",
      subtotal: "125.00",
      product: {
        id: `95000000-0000-4000-8000-0000000000${idSuffix}`,
        name: `${referenceCode} item`,
        description: "Cancellation policy fixture",
        imageUrl: null,
        price: "125.00",
        oldPrice: null,
        status: "IN_STOCK",
        stock: 10,
        category: { id: "qa-category", name: "QA Fixtures", slug: "qa-fixtures" },
        variants: []
      }
    }]
  };
}

const pendingCash = reservation("11", "QA-PENDING-UNPAID", "PENDING", "CASH");
const pendingPaid = reservation("12", "QA-PENDING-PAID", "PENDING", "PAYMONGO_GCASH", "PAID");
const confirmed = reservation("13", "QA-CONFIRMED", "CONFIRMED", "CASH");
const ready = reservation("14", "QA-READY", "READY_FOR_PICKUP", "CASH");

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("student cancellation follows pending and paid GCash rules", async ({ page }) => {
  let reservations = [pendingCash, pendingPaid, confirmed, ready];
  let cancellationRequests = 0;

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/backend/auth/me") return json(route, { profile: student });
    if (path === "/api/backend/reservations" && request.method() === "GET") {
      return json(route, { reservations });
    }
    if (path === `/api/backend/reservations/${pendingCash.id}/cancel` && request.method() === "POST") {
      cancellationRequests += 1;
      const cancelled = { ...pendingCash, status: "CANCELLED" as const };
      reservations = reservations.map((entry) => entry.id === cancelled.id ? cancelled : entry);
      return json(route, { reservation: cancelled, receipt: null });
    }
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
    return json(route, { error: `Unexpected mocked request: ${request.method()} ${path}` }, 500);
  });

  await page.goto("/student/reservations");
  await dismissWelcomeGate(page);

  const cards = page.getByRole("article");
  const pendingCashCard = cards.filter({ hasText: pendingCash.referenceCode });
  const pendingPaidCard = cards.filter({ hasText: pendingPaid.referenceCode });
  const confirmedCard = cards.filter({ hasText: confirmed.referenceCode });
  const readyCard = cards.filter({ hasText: ready.referenceCode });

  await expect(pendingCashCard.getByRole("button", { name: "Cancel Reservation" })).toBeVisible();
  await expect(pendingPaidCard.getByText("Staff review is required", { exact: true })).toBeVisible();
  await expect(pendingPaidCard.getByRole("button", { name: "Cancel Reservation" })).toHaveCount(0);
  await expect(confirmedCard.getByText("Student cancellation is closed", { exact: true })).toBeVisible();
  await expect(readyCard.getByText("Student cancellation is closed", { exact: true })).toBeVisible();

  await pendingCashCard.getByRole("button", { name: "Cancel Reservation" }).click();
  await expect(pendingCashCard.getByText("Cancel this pending reservation?", { exact: true })).toBeVisible();
  await pendingCashCard.getByRole("button", { name: "Confirm Cancellation" }).click();

  await expect(pendingCashCard.getByText("Reservation cancelled", { exact: true })).toBeVisible();
  await expect(pendingCashCard.getByText("Cancelled", { exact: true })).toBeVisible();
  expect(cancellationRequests).toBe(1);
});
