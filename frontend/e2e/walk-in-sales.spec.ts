import { expect, test, type Page, type Route } from "@playwright/test";
import type { BackendAuthProfile } from "../lib/api";
import type { StaffProduct, WalkInReceipt } from "../lib/staff-api";
import { authorizeMockedWorkspace, dismissWelcomeGate, fulfillWorkspaceShellExtras } from "./helpers";

const staffProfile: BackendAuthProfile = {
  id: "00000000-0000-4000-8000-000000000601",
  role: "STAFF",
  studentNumber: null,
  fullName: "Walk-in QA Cashier",
  email: "walkin.qa@wesleyan.edu.ph",
  phone: null,
  department: "Commissary",
  departmentId: null,
  onboardingCompletedAt: null,
  address: null,
  avatarUrl: null
};

const skuProduct: StaffProduct = {
  id: "00000000-0000-4000-8000-000000000602",
  categoryId: "00000000-0000-4000-8000-000000000603",
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
  inventoryReconciledAt: "2026-09-28T08:00:00.000Z",
  category: { id: "00000000-0000-4000-8000-000000000603", name: "Uniforms", slug: "uniforms" },
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

// Record what each print() call would send to the printer instead of opening
// the browser print dialog. Runs in every frame, including the srcdoc print view.
async function capturePrints(page: Page) {
  await page.addInitScript(() => {
    const target = window.top as Window & { __printedReceipts?: string[] };
    target.__printedReceipts ??= [];
    window.print = () => {
      target.__printedReceipts!.push(document.querySelector(".receipt")?.textContent?.replace(/\s+/g, " ").trim() ?? "");
    };
  });
}

async function printedReceipts(page: Page) {
  return page.evaluate(() => (window as Window & { __printedReceipts?: string[] }).__printedReceipts ?? []);
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

test("staff record a SKU walk-in sale with cash, then void it to restore stock", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One full walk-in sale transaction is sufficient.");
  let salePayload: Record<string, unknown> | null = null;
  let voidPayload: Record<string, unknown> | null = null;
  let receipt: WalkInReceipt | null = null;
  const unhandled: string[] = [];
  await authorizeMockedWorkspace(page, "STAFF");
  await capturePrints(page);

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (await handleShellRequest(route)) return;

    if (path === "/api/backend/staff/products" && request.method() === "GET") {
      const query = new URL(request.url()).searchParams.get("query") ?? "";
      return json(route, {
        products: !query || skuProduct.name.toLowerCase().includes(query.toLowerCase()) ? [skuProduct] : [],
        categories: [skuProduct.category],
        nextCursor: null
      });
    }
    if (path === "/api/backend/staff/students" && request.method() === "GET") {
      return json(route, { items: [], nextCursor: null });
    }
    if (path === "/api/backend/staff/walk-in-sales" && request.method() === "GET") {
      return json(route, { items: receipt ? [receipt] : [], nextCursor: null });
    }
    if (path === "/api/backend/staff/walk-in-sales" && request.method() === "POST") {
      salePayload = request.postDataJSON() as Record<string, unknown>;
      const items = (salePayload.items as Array<{ productId: string; skuId?: string; quantity: number }>) ?? [];
      const total = items.reduce((sum, item) => sum + item.quantity * 350, 0);
      const treasury = salePayload.collectionChannel === "TREASURER";
      const cashReceived = Number(salePayload.cashReceived ?? 0);
      const clientSaleId = String(salePayload.clientSaleId ?? "");
      const officialReceiptNumber = treasury ? String(salePayload.officialReceiptNumber) : null;
      receipt = {
        id: treasury ? "00000000-0000-4000-8000-000000000606" : "00000000-0000-4000-8000-000000000605",
        receiptCode: treasury ? "RCT-2026-TREAS1" : "RCT-2026-TEST01",
        studentId: null,
        buyerName: String(salePayload.buyerName),
        collectionChannel: treasury ? "TREASURER" : "COMMISSARY",
        officialReceiptNumber,
        treasuryReconciliationRequired: false,
        publicVerificationUrl: "http://127.0.0.1:3100/verify-receipt#v=e2e-token",
        totalAmount: total.toFixed(2),
        paymentMethod: "CASH",
        status: "VERIFIED",
        issuedAt: "2026-09-28T08:30:00.000Z",
        verifiedAt: "2026-09-28T08:30:00.000Z",
        voidedAt: null,
        voidableUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        createdAt: "2026-09-28T08:30:00.000Z",
        updatedAt: "2026-09-28T08:30:00.000Z",
        student: null,
        issuedBy: { id: staffProfile.id, fullName: staffProfile.fullName },
        sale: {
          collectionChannel: treasury ? "TREASURER" : "COMMISSARY",
          officialReceiptNumber,
          treasuryVerifiedById: treasury ? staffProfile.id : null,
          treasuryVerifiedAt: treasury ? "2026-09-28T08:30:00.000Z" : null,
          cashTendered: treasury ? null : cashReceived.toFixed(2),
          changeDue: treasury ? null : Math.max(0, cashReceived - total).toFixed(2),
          cashierId: staffProfile.id,
          cashierName: staffProfile.fullName,
          clientSaleId,
          voidedById: null,
          voidReason: null,
          voidedAt: null
        },
        items: items.map((item, index) => ({
          id: `00000000-0000-4000-8000-${String(700 + index).padStart(12, "0")}`,
          productId: item.productId,
          skuId: item.skuId ?? null,
          variantId: null,
          productName: skuProduct.name,
          options: item.skuId === "sku-m-red"
            ? [{ optionName: "Size", optionValue: "M" }, { optionName: "Color", optionValue: "Red" }]
            : [{ optionName: "Size", optionValue: "L" }, { optionName: "Color", optionValue: "Blue" }],
          quantity: item.quantity,
          unitPrice: "350.00",
          subtotal: (item.quantity * 350).toFixed(2)
        }))
      };
      return json(route, { receipt });
    }
    if (/\/api\/backend\/staff\/walk-in-sales\/[^/]+\/void$/.test(path) && request.method() === "POST") {
      voidPayload = request.postDataJSON() as Record<string, unknown>;
      receipt = receipt
        ? {
            ...receipt,
            status: "VOIDED",
            treasuryReconciliationRequired: receipt.collectionChannel === "TREASURER",
            voidedAt: "2026-09-28T09:00:00.000Z",
            voidableUntil: null,
            updatedAt: "2026-09-28T09:00:00.000Z",
            sale: receipt.sale ? {
              ...receipt.sale,
              voidedById: staffProfile.id,
              voidReason: String(voidPayload.reason ?? ""),
              voidedAt: "2026-09-28T09:00:00.000Z"
            } : null
          }
        : null;
      return json(route, { receipt });
    }

    unhandled.push(`${request.method()} ${path}`);
    return json(route, { error: "Unexpected API request in walk-in sale test." }, 500);
  });

  await page.goto("/staff/walk-in-sales");
  await dismissWelcomeGate(page);
  await expect(page.getByRole("heading", { name: "Record physical-store purchases" })).toBeVisible();

  await expect(page.getByText("PE Shirt With Variants").first()).toBeVisible();
  await page.getByRole("button", { name: "Add PE Shirt With Variants to sale" }).click();

  const skuPicker = page.getByRole("dialog");
  await skuPicker.getByLabel("Size").selectOption("M");
  await skuPicker.getByLabel("Color").selectOption("Red");
  await expect(skuPicker.getByText("4 pc(s)")).toBeVisible();
  await skuPicker.getByRole("button", { name: "Add to sale" }).click();
  await expect(page.getByText("1 line item")).toBeVisible();

  const saveButton = page.getByRole("button", { name: "Save sale & deduct stock" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByText("Enter the walk-in buyer's name before saving.")).toBeVisible();

  await page.getByPlaceholder("Enter buyer name").fill("Maria Walk-in");
  await expect(page.getByText(/This can be saved as a walk-in buyer/)).toBeVisible();
  await saveButton.click();
  await expect(page.getByText("Enter a cash amount that covers the sale total.")).toBeVisible();
  await page.getByLabel(/Cash received/).fill("500.00");

  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  const success = page.getByRole("dialog");
  await expect(success.getByText("Sale recorded")).toBeVisible();
  await expect(success.getByText("RCT-2026-TEST01")).toBeVisible();
  await expect(success.getByText(/Change/)).toBeVisible();

  await success.getByRole("button", { name: "Print receipt" }).click();
  await expect.poll(async () => (await printedReceipts(page)).length).toBe(1);
  const [original] = await printedReceipts(page);
  expect(original).toContain("RCT-2026-TEST01");
  expect(original).toContain("Sales Receipt");
  expect(original).toContain("Maria Walk-in");
  expect(original).toContain("Size: M / Color: Red");
  expect(original).toContain("Collected at Commissary");
  expect(original).toContain("Cash received PHP 500.00");
  expect(original).toContain("Change PHP 150.00");
  expect(original).toContain("Scan to verify this receipt");
  expect(original).not.toContain("REPRINT");

  expect(salePayload).not.toBeNull();
  const recordedSale = salePayload as unknown as {
    items: Array<{ productId: string; skuId?: string; variantId?: string; quantity: number }>;
    cashReceived: number;
    clientSaleId: string;
    buyerName: string;
    studentId?: string;
  };
  expect(recordedSale.items[0]?.skuId).toBe("sku-m-red");
  expect(recordedSale.items[0]?.variantId).toBeUndefined();
  expect(recordedSale.items[0]?.quantity).toBe(1);
  expect(recordedSale.cashReceived).toBe(500);
  expect((recordedSale as unknown as { collectionChannel: string }).collectionChannel).toBe("COMMISSARY");
  expect(recordedSale.buyerName).toBe("Maria Walk-in");
  expect(recordedSale.studentId).toBeUndefined();
  expect(recordedSale.clientSaleId).toMatch(/^[0-9a-f-]{36}$/);

  await success.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Sales history", exact: true }).click();
  await expect(page.getByText("RCT-2026-TEST01").first()).toBeVisible();
  await expect(page.getByText(/^Void allowed until /)).toBeVisible();
  await page.getByRole("button", { name: "Void & restore stock" }).click();

  const voidDialog = page.getByRole("dialog");
  await expect(voidDialog.getByText("The items go back to inventory.")).toBeVisible();
  await expect(voidDialog.getByText(/\(2-day void period\)/)).toBeVisible();
  await voidDialog.getByRole("group", { name: "Common reasons" }).getByRole("button", { name: "Wrong size \u2014 exchange" }).click();
  await expect(voidDialog.getByLabel("Reason (required)")).toHaveValue("Wrong size \u2014 exchange");
  await voidDialog.getByLabel("Reason (required)").fill("Wrong size handed to the student");
  await voidDialog.getByRole("button", { name: "Void & restore stock" }).click();

  await expect(voidDialog).toBeHidden();
  expect(voidPayload).toEqual({ reason: "Wrong size handed to the student" });
  await expect(page.getByText("RCT-2026-TEST01 voided and stock restored.")).toBeVisible();

  await page.getByRole("button", { name: "Reprint receipt RCT-2026-TEST01" }).click();
  await expect.poll(async () => (await printedReceipts(page)).length).toBe(2);
  const reprint = (await printedReceipts(page))[1];
  expect(reprint).toContain("VOIDED");
  expect(reprint).toContain("REPRINT");
  expect(reprint).toContain("Wrong size handed to the student");
  expect(unhandled).toEqual([]);
});

