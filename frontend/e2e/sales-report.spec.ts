import { expect, test, type Route } from "@playwright/test";
import type { BackendAuthProfile } from "../lib/api";
import { EMPTY_REPORT_SUMMARY } from "../lib/report-summary";
import { authorizeMockedWorkspace, dismissWelcomeGate, fulfillWorkspaceShellExtras } from "./helpers";

const staffProfile: BackendAuthProfile = {
  id: "00000000-0000-4000-8000-000000000801",
  role: "STAFF",
  studentNumber: null,
  fullName: "Sales Report QA Staff",
  email: "salesreport.qa@wesleyan.edu.ph",
  phone: null,
  department: "Commissary",
  departmentId: null,
  onboardingCompletedAt: null,
  address: null,
  avatarUrl: null
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function handleShellRequest(route: Route) {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/backend/auth/me") {
    await json(route, { profile: staffProfile });
    return true;
  }
  if (path === "/api/backend/auth/departments") {
    await json(route, { departments: [] });
    return true;
  }
  if (path === "/api/backend/notifications") {
    await json(route, { notifications: [], nextCursor: null });
    return true;
  }
  if (await fulfillWorkspaceShellExtras(route)) return true;
  if (path === "/api/backend/notifications/unread-count") {
    await json(route, { unreadCount: 0 });
    return true;
  }
  if (path === "/api/backend/realtime/updates") {
    await json(route, { cursor: "0", hasMore: false, events: [] });
    return true;
  }
  return false;
}

const ledgerFixture = {
  generatedAt: "2026-10-02T03:00:00.000Z",
  generatedBy: "Sales Report QA Staff",
  range: {
    period: "DAILY",
    anchor: "2026-10-01",
    fromKey: "2026-10-01",
    toKey: "2026-10-02",
    fromInclusive: "2026-09-30T16:00:00.000Z",
    toExclusive: "2026-10-01T16:00:00.000Z",
    label: "October 1, 2026"
  },
  filters: { channel: "ALL", collectionLocation: "ALL" },
  summary: {
    validSalesTransactions: 2,
    totalUnitsSold: 3,
    reservationSales: { count: 1, amount: 1600 },
    walkInSales: { count: 1, amount: 450 },
    totalRecognizedSales: 2050,
    voidsProcessed: { count: 1, amount: 300 }
  },
  sales: [
    {
      sequence: 1,
      timestamp: "2026-09-30T17:30:00.000Z",
      receiptCode: "WIS-2026-0101",
      type: "WALK_IN",
      studentName: "Ana Reyes",
      studentNumber: "2024-00123",
      orderReference: null,
      items: [{
        productId: "p1",
        productName: "ID Lace",
        skuCode: null,
        variant: "Blue",
        category: "Accessories",
        quantity: 1,
        unitPrice: 450,
        subtotal: 450,
        cogs: 250
      }],
      itemLines: ["1× ID Lace — Blue"],
      quantity: 1,
      collectionPoint: "COMMISSARY",
      cashierName: "Sales Report QA Staff",
      amount: 450
    },
    {
      sequence: 2,
      timestamp: "2026-09-30T20:00:00.000Z",
      receiptCode: "RES-2026-0102",
      type: "RESERVATION",
      studentName: "Ben Cruz",
      studentNumber: null,
      orderReference: "WUP-2026-00042",
      items: [{
        productId: "p2",
        productName: "PE Shirt",
        skuCode: "PE-S-M",
        variant: "Medium",
        category: "PE Uniforms",
        quantity: 2,
        unitPrice: 800,
        subtotal: 1600,
        cogs: 1000
      }],
      itemLines: ["2× PE Shirt — Medium"],
      quantity: 2,
      collectionPoint: "TREASURER",
      cashierName: "Sales Report QA Staff",
      amount: 1600
    }
  ],
  voids: [
    {
      voidedAt: "2026-09-30T19:00:00.000Z",
      originalSaleAt: "2026-09-30T18:00:00.000Z",
      receiptCode: "WIS-2026-0099",
      type: "WALK_IN",
      amount: 300,
      cashierName: "Sales Report QA Staff",
      voidedBy: "Sales Report QA Staff",
      reason: "Wrong item"
    }
  ],
  productSummary: [
    { item: "PE Shirt", category: "PE Uniforms", skuOrOption: "PE-S-M — Medium", quantity: 2, sales: 1600, cogs: 1000, grossProfit: 600 },
    { item: "ID Lace", category: "Accessories", skuOrOption: "Blue", quantity: 1, sales: 450, cogs: 250, grossProfit: 200 }
  ]
};

