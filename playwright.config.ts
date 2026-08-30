import { defineConfig, devices } from "@playwright/test";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm dev:e2e",
    url: "http://127.0.0.1:3100/heroes",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL_WEB_TEST:
        process.env.DATABASE_URL_WEB_TEST ??
        "postgresql://medota2_web:medota2_web@127.0.0.1:54321/medota2_test",
    },
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
