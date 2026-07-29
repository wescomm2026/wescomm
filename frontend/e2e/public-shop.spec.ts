import { expect, test, type Route } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

const shopFixtures = [
  {
    id: "71000000-0000-4000-8000-000000000001",
    name: "Mobile Shop Notebook",
    description: "Two-column shop layout fixture",
    imageUrl: null,
    price: "89.00",
    oldPrice: null,
    status: "IN_STOCK",
    stock: 8,
    category: { id: "72000000-0000-4000-8000-000000000001", name: "School Supplies", slug: "school-supplies" },
    variants: []
  },
  {
    id: "71000000-0000-4000-8000-000000000002",
    name: "Mobile Shop Pen Set",
    description: "Second mobile shop layout fixture",
    imageUrl: null,
    price: "49.00",
    oldPrice: null,
    status: "OUT_OF_STOCK",
    stock: 0,
    category: { id: "72000000-0000-4000-8000-000000000001", name: "School Supplies", slug: "school-supplies" },
    variants: []
  }
] as const;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

test("anonymous users can browse live products and use the cart without changing inventory", async ({ page }) => {
  await page.goto("/student/shop");
  await dismissWelcomeGate(page);

  await expect(page.getByPlaceholder("Search campus items")).toBeVisible();
  await expect(page.getByText(/^Showing \d+ of \d+ items$/)).toBeVisible();

  const addButton = page.getByRole("button", { name: "Add to Cart" }).first();
  await expect(addButton).toBeVisible();
  await addButton.click();

  const itemDialog = page.getByRole("dialog");
  await expect(itemDialog.getByRole("heading", { name: /Choose your (cloth item|item options)/ })).toBeVisible();
  await itemDialog.getByRole("button", { name: "Add to Cart" }).click();

  await expect(page.getByText("Added to your cart")).toBeVisible();
  await page.getByRole("button", { name: /Open cart with 1 item/ }).click();
  await expect(page.getByRole("dialog", { name: "My Cart" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in to Checkout" })).toBeVisible();
});

test("shop search filters the live catalog", async ({ page }) => {
  await page.goto("/student/shop");
  await dismissWelcomeGate(page);

  const search = page.getByPlaceholder("Search campus items");
  await search.fill("uniform");
  await expect(page.getByText(/^Showing \d+ of \d+ items$/)).toBeVisible();
  await expect(search).toHaveValue("uniform");
});

test("mobile student navigation opens as a web menu and changes pages", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobile navigation is covered by the mobile project.");

  await page.goto("/student/faq");
  await dismissWelcomeGate(page);
  await page.getByRole("button", { name: "Open student menu" }).click();

  await expect(page.getByRole("heading", { name: "WESCOMM Menu" })).toBeVisible();
  await page.getByRole("link", { name: /Shop/ }).click();
  await expect(page).toHaveURL(/\/student\/shop$/);
  await expect(page.getByPlaceholder("Search campus items")).toBeVisible();
});

test("mobile shop renders two compact product cards and opens a full image preview", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "The compact grid is a mobile-only layout requirement.");

  await page.route("**/api/backend/products", (route) => json(route, { products: shopFixtures }));
  await page.goto("/student/shop");
  await dismissWelcomeGate(page);

  const cards = page.getByTestId("shop-product-grid").getByRole("article");
  await expect(cards).toHaveCount(2);
  const [firstBox, secondBox] = await Promise.all([
    cards.nth(0).boundingBox(),
    cards.nth(1).boundingBox()
  ]);

  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(Math.abs((firstBox?.y ?? 0) - (secondBox?.y ?? 0))).toBeLessThanOrEqual(2);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const imagePreviewButton = page.getByRole("button", { name: "View full image of Mobile Shop Notebook" });
  await imagePreviewButton.click();

  const imageDialog = page.getByRole("dialog", { name: "Mobile Shop Notebook" });
  await expect(imageDialog).toBeVisible();
  await expect(imageDialog.getByRole("img", { name: "Full image of Mobile Shop Notebook" })).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Escape");
  await expect(imageDialog).toBeHidden();
  await expect(imagePreviewButton).toBeFocused();
});
