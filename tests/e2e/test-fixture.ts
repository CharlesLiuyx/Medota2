import {
  expect,
  test as playwrightTest,
  type Page,
  type Route,
} from "@playwright/test";

const test = playwrightTest.extend({
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
