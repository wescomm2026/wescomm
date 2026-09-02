import { expect, test } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

test("account sign-in requires an explicit unchecked policy consent", async ({ page }) => {
  await page.goto("/student/dashboard?auth=login");
  await dismissWelcomeGate(page);

  const dialog = page.getByRole("dialog");
  const consent = dialog.getByRole("checkbox", { name: /I agree to the Terms & Conditions/ });
  const continueButton = dialog.getByRole("button", { name: /Continue to password|Send verification code/ });

  await expect(consent).not.toBeChecked();
  await expect(consent).toHaveAttribute("required", "");
  await expect(continueButton).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Terms & Conditions" })).toHaveAttribute("target", "_blank");
  await expect(dialog.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("target", "_blank");

  await consent.check();
  await expect(continueButton).toBeEnabled();
});