test.describe("sales report preview", () => {
  test("staff preview daily ledger with matching totals and void audit trail", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "One sales report preview contract is sufficient.");
    const ledgerRequests: Array<Record<string, string | null>> = [];
    const auditPayloads: Array<Record<string, unknown>> = [];
    let downloadCount = 0;
    let analyticsDownloadCount = 0;
    let downloadSnapshotAt: string | null = null;
    const unhandled: string[] = [];
    await authorizeMockedWorkspace(page, "STAFF");

    await page.route("**/api/backend/**", async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      const path = requestUrl.pathname;
      if (await handleShellRequest(route)) return;

      if (path === "/api/backend/staff/reports/summary") {
        return json(route, { summary: EMPTY_REPORT_SUMMARY });
      }
      if (path === "/api/backend/staff/reports/summary/download" && request.method() === "GET") {
        analyticsDownloadCount += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          headers: {
            "Content-Disposition": "attachment; filename=\"wescomm-management-analytics.xlsx\"; filename*=UTF-8''wescomm-management-analytics-2026-09-25-2026-10-01.xlsx"
          },
          body: Buffer.from("PK\u0003\u0004fake-management-xlsx")
        });
      }
      if (path === "/api/backend/staff/reports/sales-ledger" && request.method() === "GET") {
        ledgerRequests.push({
          period: requestUrl.searchParams.get("period"),
          anchor: requestUrl.searchParams.get("anchor"),
          channel: requestUrl.searchParams.get("channel"),
          collectionLocation: requestUrl.searchParams.get("collectionLocation")
        });
        return json(route, ledgerFixture);
      }
      if (path === "/api/backend/staff/reports/sales-ledger/download" && request.method() === "GET") {
        downloadCount += 1;
        downloadSnapshotAt = requestUrl.searchParams.get("snapshotAt");
        return route.fulfill({
          status: 200,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          headers: {
            "Content-Disposition": "attachment; filename=\"wescomm-sales-report.xlsx\"; filename*=UTF-8''wescomm-sales-report-daily-2026-10-01.xlsx"
          },
          body: Buffer.from("PK\u0003\u0004fake-xlsx-payload")
        });
      }
      if (path === "/api/backend/staff/reports/sales-ledger/audit" && request.method() === "POST") {
        auditPayloads.push(request.postDataJSON() as Record<string, unknown>);
        return route.fulfill({ status: 204, body: "" });
      }

      unhandled.push(`${request.method()} ${path}`);
      return json(route, { error: "Unexpected API request in sales report test." }, 500);
    });

    await page.goto("/staff/reports");
    await dismissWelcomeGate(page);
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();

    await page.getByRole("button", { name: "Sales register", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sales register" })).toBeVisible();

    await page.getByLabel("Date").fill("2026-10-01");
    await page.getByRole("button", { name: "Preview Report" }).click();

    await expect(page.getByText("Daily Sales Report", { exact: true })).toBeVisible();
    await expect(page.getByText("Reporting period: October 1, 2026")).toBeVisible();
    await expect(page.getByText("WIS-2026-0101", { exact: true })).toBeVisible();
    await expect(page.getByText("RES-2026-0102", { exact: true })).toBeVisible();
    await expect(page.getByText("2× PE Shirt — Medium")).toBeVisible();
    await expect(page.locator("table").first().getByText("Treasury", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Voided Transactions" })).toBeVisible();
    await expect(page.getByText("WIS-2026-0099", { exact: true })).toBeVisible();
    await expect(page.getByText("Wrong item", { exact: true })).toBeVisible();
    await expect(page.getByText("₱2,050.00", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Prepared by: ______________________")).toBeVisible();

    expect(ledgerRequests.at(-1)).toEqual({
      period: "DAILY",
      anchor: "2026-10-01",
      channel: null,
      collectionLocation: null
    });

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Sales Excel" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("wescomm-sales-report-daily-2026-10-01.xlsx");
    expect(downloadCount).toBe(1);
    expect(downloadSnapshotAt).toBe(ledgerFixture.generatedAt);

    await page.getByRole("button", { name: "Print" }).click();
    expect(auditPayloads).toHaveLength(1);
    expect(auditPayloads[0]).toMatchObject({
      action: "PRINTED",
      period: "DAILY",
      anchor: "2026-10-01",
      channel: "ALL",
      collectionLocation: "ALL"
    });

    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.getByText("More actions", { exact: true }).click();
    const analyticsDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export analytics Excel" }).click();
    const analyticsDownload = await analyticsDownloadPromise;
    expect(analyticsDownload.suggestedFilename()).toBe("wescomm-management-analytics-2026-09-25-2026-10-01.xlsx");
    expect(analyticsDownloadCount).toBe(1);

    expect(unhandled).toEqual([]);
  });

  test("print mode shows only the printable report and hides controls", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "One print-mode contract is sufficient.");
    await authorizeMockedWorkspace(page, "STAFF");

    await page.route("**/api/backend/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (await handleShellRequest(route)) return;
      if (path === "/api/backend/staff/reports/summary") {
        return json(route, { summary: EMPTY_REPORT_SUMMARY });
      }
      if (path === "/api/backend/staff/reports/sales-ledger" && request.method() === "GET") {
        return json(route, { ...ledgerFixture, sales: [], voids: [], productSummary: [], summary: { ...ledgerFixture.summary, validSalesTransactions: 0, totalUnitsSold: 0, reservationSales: { count: 0, amount: 0 }, walkInSales: { count: 0, amount: 0 }, totalRecognizedSales: 0, voidsProcessed: { count: 0, amount: 0 } } });
      }
      if (path === "/api/backend/staff/reports/sales-ledger/audit" && request.method() === "POST") {
        return route.fulfill({ status: 204, body: "" });
      }
      return json(route, { error: "Unexpected API request in sales report print test." }, 500);
    });

    await page.goto("/staff/reports");
    await dismissWelcomeGate(page);
    await page.getByRole("button", { name: "Sales register", exact: true }).click();
    await page.getByLabel("Date").fill("2026-10-01");
    await page.getByRole("button", { name: "Preview Report" }).click();
    await expect(page.getByText("No valid sales found for this period.")).toBeVisible();
    await expect(page.getByText("No voids processed in this period.")).toBeVisible();

    await page.emulateMedia({ media: "print" });
    await expect(page.locator("#sales-report-print-area")).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview Report" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
    await expect(page.getByText("Daily Sales Report", { exact: true })).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await expect(page.getByRole("button", { name: "Preview Report" })).toBeVisible();
  });
});
