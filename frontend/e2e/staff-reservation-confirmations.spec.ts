import { expect, test, type Page, type Route } from "@playwright/test";
import type { BackendAuthProfile, BackendReservation } from "../lib/api";
import { authorizeMockedWorkspace, dismissWelcomeGate } from "./helpers";

const staffProfile: BackendAuthProfile = {
  id: "00000000-0000-4000-8000-000000000301",
  role: "STAFF",
  studentNumber: null,
  fullName: "Reservation QA Staff",
  email: "reservation.qa@wesleyan.edu.ph",
  phone: null,
  department: "Commissary",
  address: null,
  avatarUrl: null
};

function reservation(id: string, referenceCode: string, status: "PENDING" | "CONFIRMED"): BackendReservation {
  return {
    id,
    studentId: "00000000-0000-4000-8000-000000000302",
    referenceCode,
    status,
    pickupStart: "2026-08-26T02:00:00.000Z",
    pickupEnd: "2026-08-26T04:00:00.000Z",
    pickupReviewStatus: "NONE",
    pickupReviewReason: null,
    scheduleRevision: 0,
    pickupPolicyVersion: 1,
    pickupSlot: null,
    paymentMethod: "PAY_AT_COMMISSARY",
    totalAmount: "350.00",
    payment: null,
    createdAt: "2026-08-25T02:00:00.000Z",
    updatedAt: "2026-08-25T02:00:00.000Z",
    student: {
      id: "00000000-0000-4000-8000-000000000302",
      fullName: "Reservation QA Student",
      email: "reservation.student@wesleyan.edu.ph",
      studentNumber: "2026-0302"
    },
    items: [{
      id: `${id}-item`,
      productId: "00000000-0000-4000-8000-000000000303",
      variantSummary: null,
      quantity: 1,
      unitPrice: "350.00",
      subtotal: "350.00",
      product: null
    }]
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockReservations(page: Page) {
  await authorizeMockedWorkspace(page, "STAFF");
  let reservations = [
    reservation("00000000-0000-4000-8000-000000000304", "WES-CONFIRM-0304", "PENDING"),
    reservation("00000000-0000-4000-8000-000000000305", "WES-CANCEL-0305", "CONFIRMED")
  ];
  const statusUpdates: string[] = [];
  const unhandled: string[] = [];

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/backend/auth/me" && request.method() === "GET") {
      await json(route, { profile: staffProfile });
      return;
    }
    if (path === "/api/backend/notifications" && request.method() === "GET") {
      await json(route, { notifications: [], nextCursor: null });
      return;
    }
    if (path === "/api/backend/notifications/unread-count" && request.method() === "GET") {
      await json(route, { unreadCount: 0 });
      return;
    }
    if (path === "/api/backend/realtime/events" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      return;
    }
    if (path === "/api/backend/reservations" && request.method() === "GET") {
      await json(route, { items: reservations, nextCursor: null });
      return;
    }

    const match = path.match(/^\/api\/backend\/reservations\/([^/]+)\/status$/);
    if (match && request.method() === "PATCH") {
      const payload = request.postDataJSON() as { status: BackendReservation["status"] };
      statusUpdates.push(`${match[1]}:${payload.status}`);
      const current = reservations.find((entry) => entry.id === match[1]);
      if (!current) {
        await json(route, { error: "Reservation not found." }, 404);
        return;
      }
      const updated = { ...current, status: payload.status, updatedAt: "2026-08-25T03:00:00.000Z" };
      reservations = reservations.map((entry) => entry.id === updated.id ? updated : entry);
      await json(route, { reservation: updated, receipt: null });
      return;
    }

    unhandled.push(`${request.method()} ${path}`);
    await json(route, { error: "Unexpected API request in reservation confirmation test." }, 500);
  });

  return { statusUpdates, unhandled };
}

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 }
] as const;

for (const viewport of viewports) {
  test(`reservation transitions require a responsive confirmation on ${viewport.name}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Explicit viewport matrix runs once.");
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const requests = await mockReservations(page);

    await page.goto("/staff/reservations");
    await dismissWelcomeGate(page);
    await expect(page.getByRole("heading", { name: "Reservation queue" })).toBeVisible();

    const confirmRow = page.locator("article").filter({ hasText: "WES-CONFIRM-0304" });
    const confirmButton = confirmRow.getByRole("button", { name: "Confirm", exact: true });
    await confirmButton.click();
    const transitionDialog = page.getByRole("alertdialog", { name: "Confirm this reservation?" });
    await expect(transitionDialog).toContainText("enter the staff preparation workflow");
    await expect(transitionDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    expect(requests.statusUpdates).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(confirmButton).toBeFocused();

    await confirmButton.click();
    await transitionDialog.getByRole("button", { name: "Confirm reservation" }).click();
    await expect(confirmRow.getByRole("button", { name: "Mark ready" })).toBeVisible();
    expect(requests.statusUpdates).toEqual(["00000000-0000-4000-8000-000000000304:CONFIRMED"]);

    const cancelRow = page.locator("article").filter({ hasText: "WES-CANCEL-0305" });
    const cancelButton = cancelRow.getByRole("button", { name: "Cancel", exact: true });
    await cancelButton.click();
    const cancellationDialog = page.getByRole("alertdialog", { name: "Cancel this reservation?" });
    await expect(cancellationDialog).toContainText("payment and audit records will be retained");
    await expect(cancellationDialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(cancelButton).toBeFocused();
    expect(requests.statusUpdates).toHaveLength(1);
    expect(requests.unhandled).toEqual([]);
  });
}
