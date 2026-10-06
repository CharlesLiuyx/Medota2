import { defineConfig, devices } from "@playwright/test";

const shared = process.env.MEDOTA2_SHARED_WEB === "1";
const port = shared ? 3000 : Number(process.env.MEDOTA2_TEST_WEB_PORT);
const artifacts = process.env.MEDOTA2_ARTIFACT_ROOT;
if (!artifacts || !Number.isInteger(port) || port < 1)
  throw new Error(
    "Use pnpm check or pnpm test:journeys so the runner supplies the environment.",
  );
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./tests/journeys",
  globalSetup: "./tests/helpers/warm-browser-server.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: `${artifacts}/test-results`,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: `${artifacts}/report` }],
  ],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: shared
    ? undefined
    : {
        command: `pnpm exec next dev --webpack -H 127.0.0.1 -p ${port}`,
        url: `${baseURL}/heroes`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { MEDOTA2_PROCESS_ROLE: "web" },
      },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
