import { defineConfig, devices } from "@playwright/test";

const frontendPort = Number(process.env.E2E_RELEASE_FRONTEND_PORT ?? 3200);
const baseURL = process.env.E2E_RELEASE_BASE_URL ?? `http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "conversation-retention.spec.ts",
    "operations-v2.spec.ts",
    "staff-chat-takeover-responsive.spec.ts",
    "staff-inventory-responsive.spec.ts",
    "staff-message-loading.spec.ts",
    "staff-reservation-confirmations.spec.ts",
    "student-wesbot-chat.spec.ts"
  ],
  fullyParallel: false,
  forbidOnly: true,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/release", open: "never" }]
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [{
    name: "desktop-chromium",
    use: { ...devices["Desktop Chrome"] }
  }],
  webServer: {
    command: `npm run dev -- -p ${frontendPort}`,
    cwd: __dirname,
    env: {
      ...process.env,
      NEXT_PUBLIC_ENABLE_DEV_LOGIN: "true",
      NEXT_PUBLIC_E2E_TEST: "true",
      E2E_WORKSPACE_BYPASS_TOKEN: "playwright-release-contracts",
      NEXT_PUBLIC_API_URL: "/api/backend",
      BACKEND_API_URL: "http://127.0.0.1:1/api",
      NEXT_PUBLIC_SUPABASE_URL: "https://wescomm-release-e2e.invalid",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "release-e2e-public-key",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "release-e2e-public-key"
    },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe"
  }
});
