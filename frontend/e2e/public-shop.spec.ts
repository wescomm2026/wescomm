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

test("mobile shop renders two compact product cards per row without horizontal overflow", async ({ page }, testInfo) => {
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
  await expect(page.getByRole("button", { name: /Notify me about Mobile Shop Pen Set restock/ })).toBeVisible();

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

test("student wishlist saves, removes, and enables an out-of-stock alert", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One browser project is enough for the API-backed wishlist lifecycle.");

  const wishlist = new Set<string>();
  const mutations: string[] = [];
  await page.route("**/api/backend/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/backend/auth/me") {
      await json(route, {
        profile: {
          id: "73000000-0000-4000-8000-000000000001",
          role: "STUDENT",
          studentNumber: "QA-WISHLIST-001",
          fullName: "Wishlist QA Student",
          email: "wishlist.qa@wesleyan.edu.ph",
          phone: null,
          department: null,
          address: null,
          avatarUrl: null
        }
      });
      return;
    }
    if (path === "/api/backend/products") {
      await json(route, { products: shopFixtures });
      return;
    }
    if (path === "/api/backend/wishlist" && request.method() === "GET") {
      await json(route, {
        wishlist: Array.from(wishlist, (productId) => ({ productId, createdAt: "2026-07-23T00:00:00.000Z" }))
      });
      return;
    }
    const wishlistMatch = path.match(/^\/api\/backend\/wishlist\/([^/]+)$/);
    if (wishlistMatch && request.method() === "POST") {
      const productId = decodeURIComponent(wishlistMatch[1]);
      wishlist.add(productId);
      mutations.push(`POST:${productId}`);
      await json(route, { wishlistItem: { productId, createdAt: "2026-07-23T00:00:00.000Z" } }, 201);
      return;
    }
    if (wishlistMatch && request.method() === "DELETE") {
      const productId = decodeURIComponent(wishlistMatch[1]);
      wishlist.delete(productId);
      mutations.push(`DELETE:${productId}`);
      await route.fulfill({ status: 204 });
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
      await json(route, {
        notifications: [{
          id: "74000000-0000-4000-8000-000000000001",
          userId: "73000000-0000-4000-8000-000000000001",
          title: "Mobile Shop Pen Set is back in stock",
          message: "Open your wishlist to view the item.",
          type: "BACK_IN_STOCK",
          actionUrl: `/student/shop?wishlist=1&product=${shopFixtures[1].id}`,
          readAt: null,
          createdAt: "2026-07-23T00:00:00.000Z"
        }]
      });
      return;
    }
    if (path === "/api/backend/notifications/74000000-0000-4000-8000-000000000001/read") {
      await json(route, { notification: null });
      return;
    }
    if (path === "/api/backend/push/public-key") {
      await json(route, { enabled: false, publicKey: "" });
      return;
    }

    await json(route, { error: `Unexpected mocked API request: ${request.method()} ${path}` }, 500);
  });

  await page.goto("/student/shop");
  await dismissWelcomeGate(page);

  const inStockHeart = page.getByRole("button", { name: "Add Mobile Shop Notebook to wishlist" });
  await expect(inStockHeart).toHaveAttribute("aria-pressed", "false");
  await expect(inStockHeart).toBeEnabled();
  const firstSaveResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname.endsWith(`/wishlist/${shopFixtures[0].id}`)
  );
  await inStockHeart.click();
  await firstSaveResponse;
  await expect(page.getByRole("button", { name: "Remove Mobile Shop Notebook from wishlist" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Saved to your wishlist")).toBeVisible();

  const restockButton = page.getByRole("button", { name: "Notify me about Mobile Shop Pen Set restock" });
  const restockSaveResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname.endsWith(`/wishlist/${shopFixtures[1].id}`)
  );
  await restockButton.click();
  await restockSaveResponse;
  await expect(page.getByText("Restock alert turned on")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop Mobile Shop Pen Set restock" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /Notifications, 1 unread/ }).click();
  await page.getByRole("link", { name: /Mobile Shop Pen Set is back in stock/ }).click();
  await expect(page).toHaveURL(new RegExp(`wishlist=1&product=${shopFixtures[1].id}`));
  await expect(page.getByRole("button", { name: /^Wishlist 2 items$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article", { name: "Mobile Shop Pen Set" })).toHaveClass(/ring-2/);

  const removeResponse = page.waitForResponse((response) =>
    response.request().method() === "DELETE" &&
    new URL(response.url()).pathname.endsWith(`/wishlist/${shopFixtures[0].id}`)
  );
  await page.getByRole("button", { name: "Remove Mobile Shop Notebook from wishlist" }).click();
  await removeResponse;
  await expect(page.getByRole("article", { name: "Mobile Shop Notebook" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Wishlist 1 items$/ })).toHaveAttribute("aria-pressed", "true");

  expect(mutations).toEqual([
    `POST:${shopFixtures[0].id}`,
    `POST:${shopFixtures[1].id}`,
    `DELETE:${shopFixtures[0].id}`
  ]);
});
