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

function apiPath(requestUrl: string) {
  return new URL(requestUrl).pathname.replace(/^\/api(?:\/backend)?/, "");
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

test("mobile bottom navigation changes pages and opens secondary destinations", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobile navigation is covered by the mobile project.");

  await page.goto("/student/faq");
  await dismissWelcomeGate(page);
  await page.getByRole("link", { name: /Shop/ }).click();
  await expect(page).toHaveURL(/\/student\/shop$/);
  await expect(page.getByPlaceholder("Search campus items")).toBeVisible();

  await expect(page.getByRole("button", { name: "Open student menu" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open more navigation" }).click();
  const moreNavigation = page.getByRole("dialog", { name: "More from WESCOMM" });
  await expect(moreNavigation.getByRole("link", { name: "FAQ" })).toBeVisible();
  await expect(moreNavigation.getByRole("link", { name: "Support" })).toBeVisible();
  await moreNavigation.getByRole("link", { name: "FAQ" }).click();
  await expect(page).toHaveURL(/\/student\/faq$/);
});

test("mobile shop renders wishlist controls in two columns and opens a full image preview", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "The compact grid is a mobile-only layout requirement.");

  await page.route(/\/api(?:\/backend)?\/products(?:\?.*)?$/, (route) => json(route, { products: shopFixtures }));
  await page.goto("/student/shop");
  await dismissWelcomeGate(page);

  const cards = page.getByTestId("shop-product-grid").getByRole("article");
  await expect(cards).toHaveCount(2);
  for (const status of ["In Stock", "Restock Soon", "Out of Stock", "On Sale"]) {
    await expect(page.getByRole("button", { name: status })).toHaveAttribute("aria-pressed", "false");
  }
  await expect(page.getByLabel("Sort shop items")).toHaveValue("featured");
  const [firstBox, secondBox] = await Promise.all([
    cards.nth(0).boundingBox(),
    cards.nth(1).boundingBox()
  ]);

  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(Math.abs((firstBox?.y ?? 0) - (secondBox?.y ?? 0))).toBeLessThanOrEqual(2);
  await expect(page.getByRole("button", { name: /Notify me about Mobile Shop Pen Set restock/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Mobile Shop Pen Set to wishlist" })).toHaveCount(0);

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
  let releaseAuth: () => void = () => {};
  let authGate: Promise<void> | null = new Promise((resolve) => {
    releaseAuth = resolve;
  });
  let releaseWishlistRead: () => void = () => {};
  let wishlistReadGate: Promise<void> | null = new Promise((resolve) => {
    releaseWishlistRead = resolve;
  });
  let releaseWishlistWrite: () => void = () => {};
  let wishlistWriteGate: Promise<void> | null = new Promise((resolve) => {
    releaseWishlistWrite = resolve;
  });
  let failNextProductRead = false;
  let failNextWishlistDelete = false;

  await page.route(/\/api(?:\/backend)?\/.*/, async (route) => {
    const request = route.request();
    const path = apiPath(request.url());

    if (path === "/auth/me") {
      if (authGate) {
        await authGate;
        authGate = null;
      }
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
    if (path === "/products") {
      if (failNextProductRead) {
        failNextProductRead = false;
        await json(route, { error: "Temporary product refresh failure." }, 503);
        return;
      }
      await json(route, { products: shopFixtures });
      return;
    }
    if (path === "/wishlist" && request.method() === "GET") {
      const wishlistSnapshot = Array.from(wishlist);
      if (wishlistReadGate) {
        await wishlistReadGate;
        wishlistReadGate = null;
      }
      await json(route, {
        wishlist: wishlistSnapshot.map((productId) => ({ productId, createdAt: "2026-07-23T00:00:00.000Z" }))
      });
      return;
    }
    const wishlistMatch = path.match(/^\/wishlist\/([^/]+)$/);
    if (wishlistMatch && request.method() === "POST") {
      const productId = decodeURIComponent(wishlistMatch[1]);
      wishlist.add(productId);
      mutations.push(`POST:${productId}`);
      if (wishlistWriteGate) {
        await wishlistWriteGate;
        wishlistWriteGate = null;
      }
      await json(route, { wishlistItem: { productId, createdAt: "2026-07-23T00:00:00.000Z" } }, 201);
      return;
    }
    if (wishlistMatch && request.method() === "DELETE") {
      const productId = decodeURIComponent(wishlistMatch[1]);
      mutations.push(`DELETE:${productId}`);
      if (failNextWishlistDelete) {
        failNextWishlistDelete = false;
        await json(route, { error: "Temporary wishlist delete failure." }, 503);
        return;
      }
      wishlist.delete(productId);
      await route.fulfill({ status: 204 });
      return;
    }
    if (path === "/restrictions/me") {
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
    if (path === "/notifications") {
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
    if (path === "/notifications/74000000-0000-4000-8000-000000000001/read") {
      await json(route, { notification: null });
      return;
    }
    if (path === "/push/public-key") {
      await json(route, { enabled: false, publicKey: "" });
      return;
    }

    await json(route, { error: `Unexpected mocked API request: ${request.method()} ${path}` }, 500);
  });

  await page.goto("/student/shop");
  await dismissWelcomeGate(page);

  const inStockHeart = page.getByRole("button", { name: "Add Mobile Shop Notebook to wishlist" });
  await expect(inStockHeart).toHaveAttribute("aria-pressed", "false");
  await expect(inStockHeart).toBeDisabled();
  releaseAuth();
  await expect(inStockHeart).toBeEnabled();
  const firstSaveResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname.endsWith(`/wishlist/${shopFixtures[0].id}`)
  );
  await inStockHeart.click();
  const optimisticHeart = page.getByRole("button", { name: "Remove Mobile Shop Notebook from wishlist" });
  await expect(optimisticHeart).toHaveAttribute("aria-pressed", "true");
  await expect(optimisticHeart).toHaveAttribute("aria-busy", "true");
  await expect(optimisticHeart.locator(".animate-spin")).toHaveCount(0);
  releaseWishlistRead();
  await expect(optimisticHeart).toHaveAttribute("aria-pressed", "true");
  releaseWishlistWrite();
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

  await page.getByRole("button", { name: "Out of Stock" }).click();
  await expect(page.getByRole("article", { name: "Mobile Shop Notebook" })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Mobile Shop Pen Set" })).toHaveCount(1);
  const notificationTrigger = page.getByRole("button", { name: /Notifications, 1 unread/ });
  await notificationTrigger.click();
  const notificationRegion = page.getByRole("region", { name: "Student notifications" });
  await expect(notificationRegion).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(notificationRegion).toBeHidden();
  await expect(notificationTrigger).toBeFocused();
  await notificationTrigger.click();
  await page.getByRole("link", { name: /Mobile Shop Pen Set is back in stock/ }).click();
  await expect(page.getByRole("article", { name: "Mobile Shop Pen Set" })).toHaveClass(/ring-2/);

  await page.goto("/student/faq");
  await dismissWelcomeGate(page);
  failNextProductRead = true;
  wishlistReadGate = new Promise((resolve) => {
    releaseWishlistRead = resolve;
  });
  await page.getByRole("button", { name: /Notifications, 1 unread/ }).click();
  await page.getByRole("link", { name: /Mobile Shop Pen Set is back in stock/ }).click();
  await expect(page).toHaveURL(new RegExp(`wishlist=1&product=${shopFixtures[1].id}`));
  await expect(page.getByText("Loading your wishlist...")).toBeVisible();
  releaseWishlistRead();
  await expect(page.getByRole("button", { name: /^Wishlist 2 items$/ })).toHaveAttribute("aria-pressed", "true");
  const highlightedCard = page.getByRole("article", { name: "Mobile Shop Pen Set" });
  await expect(highlightedCard).toHaveClass(/ring-2/);
  await expect(highlightedCard).toBeInViewport();
  await expect(page.getByText("Temporary product refresh failure.")).toHaveCount(0);

  failNextWishlistDelete = true;
  const failedRemoveResponse = page.waitForResponse((response) =>
    response.request().method() === "DELETE" &&
    response.status() === 503 &&
    new URL(response.url()).pathname.endsWith(`/wishlist/${shopFixtures[0].id}`)
  );
  await page.getByRole("button", { name: "Remove Mobile Shop Notebook from wishlist" }).click();
  await failedRemoveResponse;
  await expect(page.getByText("Wishlist not updated")).toBeVisible();
  await expect(page.getByRole("article", { name: "Mobile Shop Notebook" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Wishlist 2 items$/ })).toBeFocused();

  const removeResponse = page.waitForResponse((response) =>
    response.request().method() === "DELETE" &&
    new URL(response.url()).pathname.endsWith(`/wishlist/${shopFixtures[0].id}`)
  );
  await page.getByRole("button", { name: "Remove Mobile Shop Notebook from wishlist" }).click();
  await removeResponse;
  await expect(page.getByRole("article", { name: "Mobile Shop Notebook" })).toHaveCount(0);
  const wishlistFilter = page.getByRole("button", { name: /^Wishlist 1 items$/ });
  await expect(wishlistFilter).toHaveAttribute("aria-pressed", "true");
  await expect(wishlistFilter).toBeFocused();

  expect(mutations).toEqual([
    `POST:${shopFixtures[0].id}`,
    `POST:${shopFixtures[1].id}`,
    `DELETE:${shopFixtures[0].id}`,
    `DELETE:${shopFixtures[0].id}`
  ]);
});

test("failed wishlist loading can recover without blocking wishlist controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One browser project is enough for wishlist recovery.");

  let wishlistReads = 0;
  await page.route(/\/api(?:\/backend)?\/.*/, async (route) => {
    const request = route.request();
    const path = apiPath(request.url());

    if (path === "/auth/me") {
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
    if (path === "/products") {
      await json(route, { products: shopFixtures });
      return;
    }
    if (path === "/wishlist" && request.method() === "GET") {
      wishlistReads += 1;
      if (wishlistReads === 1) {
        await json(route, { error: "Wishlist database is temporarily unavailable." }, 503);
      } else {
        await json(route, {
          wishlist: [{ productId: shopFixtures[0].id, createdAt: "2026-07-23T00:00:00.000Z" }]
        });
      }
      return;
    }
    if (path === "/restrictions/me") {
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
    if (path === "/notifications") {
      await json(route, { notifications: [] });
      return;
    }
    if (path === "/push/public-key") {
      await json(route, { enabled: false, publicKey: "" });
      return;
    }

    await json(route, { error: `Unexpected mocked API request: ${request.method()} ${path}` }, 500);
  });

  await page.goto("/student/shop");
  await dismissWelcomeGate(page);

  const unavailableHeart = page.getByRole("button", { name: "Add Mobile Shop Notebook to wishlist" });
  await expect(unavailableHeart).toBeEnabled();
  await expect(page.getByText(/Wishlist could not be loaded:/)).toBeVisible();

  await page.getByRole("button", { name: "Retry" }).click();
  const restoredHeart = page.getByRole("button", { name: "Remove Mobile Shop Notebook from wishlist" });
  await expect(restoredHeart).toBeEnabled();
  await expect(restoredHeart).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Wishlist could not be loaded:/)).toBeHidden();
  expect(wishlistReads).toBe(2);
});
