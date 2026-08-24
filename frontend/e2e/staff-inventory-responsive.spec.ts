import { expect, test, type Page, type Route } from "@playwright/test";
import type { BackendAuthProfile } from "../lib/api";
import type { StaffCategory, StaffProduct } from "../lib/staff-api";
import { dismissWelcomeGate } from "./helpers";

const category: StaffCategory = {
  id: "00000000-0000-4000-8000-000000000201",
  name: "Uniforms",
  slug: "uniforms",
  isActive: true
};

const staffProfile: BackendAuthProfile = {
  id: "00000000-0000-4000-8000-000000000202",
  role: "STAFF",
  studentNumber: null,
  fullName: "Inventory QA Staff",
  email: "inventory.qa@wesleyan.edu.ph",
  phone: null,
  department: "Commissary",
  address: null,
  avatarUrl: null
};

const clothProduct: StaffProduct = {
  id: "00000000-0000-4000-8000-000000000203",
  categoryId: category.id,
  name: "Premium Cotton Cloth",
  description: "Cloth sold by quantity without size or color selection.",
  imageUrl: null,
  price: "125.00",
  oldPrice: null,
  status: "IN_STOCK",
  stock: 18,
  lowStockThreshold: 5,
  isActive: true,
  saleMode: "CLOTH_ONLY",
  skuInventoryEnabled: false,
  inventoryReconciledAt: null,
  category,
  variants: [],
  skus: []
};

const optionProduct: StaffProduct = {
  id: "00000000-0000-4000-8000-000000000204",
  categoryId: category.id,
  name: "PE Shirt With Variants",
  description: "Physical stock is tracked per size and color combination.",
  imageUrl: null,
  price: "350.00",
  oldPrice: null,
  status: "IN_STOCK",
  stock: 7,
  lowStockThreshold: 2,
  isActive: true,
  saleMode: "OPTIONS",
  skuInventoryEnabled: true,
  inventoryReconciledAt: "2026-08-24T08:00:00.000Z",
  category,
  variants: [
    { id: "size-m", optionName: "Size", optionValue: "M", stock: 4, lowStockThreshold: 1 },
    { id: "size-l", optionName: "Size", optionValue: "L", stock: 3, lowStockThreshold: 1 },
    { id: "color-red", optionName: "Color", optionValue: "Red", stock: 4, lowStockThreshold: 1 },
    { id: "color-blue", optionName: "Color", optionValue: "Blue", stock: 3, lowStockThreshold: 1 }
  ],
  skus: [
    {
      id: "sku-m-red",
      code: "PE-M-RED",
      stock: 4,
      lowStockThreshold: 1,
      isActive: true,
      variantIds: ["size-m", "color-red"],
      options: [
        { optionName: "Size", optionValue: "M" },
        { optionName: "Color", optionValue: "Red" }
      ]
    },
    {
      id: "sku-l-blue",
      code: "PE-L-BLUE",
      stock: 3,
      lowStockThreshold: 1,
      isActive: true,
      variantIds: ["size-l", "color-blue"],
      options: [
        { optionName: "Size", optionValue: "L" },
        { optionName: "Color", optionValue: "Blue" }
      ]
    }
  ]
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockInventory(page: Page) {
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
    if (path === "/api/backend/staff/products" && request.method() === "GET") {
      await json(route, {
        products: [clothProduct, optionProduct],
        categories: [category],
        nextCursor: null
      });
      return;
    }

    unhandled.push(`${request.method()} ${path}`);
    await json(route, { error: "Unexpected API request in inventory test." }, 500);
  });
  return unhandled;
}

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 }
] as const;

for (const viewport of viewports) {
  test(`cloth-only and SKU inventory stay correct and responsive on ${viewport.name}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Explicit viewport matrix runs once.");
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const unhandled = await mockInventory(page);

    await page.goto("/staff/inventory");
    await dismissWelcomeGate(page);
    await expect(page.getByRole("heading", { name: "Centralized stock management" })).toBeVisible();

    const clothRow = page.locator("article").filter({ hasText: clothProduct.name }).first();
    const optionRow = page.locator("article").filter({ hasText: optionProduct.name }).first();
    await expect(clothRow).toContainText("Cloth only");
    await expect(clothRow).toContainText("Cloth quantity only");
    await expect(clothRow).toContainText("18");
    await expect(optionRow).toContainText("Sizes / options");
    await expect(optionRow).toContainText("M · Red · 4");
    await expect(optionRow).toContainText("L · Blue · 3");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const clothUpdateButton = clothRow.getByRole("button", { name: "Update stock" });
    await clothUpdateButton.click();
    const clothDialog = page.getByRole("dialog", { name: "Update stock" });
    await expect(clothDialog).toBeVisible();
    await expect(clothDialog.getByText("New items received")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(clothDialog).toBeHidden();
    await expect(clothUpdateButton).toBeFocused();

    const manageButton = optionRow.getByRole("button", { name: "Manage" });
    await manageButton.click();
    const managerDialog = page.getByRole("dialog", { name: "Manage product" });
    await expect(managerDialog).toBeVisible();
    const combinationsButton = managerDialog.getByRole("button", { name: /^Inventory combinations/ });
    await combinationsButton.click();

    const skuDialog = page.getByRole("dialog", { name: "Update stock" });
    await expect(skuDialog).toBeVisible();
    await expect(skuDialog.getByText("Size: M · Color: Red", { exact: true })).toBeVisible();
    await expect(skuDialog.getByText("Size: L · Color: Blue", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(skuDialog).toBeHidden();
    await expect(managerDialog).toBeVisible();
    await expect(combinationsButton).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(managerDialog).toBeHidden();
    await expect(manageButton).toBeFocused();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(unhandled).toEqual([]);
  });
}
