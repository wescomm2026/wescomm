import { expect, test, type Route } from "@playwright/test";
import type { BackendReservation } from "../lib/api";
import { dismissWelcomeGate } from "./helpers";

const reservationCases = [
  { status: "PENDING", filter: "Pending", reference: "QA-PENDING" },
  { status: "CONFIRMED", filter: "Confirmed", reference: "QA-CONFIRMED" },
  { status: "READY_FOR_PICKUP", filter: "Ready for Pickup", reference: "QA-READY" },
  { status: "COMPLETED", filter: "Completed", reference: "QA-COMPLETED" },
  { status: "CANCELLED", filter: "Cancelled", reference: "QA-CANCELLED" },
  { status: "NO_SHOW", filter: "No-show", reference: "QA-NO-SHOW" }
] as const;

const mockedReservations = reservationCases.map((reservation, index) => ({
  id: `reservation-${index + 1}`,
  studentId: "qa-student",
  referenceCode: reservation.reference,
  status: reservation.status,
  pickupStart: index === 0 ? null : "2026-07-20T01:00:00.000Z",
  pickupEnd: index === 0 ? null : "2026-07-20T02:00:00.000Z",
  pickupReviewStatus: "NONE" as const,
  pickupReviewReason: null,
  scheduleRevision: 0,
  pickupPolicyVersion: 1,
  pickupSlot: null,
  paymentMethod: "CASH",
  preferredCollectionChannel: index === 2 ? "TREASURER" : "COMMISSARY",
  totalAmount: index === 0 ? "250.00" : "100.00",
  staffNotes: index === 0 ? "Bring your student ID." : null,
  createdAt: "2026-07-16T01:00:00.000Z",
  updatedAt: "2026-07-16T01:00:00.000Z",
  confirmationQueue: index === 0 ? { position: 3, ahead: 2, total: 8, calculatedAt: "2026-07-16T01:00:00.000Z" } : null,
  items: [
    {
      id: `item-${index + 1}`,
      productId: `product-${index + 1}`,
      variantSummary: null,
      quantity: 1,
      unitPrice: "100.00",
      subtotal: "100.00",
      product: {
        id: `product-${index + 1}`,
        name: `${reservation.filter} QA item`,
        description: "Reservation filter regression fixture",
        imageUrl: null,
        price: "100.00",
        oldPrice: null,
        status: "IN_STOCK",
        stock: 10,
        category: {
          id: "qa-category",
          name: "QA Fixtures",
          slug: "qa-fixtures"
        },
        variants: []
      }
    },
    ...(index === 0 ? [{
      id: "item-pending-second",
      productId: "product-pending-second",
      variantSummary: "Second item option",
      quantity: 2,
      unitPrice: "75.00",
      subtotal: "150.00",
      product: {
        id: "product-pending-second",
        name: "Second Pending QA item",
        description: "Second item in the same reservation",
        imageUrl: null,
        price: "75.00",
        oldPrice: null,
        status: "IN_STOCK" as const,
        stock: 10,
        category: {
          id: "qa-category",
          name: "QA Fixtures",
          slug: "qa-fixtures"
        },
        variants: []
      }
    }] : [])
  ]
})) satisfies BackendReservation[];

