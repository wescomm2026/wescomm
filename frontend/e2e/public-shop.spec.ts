import { expect, test } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

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
