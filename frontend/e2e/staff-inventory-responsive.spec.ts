import { expect, test, type Page, type Route } from "@playwright/test";
import type { BackendAuthProfile } from "../lib/api";
import type { StaffCategory, StaffProduct } from "../lib/staff-api";
import { authorizeMockedWorkspace, dismissWelcomeGate, fulfillWorkspaceShellExtras } from "./helpers";

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
  const createdRequests: Array<Record<string, unknown>> = [];
  const restockRequests: Array<{ productId: string; body: Record<string, unknown> }> = [];
  const priceRequests: Array<{ productId: string; body: Record<string, unknown> }> = [];
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
    if (await fulfillWorkspaceShellExtras(route)) return;
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
    if (path === "/api/backend/staff/products" && request.method() === "POST") {
      const payload = request.postDataJSON() as {
        name: string;
        categoryName: string;
        description?: string | null;
        imageUrl?: string | null;
        price: number;
        oldPrice?: number | null;
        stock: number;
        lowStockPercent: number;
        saleMode: StaffProduct["saleMode"];
        audienceScope?: StaffProduct["audienceScope"];
        variants?: Array<{ optionName: string; optionValue: string; stock: number }>;
      };
      createdRequests.push(payload as unknown as Record<string, unknown>);
      const variants = (payload.variants ?? []).map((variant, index) => ({
        id: `00000000-0000-4000-8000-${String(300 + index).padStart(12, "0")}`,
        ...variant,
        stockTarget: variant.stock,
        lowStockPercent: payload.lowStockPercent,
        lowStockThreshold: Math.ceil(variant.stock * payload.lowStockPercent / 100)
      }));
      const skus = variants.map((variant, index) => ({
        id: `00000000-0000-4000-8000-${String(400 + index).padStart(12, "0")}`,
        code: `TEST-SKU-${index + 1}`,
        stock: variant.stock,
        stockTarget: variant.stock,
        lowStockPercent: payload.lowStockPercent,
        lowStockThreshold: variant.lowStockThreshold,
        isActive: true,
        variantIds: [variant.id],
        options: [{ optionName: variant.optionName, optionValue: variant.optionValue }]
      }));
      await json(route, {
        product: {
          id: "00000000-0000-4000-8000-000000000299",
          categoryId: category.id,
          name: payload.name,
          description: payload.description ?? null,
          imageUrl: payload.imageUrl ?? null,
          price: payload.price,
          oldPrice: payload.oldPrice ?? null,
          status: payload.stock > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
          stock: payload.stock,
          stockTarget: payload.stock,
          lowStockPercent: payload.lowStockPercent,
          lowStockThreshold: Math.ceil(payload.stock * payload.lowStockPercent / 100),
          isActive: true,
          saleMode: payload.saleMode,
          audienceScope: payload.audienceScope ?? "ALL_STUDENTS",
          targetDepartments: [],
          skuInventoryEnabled: variants.length > 0,
          inventoryReconciledAt: variants.length ? "2026-09-28T00:00:00.000Z" : null,
          category,
          variants,
          skus
        }
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
    const restockMatch = path.match(/^\/api\/backend\/staff\/products\/([^/]+)\/(skus\/)?restock$/);
    if (restockMatch && request.method() === "POST") {
      const product = [clothProduct, optionProduct].find((entry) => entry.id === restockMatch[1])!;
      const body = request.postDataJSON() as Record<string, unknown>;
      restockRequests.push({ productId: product.id, body });
      if (restockMatch[2]) {
        const quantities = body.quantities as Array<{ skuId: string; quantity: number }>;
        const skus = (product.skus ?? []).map((sku) => {
          const entered = quantities.find((entry) => entry.skuId === sku.id)?.quantity ?? 0;
          return { ...sku, stock: body.mode === "set" ? entered : sku.stock + entered };
        });
        await json(route, { product: { ...product, skus, stock: skus.reduce((total, sku) => total + sku.stock, 0) } });
      } else {
        const quantity = body.quantity as number;
        await json(route, { product: { ...product, stock: body.mode === "set" ? quantity : product.stock + quantity } });
      }
      return;
    }
    const priceProduct = [clothProduct, optionProduct].find((product) => path === `/api/backend/staff/products/${product.id}`);
    if (priceProduct && request.method() === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      priceRequests.push({ productId: priceProduct.id, body });
      await json(route, { product: { ...priceProduct, price: String(body.price) } });
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
  return { restoredRequests, createdRequests, restockRequests, priceRequests, unhandled };
}

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "short-laptop", width: 1366, height: 650 },
  { name: "mobile", width: 390, height: 844 }
] as const;

test("add-product dialog uses percentage alerts without React key warnings", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Console regression runs once.");
  const keyWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes('unique "key" prop')) {
      keyWarnings.push(message.text());
    }
  });
  const { createdRequests, unhandled } = await mockInventory(page);

  await page.goto("/staff/inventory");
  await dismissWelcomeGate(page);
  await expect(page.getByRole("heading", { name: "Centralized stock management" })).toBeVisible();
  keyWarnings.length = 0;
  await page.getByRole("button", { name: "Add product" }).click();

  const dialog = page.getByRole("dialog", { name: "Add inventory item" });
  await expect(dialog).toBeVisible();
  const productDetails = dialog.locator("section").filter({ has: page.getByRole("heading", { name: "Product details" }) });
  await expect(productDetails.getByText("Selling price", { exact: true })).toBeVisible();
  await expect(productDetails.getByText("Opening stock cost", { exact: true })).toBeVisible();
  await expect(productDetails.getByLabel("Unit cost")).toBeVisible();
  const stockSetup = dialog.locator("section").filter({ has: page.getByRole("heading", { name: "Stock setup" }) });
  await expect(stockSetup.getByText("Opening stock cost", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Reorder alert")).toHaveValue("25");
  await expect(dialog.getByText(/alerted at 0 units or fewer/i)).toBeVisible();
  await dialog.getByLabel(/Start from a WUP template/).selectOption("elem-pe-shirt");
  await expect(dialog.getByText(/reorder alert below is applied automatically to every size/i)).toBeVisible();
  await dialog.getByRole("group", { name: "Size presets" }).getByRole("button", { name: "XS\u20133XL" }).click();
  await expect(dialog.getByLabel("Size 1 name")).toHaveValue("XS");
  await expect(dialog.getByLabel("Size 7 name")).toHaveValue("3XL");
  await dialog.getByRole("button", { name: "Save product" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("article").filter({ hasText: "Elementary PE Shirt" })).toBeVisible();
  expect(createdRequests).toHaveLength(1);
  expect(createdRequests[0]).toMatchObject({ lowStockPercent: 25, saleMode: "OPTIONS" });
  expect((createdRequests[0].variants as Array<{ optionValue: string }>).map((variant) => variant.optionValue)).toEqual(["XS", "S", "M", "L", "XL", "2XL", "3XL"]);
  expect(createdRequests[0]).not.toHaveProperty("lowStockThreshold");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Add product" }).click();
  const mobileDialog = page.getByRole("dialog", { name: "Add inventory item" });
  await expect(mobileDialog).toBeVisible();
  expect(await mobileDialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await mobileDialog.getByRole("button", { name: "Close product form" }).click();

  expect(keyWarnings).toEqual([]);
  expect(unhandled).toEqual([]);
});

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
    await expect(clothDialog.getByRole("tab", { name: "Receive stock" })).toHaveAttribute("aria-selected", "true");
    await expect(clothDialog.getByText("PHP 125.00", { exact: true })).toBeVisible();
    const clothSaveButton = clothDialog.getByRole("button", { name: "Receive stock" });
    await expect(clothSaveButton).toBeDisabled();
    await expect(clothDialog.getByText("Enter the quantity received.")).toBeVisible();
    await clothDialog.getByLabel("Quantity received").fill("2");
    await expect(clothDialog.getByText("Enter the unit cost.")).toBeVisible();
    await clothDialog.getByLabel("Unit cost").fill("80");
    await expect(clothDialog.getByText(/PHP 45\.00 per unit \(36\.0%\)/)).toBeVisible();
    await expect(clothDialog.getByLabel("Summary")).toContainText("New stock on hand20");
    await expect(clothDialog.getByLabel(/selling price/i)).toHaveCount(0);
    const saveButtonBox = await clothSaveButton.boundingBox();
    expect(saveButtonBox).not.toBeNull();
    expect((saveButtonBox?.y ?? 0) + (saveButtonBox?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
    await clothSaveButton.click();
    const clothConfirmation = page.getByRole("alertdialog", { name: "Receive this stock?" });
    await expect(clothConfirmation).toContainText("Receive 2 units of Premium Cotton Cloth at PHP 80.00 per unit");
    await expect(clothConfirmation).toContainText("18 \u2192 20");
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
    await expect(detailsDialog.getByText("PHP 150.00 per unit", { exact: true })).toBeVisible();
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
    await expect(skuDialog.getByText("Size \u00b7 Color", { exact: true })).toBeVisible();
    await expect(skuDialog.getByText("M \u00b7 Red", { exact: true })).toBeVisible();
    await expect(skuDialog.getByText("L \u00b7 Blue", { exact: true })).toBeVisible();
    await skuDialog.getByLabel("Size: M \u00b7 Color: Red quantity received").fill("1");
    await skuDialog.getByLabel("Unit cost").fill("200");
    await expect(skuDialog.getByText(/PHP 150\.00 per unit/)).toBeVisible();
    await expect(skuDialog.getByLabel("Summary")).toContainText("New stock on hand8");
    const skuSaveButton = skuDialog.getByRole("button", { name: "Receive stock" });
    await skuSaveButton.click();
    const skuConfirmation = page.getByRole("alertdialog", { name: "Receive this stock?" });
    await expect(skuConfirmation).toContainText("Receive 1 unit of PE Shirt With Variants at PHP 200.00 per unit");
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

test("count-sheet items show what staff still need to set and can be filtered", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One attention-filter contract is sufficient.");
  const importedCloth: StaffProduct = {
    ...clothProduct,
    id: "00000000-0000-4000-8000-000000000206",
    name: "HS Male Uniform Cloth",
    price: "0.00",
    stock: 457,
    imageUrl: null,
    needsPrice: true,
    unverifiedCostQuantity: 457,
    hasPhoto: false
  };
  const needsRequested: Array<string | null> = [];
  await authorizeMockedWorkspace(page, "STAFF");
  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const path = requestUrl.pathname;
    if (path === "/api/backend/auth/me") return json(route, { profile: staffProfile });
    if (path === "/api/backend/auth/departments") return json(route, { departments: [] });
    if (path === "/api/backend/notifications") return json(route, { notifications: [], nextCursor: null });
    if (await fulfillWorkspaceShellExtras(route)) return;
    if (path === "/api/backend/notifications/unread-count") return json(route, { unreadCount: 0 });
    if (path === "/api/backend/realtime/updates") return json(route, { cursor: "0", hasMore: false, events: [] });
    if (path === "/api/backend/staff/products" && request.method() === "GET") {
      const needs = requestUrl.searchParams.get("needs");
      needsRequested.push(needs);
      return json(route, { products: needs === "PRICE" ? [importedCloth] : [importedCloth, clothProduct], categories: [category], nextCursor: null });
    }
    return json(route, { error: "Unexpected API request in attention-filter test." }, 500);
  });

  await page.goto("/staff/inventory");
  await dismissWelcomeGate(page);
  const importedRow = page.locator("article").filter({ hasText: importedCloth.name }).first();
  await expect(importedRow.getByText("Needs price", { exact: true })).toBeVisible();
  await expect(importedRow.getByText("Needs cost · 457")).toBeVisible();
  await expect(importedRow.getByText("No photo", { exact: true })).toBeVisible();
  await expect(importedRow.locator("img").first()).toHaveAttribute("src", /product-placeholder\.svg/);
  const pricedRow = page.locator("article").filter({ hasText: clothProduct.name }).first();
  await expect(pricedRow.getByText("Needs price", { exact: true })).toHaveCount(0);

  await page.getByLabel("Filter by status").selectOption("Needs price");
  await expect.poll(() => needsRequested.at(-1)).toBe("PRICE");
  await expect(page.locator("article").filter({ hasText: clothProduct.name })).toHaveCount(0);
  await expect(importedRow).toBeVisible();
});

test("stock adjustments record the variance and reason, and price changes are a separate action", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One adjustment contract is sufficient.");
  const { restockRequests, priceRequests, unhandled } = await mockInventory(page);

  await page.goto("/staff/inventory");
  await dismissWelcomeGate(page);
  const clothRow = page.locator("article").filter({ hasText: clothProduct.name }).first();
  await clothRow.getByRole("button", { name: "Update stock" }).click();
  const dialog = page.getByRole("dialog", { name: "Update stock" });

  await dialog.getByRole("tab", { name: "Adjust stock count" }).click();
  const physicalCount = dialog.getByLabel("Physical count");
  await expect(physicalCount).toHaveValue("18");
  const postButton = dialog.getByRole("button", { name: "Post adjustment" });
  await expect(postButton).toBeDisabled();
  await expect(dialog.getByText(/No variance yet/)).toBeVisible();
  await physicalCount.fill("15");
  await expect(dialog.getByLabel("Summary")).toContainText("Variance−3");
  await dialog.getByLabel("Adjustment reason").selectOption("Damaged / defective");
  await dialog.getByLabel("Remarks").fill("water damage");
  await postButton.click();
  const confirmation = page.getByRole("alertdialog", { name: "Post this stock adjustment?" });
  await expect(confirmation).toContainText("system stock 18 → physical count 15 (variance −3)");
  await confirmation.getByRole("button", { name: "Post adjustment" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Premium Cotton Cloth adjusted to 15 units/)).toBeVisible();
  expect(restockRequests).toHaveLength(1);
  expect(restockRequests[0].body).toMatchObject({
    mode: "set",
    quantity: 15,
    notes: "Stock count adjustment - Damaged / defective: water damage"
  });
  expect(restockRequests[0].body).not.toHaveProperty("unitCost");
  expect(restockRequests[0].body).not.toHaveProperty("sellingPrice");

  await clothRow.getByRole("button", { name: "Update stock" }).click();
  await dialog.getByRole("tab", { name: "Update selling price" }).click();
  await dialog.getByLabel("New selling price").fill("150");
  await expect(dialog.getByText(/Margin at the new price of PHP 150\.00: PHP 70\.00 per unit/)).toBeVisible();
  await dialog.getByRole("button", { name: "Update price" }).click();
  await page.getByRole("alertdialog", { name: "Update the selling price?" }).getByRole("button", { name: "Update price" }).click();
  await expect(dialog).toBeHidden();
  expect(priceRequests).toEqual([{ productId: clothProduct.id, body: { price: 150, notes: "Selling price updated from Update stock." } }]);
  expect(restockRequests).toHaveLength(1);
  expect(unhandled).toEqual([]);
});

