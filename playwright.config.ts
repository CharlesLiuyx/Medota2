import { defineConfig, devices } from "@playwright/test";

const runId = requiredEnvironment("MEDOTA2_RUN_ID");
const webPort = requiredPort("MEDOTA2_TEST_WEB_PORT");
const artifactRoot = requiredEnvironment("MEDOTA2_ARTIFACT_ROOT");
const nextDistDirectory = requiredEnvironment("NEXT_DIST_DIR");
const nextTsconfigPath = requiredEnvironment("MEDOTA2_NEXT_TSCONFIG");
const baseURL = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  outputDir: `${artifactRoot}/playwright/test-results`,
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: `${artifactRoot}/playwright/report` },
    ],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm exec next dev --webpack -H 127.0.0.1 -p ${webPort}`,
    url: `${baseURL}/heroes`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      MEDOTA2_PROCESS_ROLE: "web",
      MEDOTA2_ENVIRONMENT: "test",
      MEDOTA2_DATA_CLASS: "synthetic-fixture",
      MEDOTA2_RUN_ID: runId,
      MEDOTA2_STATE_DIRECTORY: requiredEnvironment("MEDOTA2_STATE_DIRECTORY"),
      MEDOTA2_NETWORK_POLICY: "loopback-only",
      MEDOTA2_ARTIFACT_ROOT: artifactRoot,
      MEDOTA2_TEST_WEB_PORT: String(webPort),
      MEDOTA2_NEXT_TSCONFIG: nextTsconfigPath,
      NEXT_DIST_DIR: nextDistDirectory,
    },
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});

function requiredEnvironment(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required from Test Run Harness.`);
  return value;
}

function requiredPort(key: string): number {
  const port = Number(requiredEnvironment(key));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${key} must be a valid port.`);
  }
  return port;
}
