import { expect, test, type Page, type Route } from "@playwright/test";
import type { BackendReceipt } from "../lib/api";
import { dismissWelcomeGate } from "./helpers";

const FIRST_RECEIPT_CODE = "RCT-2026-FIRST";
const SECOND_RECEIPT_CODE = "RCT-2026-SECOND";

const studentProfile = {
  id: "20000000-0000-4000-8000-000000000001",
  role: "STUDENT",
  studentNumber: "2026-00001",
  fullName: "QA Student",
  email: "student@wesleyan.edu.ph",
  phone: "",
  department: "Quality Assurance",
  address: "",
  avatarUrl: null
};

function createReceipt({
  id,
  code,
  reservationId,
  itemName,
  verificationHash,
  totalAmount,
  issuedAt
}: {
  id: string;
  code: string;
  reservationId: string;
  itemName: string;
  verificationHash: string;
  totalAmount: number;
  issuedAt: string;
}): BackendReceipt {
  return {
    id,
    receiptCode: code,
    studentId: studentProfile.id,
    reservationId,
    totalAmount,
    paymentMethod: "CASH",
    status: "VERIFIED",
    verificationHash,
    receiptImageUrl: null,
    receiptPdfUrl: null,
    issuedById: "20000000-0000-4000-8000-000000000099",
    issuedAt,
    createdAt: issuedAt,
    updatedAt: issuedAt,
    student: {
      id: studentProfile.id,
      fullName: studentProfile.fullName,
      email: studentProfile.email,
      studentNumber: studentProfile.studentNumber
    },
    issuedBy: {
      id: "20000000-0000-4000-8000-000000000099",
      fullName: "QA Cashier",
      email: "staff@wesleyan.edu.ph"
    },
    reservation: {
      id: reservationId,
      referenceCode: `RSV-${code}`,
      status: "COMPLETED",
      pickupStart: null,
      pickupEnd: null,
      items: [
        {
          id: `${reservationId}-item`,
          productId: `${reservationId}-product`,
          variantSummary: `${itemName} details`,
          quantity: 1,
          unitPrice: totalAmount,
          subtotal: totalAmount,
          product: {
            id: `${reservationId}-product`,
            name: itemName,
            description: `${itemName} description`,
            imageUrl: null,
            price: totalAmount
          }
        }
      ]
    }
  };
}

const receipts = [
  createReceipt({
    id: "30000000-0000-4000-8000-000000000001",
    code: FIRST_RECEIPT_CODE,
    reservationId: "40000000-0000-4000-8000-000000000001",
    itemName: "First Receipt Item",
    verificationHash: "11111111111111111111111111111111",
    totalAmount: 125,
    issuedAt: "2026-07-14T01:30:00.000Z"
  }),
  createReceipt({
    id: "30000000-0000-4000-8000-000000000002",
    code: SECOND_RECEIPT_CODE,
    reservationId: "40000000-0000-4000-8000-000000000002",
    itemName: "Second Receipt Item",
    verificationHash: "22222222222222222222222222222222",
    totalAmount: 275,
    issuedAt: "2026-07-15T02:45:00.000Z"
  })
];

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

async function mockReceiptApis(page: Page) {
  const unhandledApiPaths: string[] = [];

  await page.route("**/api/backend/**", async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === "/api/backend/auth/me") {
      await json(route, { profile: studentProfile });
      return;
    }

    if (path === "/api/backend/receipts") {
      await json(route, { receipts });
      return;
    }

    if (path === "/api/backend/notifications") {
      await json(route, { notifications: [] });
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

    if (path === "/api/backend/push/public-key") {
      await json(route, { enabled: false, publicKey: "" });
      return;
    }

    unhandledApiPaths.push(path);
    await json(route, { error: "Unexpected API request in focused receipt test." }, 500);
  });

  return unhandledApiPaths;
}

test("View Receipt isolates the transaction selected by its unique receipt id", async ({ page, isMobile }) => {
  const unhandledApiPaths = await mockReceiptApis(page);
  await page.goto("/student/receipts");
  await dismissWelcomeGate(page);

  if (isMobile) await page.getByRole("button", { name: "Open student menu" }).click();
  const receiptNavigation = page.getByRole("link", { name: "Receipts", exact: true });
  await expect(receiptNavigation).toHaveAttribute("href", "/student/receipts");
  if (isMobile) await page.getByRole("button", { name: "Close student menu" }).click();

  await expect(page.getByRole("article")).toHaveCount(2);
  const selectedReceiptButton = page.getByRole("button", { name: `View receipt ${SECOND_RECEIPT_CODE}` });
  await selectedReceiptButton.click();

  const dialog = page.getByRole("dialog", { name: `Digital receipt ${SECOND_RECEIPT_CODE}` });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialog.getByRole("heading", { name: `Digital receipt ${SECOND_RECEIPT_CODE}` })).toBeVisible();
  await expect(dialog.getByText("1 x Second Receipt Item", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/First Receipt Item/)).toHaveCount(0);
  await expect(dialog.getByText(new RegExp(FIRST_RECEIPT_CODE))).toHaveCount(0);

  // The history remains mounted, but it is removed from keyboard and accessibility navigation while previewing.
  await expect(page.getByRole("article")).toHaveCount(0);
  const closeButton = dialog.getByRole("button", { name: `Close receipt ${SECOND_RECEIPT_CODE}` });
  await expect(closeButton).toBeFocused();

  const downloadButton = dialog.getByRole("button", { name: "Download Receipt as PNG" });
  await page.keyboard.press("Shift+Tab");
  await expect(downloadButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();

  const accountMenu = page.locator('button[aria-label="QA Student account menu"]');
  await expect(accountMenu).toHaveCount(1);
  await accountMenu.evaluate((element) => element.focus());
  await expect(closeButton).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(selectedReceiptButton).toBeFocused();
  await expect(page.getByRole("button", { name: `Download receipt ${SECOND_RECEIPT_CODE} as PNG` })).toBeVisible();
  expect(unhandledApiPaths).toEqual([]);
});