test("stock count posts only the items with a variance", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One stock-count contract is sufficient.");
  const { restockRequests, unhandled } = await mockInventory(page);

  await page.goto("/staff/inventory");
  await dismissWelcomeGate(page);
  await page.getByRole("button", { name: "Stock count" }).click();
  const workspace = page.getByRole("region", { name: "Stock count" });
  await expect(workspace).toBeVisible();
  await expect(page.locator("#inventory-product-list")).toHaveCount(0);

  const postButton = workspace.getByRole("button", { name: /^Post/ });
  await expect(postButton).toBeDisabled();
  await workspace.getByLabel("Premium Cotton Cloth All units physical count").fill("20");
  await workspace.getByLabel("PE Shirt With Variants M · Red physical count").fill("4");
  await workspace.getByLabel("PE Shirt With Variants L · Blue physical count").fill("1");
  await expect(workspace).toContainText("2 items with variance");
  await expect(workspace).toContainText("Over +2");
  await expect(workspace).toContainText("Short −2");

  await workspace.getByLabel("Only items with variance").check();
  await expect(postButton).toHaveText("Post 2 adjustments");
  await postButton.click();
  await page.getByRole("alertdialog", { name: "Post 2 stock adjustments?" }).getByRole("button", { name: "Post adjustments" }).click();
  await expect(workspace.getByRole("status")).toContainText("2 adjustments posted.");

  expect(restockRequests).toHaveLength(2);
  expect(restockRequests.find((entry) => entry.productId === clothProduct.id)?.body).toMatchObject({ mode: "set", quantity: 20, notes: "Stock count adjustment - Physical inventory count" });
  const skuBody = restockRequests.find((entry) => entry.productId === optionProduct.id)?.body as { mode: string; quantities: Array<{ skuId: string; quantity: number }> };
  expect(skuBody.mode).toBe("set");
  expect([...skuBody.quantities].sort((left, right) => left.skuId.localeCompare(right.skuId))).toEqual([{ skuId: "sku-l-blue", quantity: 1 }, { skuId: "sku-m-red", quantity: 4 }]);
  await expect(workspace.getByLabel("Only items with variance")).not.toBeChecked();
  await expect(workspace.getByLabel("Premium Cotton Cloth All units physical count")).toHaveValue("");
  await expect(workspace.getByText("Posted", { exact: true })).toHaveCount(2);
  await expect(postButton).toBeDisabled();
  expect(unhandled).toEqual([]);
});