test("student reservation status filters work on desktop and mobile", async ({ page }) => {
  const unhandledApiPaths: string[] = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });

  await page.route("**/api/backend/**", async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === "/api/backend/auth/me") {
      await json(route, {
        profile: {
          id: "qa-student",
          role: "STUDENT",
          studentNumber: "QA-001",
          departmentId: "81000000-0000-4000-8000-000000000001",
          onboardingCompletedAt: "2026-07-01T00:00:00.000Z",
          fullName: "QA Student",
          email: "student@wesleyan.edu.ph",
          phone: null,
          department: "QA Fixtures",
          address: null,
          avatarUrl: null
        }
      });
      return;
    }
    if (path === "/api/backend/reservations") {
      await json(route, { reservations: mockedReservations });
      return;
    }
    if (path === "/api/backend/restrictions/me") {
      await json(route, {
        restrictionSummary: {
          activeRestriction: null,
          consecutiveOffenses: 0,
          offenses: [],
          policy: { firstRestrictionAt: 3 }
        }
      });
      return;
    }
    if (path === "/api/backend/notifications") {
      await json(route, { notifications: [] });
      return;
    }
    if (path === "/api/backend/notifications/unread-count") {
      await json(route, { unreadCount: 0 });
      return;
    }
    if (path === "/api/backend/realtime/updates") {
      await json(route, { cursor: "0", hasMore: false, events: [] });
      return;
    }
    if (path === "/api/backend/push/public-key") {
      await json(route, { enabled: false, publicKey: "" });
      return;
    }

    unhandledApiPaths.push(path);
    await json(route, { error: "Unexpected API request in reservation test." }, 500);
  });

  await page.goto("/student/reservations");
  await dismissWelcomeGate(page);

  const reservationRegion = page.getByRole("region", { name: "Your reservations" });
  const filterGroup = reservationRegion.getByRole("group", { name: "Filter reservations by status" });
  const cards = reservationRegion.getByRole("article");
  const allButton = filterGroup.getByRole("button", { name: "All", exact: true });

  await expect(filterGroup.getByRole("button")).toHaveText([
    "All",
    "Pending",
    "Confirmed",
    "Ready for Pickup",
    "Completed",
    "Cancelled",
    "No-show"
  ]);
  await expect(allButton).toHaveAttribute("aria-pressed", "true");
  await expect(cards).toHaveCount(mockedReservations.length);
  await expect(cards.filter({ hasText: "QA-NO-SHOW" })).toHaveCount(1);

  const pendingCard = cards.filter({ hasText: "QA-PENDING" });
  await expect(pendingCard).toHaveCount(1);
  await expect(pendingCard.getByRole("heading", { name: "Pending QA item", exact: true })).toBeVisible();
  await expect(pendingCard.getByRole("heading", { name: "Second Pending QA item", exact: true })).toHaveCount(0);
  await expect(pendingCard.getByText("+1 more item", { exact: true })).toBeVisible();
  await expect(pendingCard.getByText("QA-PENDING-1", { exact: true })).toHaveCount(0);
  await expect(pendingCard.getByText("QA-PENDING-2", { exact: true })).toHaveCount(0);
  await expect(pendingCard.getByText("Bring your student ID.", { exact: true })).toHaveCount(0);
  await expect(pendingCard.getByText("Awaiting staff confirmation", { exact: true })).toBeVisible();
  await expect(pendingCard.getByText("Staff will post the approved pickup date and time here after confirmation.", { exact: true })).toHaveCount(0);
  await expect(pendingCard.getByText("3 items total", { exact: true })).toBeVisible();
  await expect(pendingCard.getByText("Confirmation queue #3 of 8", { exact: true })).toBeVisible();
  await expect(pendingCard.getByText(/2 eligible requests are ahead/)).toBeVisible();
  await expect(pendingCard.getByText("PHP 250.00", { exact: true })).toBeVisible();
  await expect(pendingCard.getByTestId("reservation-progress")).toContainText("Current step: Pending");
  await expect(pendingCard.getByTestId("reservation-progress")).toContainText("Next: Confirmed");

  const confirmedCard = cards.filter({ hasText: "QA-CONFIRMED" });
  const confirmedProgress = confirmedCard.getByTestId("reservation-progress");
  await expect(confirmedProgress).toContainText("Current step: Confirmed");
  await expect(confirmedProgress).toContainText("Next: Ready for Pickup");
  await expect(confirmedProgress.locator('[aria-current="step"]')).toContainText("Confirmed");

  const completedProgress = cards.filter({ hasText: "QA-COMPLETED" }).getByTestId("reservation-progress");
  await expect(completedProgress).toContainText("Current step: Completed");
  await expect(completedProgress).toContainText("All reservation steps are complete.");

  const cancelledProgress = cards.filter({ hasText: "QA-CANCELLED" }).getByTestId("reservation-progress");
  await expect(cancelledProgress).toContainText("Progress ended: Cancelled");
  await expect(cancelledProgress).toContainText("No later fulfillment step will be marked complete.");

  const pendingTrigger = pendingCard.getByRole("button", { name: "View details for reservation QA-PENDING" });
  await pendingTrigger.click();
  const pendingDetails = page.getByRole("dialog", { name: "Reservation details QA-PENDING" });
  await expect(pendingDetails).toBeVisible();
  await expect(pendingDetails.getByRole("heading", { name: "Second Pending QA item", exact: true })).toBeVisible();
  await expect(pendingDetails.getByText("Bring your student ID.", { exact: true })).toBeVisible();
  await expect(pendingDetails.getByText("Awaiting pickup schedule", { exact: true })).toBeVisible();
  await expect(pendingDetails.getByText("Staff will post the approved pickup date and time here after confirmation.", { exact: true })).toBeVisible();
  await expect(pendingDetails.getByText("Your item is held while staff reviews the reservation. You selected cash payment at the Commissary.", { exact: true })).toBeVisible();
  await expect(pendingDetails.getByTestId("reservation-progress")).toContainText("Current step: Pending");
  await pendingDetails.getByRole("button", { name: "Close reservation details QA-PENDING" }).click();
  await expect(pendingDetails).toHaveCount(0);
  await expect(pendingTrigger).toBeFocused();

  const readyCard = cards.filter({ hasText: "QA-READY" });
  await readyCard.getByRole("button", { name: "View details for reservation QA-READY" }).click();
  const readyDetails = page.getByRole("dialog", { name: "Reservation details QA-READY" });
  await expect(readyDetails.getByText("Pay in cash at the Treasury, keep your official receipt, and present it during pickup. Bring your reference code.", { exact: true })).toBeVisible();
  await readyDetails.getByRole("button", { name: "Close reservation details QA-READY" }).click();

  for (const reservation of reservationCases) {
    const filterButton = filterGroup.getByRole("button", { name: reservation.filter, exact: true });
    await filterButton.click();
    await expect(filterButton).toHaveAttribute("aria-pressed", "true");
    await expect(allButton).toHaveAttribute("aria-pressed", "false");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText(reservation.reference);
    await expect(reservationRegion.getByText(`Showing 1 of ${mockedReservations.length} reservations`, { exact: true })).toBeVisible();
  }

  await allButton.click();
  await expect(cards).toHaveCount(mockedReservations.length);
  await expect(cards.filter({ hasText: "QA-NO-SHOW" })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(unhandledApiPaths).toEqual([]);
});