test("staff release a Treasury-paid walk-in sale with an inspected OR and no cash handling", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One Treasury walk-in transaction is sufficient.");
  let salePayload: Record<string, unknown> | null = null;
  let receipt: WalkInReceipt | null = null;
  const unhandled: string[] = [];
  await authorizeMockedWorkspace(page, "STAFF");
  await capturePrints(page);

  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (await handleShellRequest(route)) return;
    if (path === "/api/backend/staff/products" && request.method() === "GET") {
      return json(route, { products: [skuProduct], categories: [skuProduct.category], nextCursor: null });
    }
    if (path === "/api/backend/staff/students" && request.method() === "GET") {
      return json(route, { items: [], nextCursor: null });
    }
    if (path === "/api/backend/staff/walk-in-sales" && request.method() === "GET") {
      return json(route, { items: receipt ? [receipt] : [], nextCursor: null });
    }
    if (path === "/api/backend/staff/walk-in-sales" && request.method() === "POST") {
      salePayload = request.postDataJSON() as Record<string, unknown>;
      receipt = {
        id: "00000000-0000-4000-8000-000000000606",
        receiptCode: "RCT-2026-TREAS1",
        studentId: null,
        buyerName: String(salePayload.buyerName),
        collectionChannel: "TREASURER",
        officialReceiptNumber: String(salePayload.officialReceiptNumber),
        treasuryReconciliationRequired: false,
        publicVerificationUrl: "http://127.0.0.1:3100/verify-receipt#v=e2e-token",
        totalAmount: "350.00",
        paymentMethod: "CASH",
        status: "VERIFIED",
        issuedAt: "2026-09-28T08:30:00.000Z",
        verifiedAt: "2026-09-28T08:30:00.000Z",
        voidedAt: null,
        createdAt: "2026-09-28T08:30:00.000Z",
        updatedAt: "2026-09-28T08:30:00.000Z",
        student: null,
        issuedBy: { id: staffProfile.id, fullName: staffProfile.fullName },
        sale: {
          collectionChannel: "TREASURER",
          officialReceiptNumber: String(salePayload.officialReceiptNumber),
          treasuryVerifiedById: staffProfile.id,
          treasuryVerifiedAt: "2026-09-28T08:30:00.000Z",
          cashTendered: null,
          changeDue: null,
          cashierId: staffProfile.id,
          cashierName: staffProfile.fullName,
          clientSaleId: String(salePayload.clientSaleId),
          voidedById: null,
          voidReason: null,
          voidedAt: null
        },
        items: [{
          id: "00000000-0000-4000-8000-000000000710",
          productId: skuProduct.id,
          skuId: "sku-l-blue",
          variantId: null,
          productName: skuProduct.name,
          options: [{ optionName: "Size", optionValue: "L" }, { optionName: "Color", optionValue: "Blue" }],
          quantity: 1,
          unitPrice: "350.00",
          subtotal: "350.00"
        }]
      };
      return json(route, { receipt });
    }
    unhandled.push(`${request.method()} ${path}`);
    return json(route, { error: "Unexpected API request in Treasury walk-in test." }, 500);
  });

  await page.goto("/staff/walk-in-sales");
  await dismissWelcomeGate(page);
  await page.getByRole("button", { name: "Add PE Shirt With Variants to sale" }).click();
  const skuPicker = page.getByRole("dialog");
  await skuPicker.getByLabel("Size").selectOption("L");
  await skuPicker.getByLabel("Color").selectOption("Blue");
  await skuPicker.getByRole("button", { name: "Add to sale" }).click();
  await page.getByPlaceholder("Enter buyer name").fill("Juan Treasury");

  await page.getByRole("radio", { name: "Treasury" }).check({ force: true });
  await expect(page.getByLabel(/Cash received/)).toHaveCount(0);

  const saveButton = page.getByRole("button", { name: "Save sale & deduct stock" });
  await saveButton.click();
  await expect(page.getByText("Enter the Treasury OR number before saving.")).toBeVisible();
  await page.getByLabel("Treasury OR number").fill("or-55501");
  await saveButton.click();
  await expect(page.getByText("Confirm that you inspected the Treasury official receipt before releasing items.")).toBeVisible();
  expect(salePayload).toBeNull();

  await page.getByLabel(/I inspected the Treasury official receipt/).check();
  await saveButton.click();

  const success = page.getByRole("dialog");
  await expect(success.getByText("Sale recorded")).toBeVisible();
  await expect(success.getByText("OR-55501")).toBeVisible();
  await expect(success.getByText("Cash received")).toHaveCount(0);

  expect(salePayload).toMatchObject({
    collectionChannel: "TREASURER",
    officialReceiptNumber: "OR-55501",
    treasuryReceiptInspected: true,
    buyerName: "Juan Treasury"
  });
  expect(salePayload).not.toHaveProperty("cashReceived");

  await success.getByRole("button", { name: "Print receipt" }).click();
  await expect.poll(async () => (await printedReceipts(page)).length).toBe(1);
  const [printed] = await printedReceipts(page);
  expect(printed).toContain("Collected at Treasury");
  expect(printed).toContain("Treasury OR No. OR-55501");
  expect(printed).not.toContain("Cash received");
  expect(printed).not.toContain("Change");
  expect(unhandled).toEqual([]);
});

