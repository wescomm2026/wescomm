import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const frontendRoot = __dirname;
const backendRoot = path.resolve(frontendRoot, "../backend");
const frontendPort = Number(process.env.E2E_FRONTEND_PORT ?? 3100);
const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 4100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${frontendPort}`;
const backendHealthURL = process.env.E2E_BACKEND_HEALTH_URL ?? `http://127.0.0.1:${backendPort}/api/health/ready`;
const startLocalServers = process.env.E2E_SKIP_WEBSERVER !== "true";
const useProductionServers = process.env.E2E_USE_PRODUCTION === "true";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 12_000
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }]
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] }
    }
  ],
  webServer: startLocalServers
    ? [
        {
          command: useProductionServers ? "npm run build && npm start" : "npx tsx src/server.ts",
          cwd: backendRoot,
          env: {
            ...process.env,
            PORT: String(backendPort),
            FRONTEND_ORIGIN: baseURL,
            FRONTEND_ORIGINS: baseURL
          },
          url: backendHealthURL,
          reuseExistingServer: !process.env.CI,
          timeout: useProductionServers ? 240_000 : 120_000,
          stdout: "pipe",
          stderr: "pipe"
        },
        {
          command: useProductionServers
            ? `npm run build && npm run start -- -p ${frontendPort}`
            : `npm run dev -- -p ${frontendPort}`,
          cwd: frontendRoot,
          env: {
            ...process.env,
            NEXT_PUBLIC_E2E_TEST: "true",
            BACKEND_API_URL: `http://127.0.0.1:${backendPort}/api`,
            NEXT_PUBLIC_SUPABASE_URL: "https://wescomm-otp-e2e.invalid",
            NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-public-key",
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "e2e-public-key"
          },
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: useProductionServers ? 240_000 : 120_000,
          stdout: "pipe",
          stderr: "pipe"
        }
      ]
    : undefined
});
