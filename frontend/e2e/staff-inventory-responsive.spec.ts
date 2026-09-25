import { expect, test, type Page, type Route } from "@playwright/test";
import type { BackendAuthProfile } from "../lib/api";
import type { StaffCategory, StaffProduct } from "../lib/staff-api";
import { authorizeMockedWorkspace, dismissWelcomeGate } from "./helpers";

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
  departmentId: null,
  onboardingCompletedAt: null,
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

const archivedProduct: StaffProduct = {
  id: "00000000-0000-4000-8000-000000000205",
  categoryId: category.id,
  name: "Archived Laboratory Gown",
  description: "Archived test product with inventory history preserved.",
  imageUrl: null,
  price: "450.00",
  oldPrice: null,
  status: "IN_STOCK",
  stock: 5,
  lowStockThreshold: 2,
  isActive: false,
  saleMode: "OPTIONS",
  skuInventoryEnabled: true,
  inventoryReconciledAt: "2026-08-24T08:00:00.000Z",
  category,
  variants: [
    { id: "gown-medium", optionName: "Size", optionValue: "Medium", stock: 5, lowStockThreshold: 2 }
  ],
  skus: [
    {
      id: "gown-medium-sku",
      code: "GOWN-M",
      stock: 5,
      lowStockThreshold: 2,
      isActive: true,
      variantIds: ["gown-medium"],
      options: [{ optionName: "Size", optionValue: "Medium" }]
    }
  ]
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockInventory(page: Page) {
  await authorizeMockedWorkspace(page, "STAFF");
  const unhandled: string[] = [];
  const restoredRequests: string[] = [];
  let archivedProducts = [archivedProduct];
  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const path = requestUrl.pathname;

    if (path === "/api/backend/auth/me" && request.method() === "GET") {
      await json(route, { profile: staffProfile });
      return;
    }
    if (path === "/api/backend/auth/departments" && request.method() === "GET") {
      await json(route, { departments: [] });
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
    if (path === "/api/backend/realtime/updates" && request.method() === "GET") {
      await json(route, { cursor: "0", hasMore: false, events: [] });
      return;
    }
    if (path === "/api/backend/staff/products" && request.method() === "GET") {
      const archived = requestUrl.searchParams.get("visibility") === "ARCHIVED";
      await json(route, {
        products: archived ? archivedProducts : [clothProduct, optionProduct],
        categories: [category],
        nextCursor: null
      });
      return;
    }
    const batchProduct = [clothProduct, optionProduct].find((product) => path === `/api/backend/staff/products/${product.id}/batches`);
    if (batchProduct && request.method() === "GET") {
      const unitCost = batchProduct.id === clothProduct.id ? 80 : 200;
      await json(route, {
        batches: [{
          id: `${batchProduct.id}-batch`,
          batchCode: batchProduct.id === clothProduct.id ? "B-CLOTH-001" : "B-PE-001",
          skuId: batchProduct.id === optionProduct.id ? optionProduct.skus?.[0]?.id ?? null : null,
          quantityReceived: batchProduct.stock,
          quantityRemaining: batchProduct.stock,
          unitCost,
          costVerified: true,
          receivedAt: "2026-09-24T00:00:00.000Z",
          supplierNote: "QA delivery",
          sku: batchProduct.id === optionProduct.id ? { code: "PE-M-RED", optionSnapshot: [{ optionName: "Size", optionValue: "M" }, { optionName: "Color", optionValue: "Red" }] } : null
        }],
        summary: {
          latestCost: unitCost,
          averageInventoryCost: unitCost,
          inventoryValue: batchProduct.stock * unitCost,
          unverifiedQuantity: 0
        }
      });
      return;
    }
    if (path === `/api/backend/staff/products/${archivedProduct.id}/restore` && request.method() === "POST") {
      restoredRequests.push(archivedProduct.id);
      archivedProducts = [];
      await json(route, { product: { ...archivedProduct, isActive: true } });
      return;
    }

    unhandled.push(`${request.method()} ${path}`);
    await json(route, { error: "Unexpected API request in inventory test." }, 500);
  });
  return { restoredRequests, unhandled };
}

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "short-laptop", width: 1366, height: 650 },
  { name: "mobile", width: 390, height: 844 }
] as const;