test("receipt printer width is chosen per computer and defaults to 58 mm", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Printer settings are a desktop cashier workflow.");
  await authorizeMockedWorkspace(page, "STAFF");
  await capturePrints(page);
  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (await handleShellRequest(route)) return;
    if (path === "/api/backend/staff/products") return json(route, { products: [], categories: [], nextCursor: null });
    if (path === "/api/backend/staff/walk-in-sales") return json(route, { items: [], nextCursor: null });
    return json(route, { error: "Unexpected API request in printer settings test." }, 500);
  });

  await page.goto("/staff/walk-in-sales");
  await dismissWelcomeGate(page);
  await page.getByRole("button", { name: "Printer: 58 mm" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: /58 mm/ })).toBeChecked();
  await expect(dialog.frameLocator("iframe[title='Test receipt preview']").getByText("TEST RECEIPT")).toBeVisible();

  await dialog.getByRole("radio", { name: /80 mm/ }).check();
  await dialog.getByRole("button", { name: "Print test receipt" }).click();
  await expect.poll(async () => (await printedReceipts(page)).length).toBe(1);
  expect((await printedReceipts(page))[0]).toContain("72 mm printable on 80 mm paper");

  await dialog.getByRole("radio", { name: /Custom/ }).check();
  await dialog.getByLabel("Paper width (mm)").fill("120");
  await expect(dialog.getByRole("button", { name: "Save printer setting" })).toBeDisabled();
  await dialog.getByLabel("Paper width (mm)").fill("76");
  await expect(dialog.getByLabel("Printable width (mm)")).toHaveValue("68");
  await dialog.getByRole("button", { name: "Save printer setting" }).click();
  await expect(page.getByRole("button", { name: "Printer: 76 mm" })).toBeVisible();

  await page.reload();
  await dismissWelcomeGate(page);
  await expect(page.getByRole("button", { name: "Printer: 76 mm" })).toBeVisible();
});

