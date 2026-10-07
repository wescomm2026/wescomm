import { expect, test } from "@playwright/test";

const THEME_STORAGE_KEY = "wescomm-theme";

test.describe("color theme", () => {
  test("follows the device preference by default", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/privacy");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "system");

    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("persists an explicit dark preference across reloads", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/privacy");

    await page.getByRole("button", { name: /choose color theme/i }).click();
    await page.getByRole("button", { name: /^dark/i }).click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "dark");
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe("dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("an explicit light preference overrides a dark device", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [THEME_STORAGE_KEY, "light"]);
    await page.goto("/privacy");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "light");
  });

  test("literal light colors follow the dark theme on screen but print in light", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/privacy");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Older screens use literal classes; the generated compatibility sheet maps them to dark tokens.
    const colors = () => page.evaluate(() => {
      let panel = document.getElementById("theme-probe");
      if (!panel) {
        panel = document.createElement("div");
        panel.id = "theme-probe";
        panel.className = "bg-white text-[#17211b] border border-[#dfe8df]";
        panel.textContent = "probe";
        document.body.appendChild(panel);
      }
      const style = getComputedStyle(panel);
      const brightness = (value: string) => {
        const [r, g, b] = value.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
        return (r + g + b) / 3;
      };
      return { background: brightness(style.backgroundColor), text: brightness(style.color) };
    });

    const screen = await colors();
    expect(screen.background).toBeLessThan(60);
    expect(screen.text).toBeGreaterThan(180);

    await page.emulateMedia({ colorScheme: "dark", media: "print" });
    const printed = await colors();
    expect(printed.background).toBeGreaterThan(240);
    expect(printed.text).toBeLessThan(60);
  });
});
