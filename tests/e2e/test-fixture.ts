import {
  expect,
  test as playwrightTest,
  type Page,
  type Route,
} from "@playwright/test";

const test = playwrightTest.extend({
  request: async ({ playwright, extraHTTPHeaders }, runFixture) => {
    // Playwright shares a keep-alive agent across request contexts. A socket
    // left by another test can race Next's idle close; keep API probes isolated.
    const request = await playwright.request.newContext({
      extraHTTPHeaders: { ...extraHTTPHeaders, Connection: "close" },
    });
    try {
      await runFixture(request);
    } finally {
      await request.dispose();
    }
  },
  page: async ({ page }, runFixture) => {
    await installLoopbackOnlyRoute(page);
    await runFixture(page);
  },
});

async function installLoopbackOnlyRoute(page: Page): Promise<void> {
  await page.route("http://**/*", routeRequest);
  await page.route("https://**/*", routeRequest);
}

async function routeRequest(route: Route): Promise<void> {
  const hostname = new URL(route.request().url()).hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  ) {
    await route.continue();
    return;
  }
  await route.abort("blockedbyclient");
}

export { expect, test };