for (const viewport of viewports) {
  test(`cloth-only and SKU inventory stay correct and responsive on ${viewport.name}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Explicit viewport matrix runs once.");
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { restoredRequests, unhandled } = await mockInventory(page);

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

    if (viewport.width >= 1280) {
      const productHeading = page.getByText("Product", { exact: true }).first();
      const categoryHeading = page.getByText("Category", { exact: true }).first();
      const [productBox, categoryBox] = await Promise.all([productHeading.boundingBox(), categoryHeading.boundingBox()]);
      expect(productBox).not.toBeNull();
      expect(categoryBox).not.toBeNull();
      expect(Math.abs((productBox?.y ?? 0) - (categoryBox?.y ?? 0))).toBeLessThan(3);
      expect(categoryBox?.x ?? 0).toBeGreaterThan((productBox?.x ?? 0) + (productBox?.width ?? 0));
    }

    const clothUpdateButton = clothRow.getByRole("button", { name: "Update stock" });
    await clothUpdateButton.click();
    const clothDialog = page.getByRole("dialog", { name: "Update stock" });
    await expect(clothDialog).toBeVisible();
    await expect(clothDialog.getByText("New items received")).toBeVisible();
    await expect(clothDialog.getByText("PHP 125.00", { exact: true })).toBeVisible();
    await clothDialog.getByLabel("New items received").fill("2");
    await clothDialog.getByLabel("Unit acquisition cost").fill("80");
    await expect(clothDialog.getByText(/PHP 45\.00 \/ item/)).toBeVisible();
    await clothDialog.getByLabel("Selling price", { exact: true }).fill("150");
    await expect(clothDialog.getByText(/PHP 70\.00 \/ item/)).toBeVisible();
    const clothSaveButton = clothDialog.getByRole("button", { name: "Confirm & add" });
    const saveButtonBox = await clothSaveButton.boundingBox();
    expect(saveButtonBox).not.toBeNull();
    expect((saveButtonBox?.y ?? 0) + (saveButtonBox?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
    await clothSaveButton.click();
    const clothConfirmation = page.getByRole("alertdialog", { name: "Add this inventory stock?" });
    await expect(clothConfirmation).toContainText("2 new items");
    await expect(clothConfirmation).toContainText("selling price will change from PHP 125.00 to PHP 150.00");
    await expect(clothConfirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(clothDialog).toBeVisible();
    await expect(clothSaveButton).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(clothDialog).toBeHidden();
    await expect(clothUpdateButton).toBeFocused();

    const manageButton = optionRow.getByRole("button", { name: "Manage" });
    await manageButton.click();
    const managerDialog = page.getByRole("dialog", { name: "Manage product" });
    await expect(managerDialog).toBeVisible();
    await managerDialog.getByRole("button", { name: /^Edit details/ }).click();
    const detailsDialog = page.getByRole("dialog", { name: "Edit details" });
    await expect(detailsDialog.getByText("PHP 350.00", { exact: true }).first()).toBeVisible();
    await expect(detailsDialog.getByText("PHP 200.00", { exact: true }).first()).toBeVisible();
    await expect(detailsDialog.getByText("PHP 150.00 / item", { exact: true })).toBeVisible();
    const sellingPriceInput = detailsDialog.getByLabel("Selling price", { exact: true });
    const oldPriceInput = detailsDialog.getByLabel(/Old price/);
    const [sellingPriceBox, oldPriceBox] = await Promise.all([sellingPriceInput.boundingBox(), oldPriceInput.boundingBox()]);
    expect(sellingPriceBox).not.toBeNull();
    expect(oldPriceBox).not.toBeNull();
    expect(oldPriceBox?.y ?? 0).toBeGreaterThanOrEqual((sellingPriceBox?.y ?? 0) + (sellingPriceBox?.height ?? 0));
    await detailsDialog.getByRole("button", { name: "Back to manage product" }).click();
    const combinationsButton = managerDialog.getByRole("button", { name: /^Inventory combinations/ });
    await combinationsButton.click();

    const skuDialog = page.getByRole("dialog", { name: "Update stock" });
    await expect(skuDialog).toBeVisible();
    await expect(skuDialog.getByText("Size: M · Color: Red", { exact: true })).toBeVisible();
    await expect(skuDialog.getByText("Size: L · Color: Blue", { exact: true })).toBeVisible();
    await skuDialog.getByLabel("Combination 1 new quantity").fill("1");
    await skuDialog.getByLabel("Unit acquisition cost").fill("200");
    await expect(skuDialog.getByText(/PHP 150\.00 \/ item/)).toBeVisible();
    await skuDialog.getByLabel("Selling price", { exact: true }).fill("400");
    await expect(skuDialog.getByText(/PHP 200\.00 \/ item/)).toBeVisible();
    const skuSaveButton = skuDialog.getByRole("button", { name: "Confirm & add" });
    await skuSaveButton.click();
    const skuConfirmation = page.getByRole("alertdialog", { name: "Add this inventory stock?" });
    await expect(skuConfirmation).toContainText("1 new item");
    await expect(skuConfirmation).toContainText("selling price will change from PHP 350.00 to PHP 400.00");
    await page.keyboard.press("Escape");
    await expect(skuDialog).toBeVisible();
    await expect(skuSaveButton).toBeFocused();
    await skuDialog.getByRole("button", { name: "Edit options and rebuild combinations" }).click();

    const setupDialog = page.getByRole("dialog", { name: "Set up inventory" });
    const saveStructureButton = setupDialog.getByRole("button", { name: "Save structure & inventory" });
    await saveStructureButton.click();
    const confirmation = page.getByRole("alertdialog", { name: "Save inventory structure?" });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("exact available counts shown");
    await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeHidden();
    await expect(setupDialog).toBeVisible();
    await expect(saveStructureButton).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(setupDialog).toBeHidden();
    await expect(managerDialog).toBeVisible();
    await expect(combinationsButton).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(managerDialog).toBeHidden();
    await expect(manageButton).toBeFocused();

    await page.getByRole("button", { name: "Archived items" }).click();
    await expect(page.getByRole("heading", { name: "Archived inventory" })).toBeVisible();
    const archivedRow = page.locator("article").filter({ hasText: archivedProduct.name }).first();
    await expect(archivedRow).toBeVisible();
    await expect(archivedRow).toContainText("Archived");
    await expect(archivedRow.getByRole("button", { name: "Manage" })).toHaveCount(0);
    await expect(archivedRow.getByRole("button", { name: "Update stock" })).toHaveCount(0);

    const restoreButton = archivedRow.getByRole("button", { name: "Restore item" });
    await restoreButton.click();
    const restoreConfirmation = page.getByRole("alertdialog", { name: "Restore this product?" });
    await expect(restoreConfirmation).toContainText("existing stock, options, and reservation history");
    await expect(restoreConfirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(restoreConfirmation).toBeHidden();
    await expect(restoreButton).toBeFocused();
    expect(restoredRequests).toEqual([]);

    await restoreButton.click();
    await page.getByRole("alertdialog", { name: "Restore this product?" }).getByRole("button", { name: "Restore product" }).click();
    await expect(archivedRow).toBeHidden();
    await expect(page.getByText(`${archivedProduct.name} restored to active inventory.`)).toBeVisible();
    expect(restoredRequests).toEqual([archivedProduct.id]);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(unhandled).toEqual([]);
  });
}
