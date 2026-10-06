import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Route } from "@playwright/test";
import type { BackendAuthProfile } from "../lib/api";
import type { InventoryReport, InventoryReportItem, StaffCategory } from "../lib/staff-api";
import { authorizeMockedWorkspace, dismissWelcomeGate, fulfillWorkspaceShellExtras } from "./helpers";

type CountSheet = {
  categories: Array<{ name: string; slug: string }>;
  products: Array<{ key: string; name: string; category: string; saleMode: InventoryReportItem["saleMode"]; lines: Array<{ option?: string; count: number }> }>;
};

// The real September 2026 count sheet, so the printout is checked at its true length.
const sheet = JSON.parse(readFileSync(path.resolve(__dirname, "../../backend/datasets/inventory/2026-09-ending-inventory.json"), "utf8")) as CountSheet;

const staffProfile: BackendAuthProfile = {
  id: "00000000-0000-4000-8000-000000000901",
  role: "STAFF",
  studentNumber: null,
  fullName: "QA Commissary Staff",
  email: "staff@wesleyan.edu.ph",
  phone: null,
  department: "Commissary",
  departmentId: null,
  onboardingCompletedAt: null,
  address: null,
  avatarUrl: null
};

const categories: StaffCategory[] = sheet.categories.map((category, index) => ({
  id: `00000000-0000-4000-8000-00000000091${index}`,
  name: category.name,
  slug: category.slug,
  isActive: true
}));

const modeOrder: Record<InventoryReportItem["saleMode"], number> = { CLOTH_ONLY: 0, OPTIONS: 1, SIMPLE: 2 };

function reportFor(categorySlug: string | null): InventoryReport {
  const groups = sheet.categories
    .filter((category) => !categorySlug || category.slug === categorySlug)
    .map((category) => {
      const items: InventoryReportItem[] = sheet.products
        .filter((product) => product.category === category.slug)
        .map((product) => ({
          productId: product.key,
          name: product.name,
          saleMode: product.saleMode,
          unitPrice: 0,
          total: product.lines.reduce((sum, line) => sum + line.count, 0),
          lines: product.saleMode === "OPTIONS" ? product.lines.map((line) => ({ label: line.option ?? "", stock: line.count })) : [],
          needsPrice: true,
          unverifiedCostQuantity: product.lines.reduce((sum, line) => sum + line.count, 0),
          setupRequired: false
        }))
        .sort((left, right) => modeOrder[left.saleMode] - modeOrder[right.saleMode] || left.name.localeCompare(right.name));
      return { name: category.name, slug: category.slug, total: items.reduce((sum, item) => sum + item.total, 0), items };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const items = groups.flatMap((group) => group.items);
  return {
    generatedAt: "2026-10-07T01:30:00.000Z",
    generatedBy: staffProfile.fullName,
    filters: { categorySlug, includeZeroStock: true },
    categories: groups,
    totals: {
      products: items.length,
      lines: items.reduce((sum, item) => sum + Math.max(1, item.lines.length), 0),
      units: items.reduce((sum, item) => sum + item.total, 0),
      needsPrice: items.length,
      unverifiedCostUnits: items.reduce((sum, item) => sum + item.unverifiedCostQuantity, 0)
    }
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("staff print the whole inventory as an A4 portrait ending-inventory or count sheet", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Printing is a desktop staff workflow; PDF output is Chromium-only.");
  const reportRequests: Array<string | null> = [];
  const unhandled: string[] = [];
  await authorizeMockedWorkspace(page, "STAFF");
  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/backend/auth/me") return json(route, { profile: staffProfile });
    if (url.pathname === "/api/backend/auth/departments") return json(route, { departments: [] });
    if (url.pathname === "/api/backend/notifications") return json(route, { notifications: [], nextCursor: null });
    if (await fulfillWorkspaceShellExtras(route)) return;
    if (url.pathname === "/api/backend/notifications/unread-count") return json(route, { unreadCount: 0 });
    if (url.pathname === "/api/backend/realtime/updates") return json(route, { cursor: "0", hasMore: false, events: [] });
    if (url.pathname === "/api/backend/staff/products/inventory-report") {
      reportRequests.push(url.searchParams.get("category"));
      return json(route, { report: reportFor(url.searchParams.get("category")) });
    }
    if (url.pathname === "/api/backend/staff/products") return json(route, { products: [], categories, nextCursor: null });
    unhandled.push(`${request.method()} ${url.pathname}`);
    return json(route, { error: "Unexpected API request in inventory report test." }, 500);
  });

  await page.goto("/staff/inventory");
  await dismissWelcomeGate(page);
  await page.getByRole("button", { name: "Print inventory" }).click();

  const doc = page.locator("#inventory-report-print-area");
  await expect(doc.getByText("Ending Inventory", { exact: true })).toBeVisible();
  await expect(doc.getByText("PE T-shirt (Elementary)", { exact: true })).toBeVisible();
  await expect(doc.getByRole("cell", { name: "#8", exact: true }).first()).toBeVisible();
  await expect(doc.getByText("Subtotal — Uniforms")).toBeVisible();
  const totalUnits = reportFor(null).totals.units.toLocaleString("en-PH");
  await expect(doc.locator(".ird-totals")).toContainText(totalUnits);
  await expect(doc.getByText("Physical count")).toHaveCount(0);

  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await testInfo.attach("inventory-report.pdf", { body: pdf, contentType: "application/pdf" });
  const mediaBox = pdf.toString("latin1").match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  expect(mediaBox, "PDF page size").not.toBeNull();
  expect(Number(mediaBox![1])).toBeLessThan(Number(mediaBox![2]));

  await page.emulateMedia({ media: "print" });
  await expect(doc).toBeVisible();
  await expect(page.getByRole("button", { name: "Print inventory" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Add product" })).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  await page.getByLabel("Count sheet (blank count columns)").check();
  await expect(doc.getByText("Inventory Count Sheet", { exact: true })).toBeVisible();
  await expect(doc.getByRole("columnheader", { name: "Physical count" }).first()).toBeVisible();
  await expect(doc.getByText("Counted by: ______________________")).toBeVisible();

  await page.getByLabel("Report category").selectOption("paraphernalia");
  await expect.poll(() => reportRequests.at(-1)).toBe("paraphernalia");
  await expect(doc.getByText("WUP Pin", { exact: true })).toBeVisible();
  await expect(doc.getByText("PE T-shirt (Elementary)", { exact: true })).toHaveCount(0);
  expect(unhandled).toEqual([]);
});