test("after the 2-day void period staff cannot void a sale, but an admin can with a warning", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One void-window contract is sufficient.");
  const oldSale: WalkInReceipt = {
    id: "00000000-0000-4000-8000-000000000611",
    receiptCode: "RCT-2026-OLD001",
    studentId: null,
    buyerName: "Old Walk-in",
    collectionChannel: "COMMISSARY",
    officialReceiptNumber: null,
    treasuryReconciliationRequired: false,
    publicVerificationUrl: null,
    totalAmount: "350.00",
    paymentMethod: "CASH",
    status: "VERIFIED",
    issuedAt: "2026-09-20T08:30:00.000Z",
    verifiedAt: "2026-09-20T08:30:00.000Z",
    voidedAt: null,
    voidableUntil: "2026-09-22T15:59:00.000Z",
    createdAt: "2026-09-20T08:30:00.000Z",
    updatedAt: "2026-09-20T08:30:00.000Z",
    student: null,
    issuedBy: { id: staffProfile.id, fullName: staffProfile.fullName },
    sale: null,
    items: []
  } as unknown as WalkInReceipt;

  for (const role of ["STAFF", "ADMIN"] as const) {
    await page.context().clearCookies();
    await authorizeMockedWorkspace(page, role);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.route("**/api/backend/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/backend/auth/me") return json(route, { profile: { ...staffProfile, role } });
      if (await handleShellRequest(route)) return;
      if (path === "/api/backend/staff/products") return json(route, { products: [], categories: [], nextCursor: null });
      if (path === "/api/backend/staff/students") return json(route, { items: [], nextCursor: null });
      if (path === "/api/backend/staff/walk-in-sales") return json(route, { items: [oldSale], nextCursor: null });
      return json(route, { error: "Unexpected API request in void-window test." }, 500);
    });

    await page.goto(role === "ADMIN" ? "/admin/walk-in-sales" : "/staff/walk-in-sales");
    await dismissWelcomeGate(page);
    await page.getByRole("button", { name: "Sales history", exact: true }).click();
    await expect(page.getByText("RCT-2026-OLD001").first()).toBeVisible();
    await expect(page.getByText(/^Void period ended /)).toBeVisible();

    if (role === "STAFF") {
      await expect(page.getByText(/admin only/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Void period ended" })).toBeDisabled();
    } else {
      await page.getByRole("button", { name: "Void & restore stock" }).click();
      await expect(page.getByRole("dialog").getByRole("note")).toContainText("You are voiding as an admin");
    }
  }
});
