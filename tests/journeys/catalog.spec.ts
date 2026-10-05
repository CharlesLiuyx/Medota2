import { expect, test } from "../e2e/test-fixture";

// Read-only journeys work against the user's current data. Fixed numerical
// fixture checks are added by CI / --fixture without resetting development data.
for (const entity of ["heroes", "abilities"] as const) {
  test(`${entity}: query, filter and open a detail`, async ({
    page,
    request,
  }) => {
    const response = await request.get(`/api/catalog/${entity}`);
    expect(response.ok()).toBe(true);
    expect(response.headers()["x-medota2-environment-verification"]).toBe(
      "verified",
    );
    const data = await response.json();
    if (process.env.MEDOTA2_EXPECTED_DATA_VERSION) {
      expect(`${data.datasetVersionId}:${data.assetDatasetVersionId}`).toBe(
        process.env.MEDOTA2_EXPECTED_DATA_VERSION,
      );
    }
    await page.goto(`/${entity}`);
    const link = page.locator(`a[href^="/${entity}/"]`).first();
    await expect(link).toBeVisible();
    const icon = link.locator("img").first();
    await expect(icon).toBeVisible();
    await expect
      .poll(() =>
        icon.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const iconUrl = await icon.evaluate(
      (image: HTMLImageElement) => image.currentSrc,
    );
    const asset = await request.get(iconUrl);
    expect(asset.ok()).toBe(true);
    expect(asset.headers()["content-type"]).toMatch(/^image\//);
    if (process.env.MEDOTA2_SHARED_WEB === "1") {
      const workbench = await request
        .get("/api/development")
        .then((response) => response.json());
      if (workbench.dataSource === "local-review") {
        expect(asset.headers()["x-medota2-asset-source"]).toMatch(
          /^(exact|alias)$/,
        );
        expect(asset.headers()["x-medota2-asset-path"]).not.toMatch(
          /^generated\//,
        );
      }
    }
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/${entity}/[^?]+`));
    await expect(page.locator("h1")).toBeVisible();
    await page.goto(`/${entity}?q=antimage`);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(`a[href^="/${entity}/"]`).first()).toBeVisible();
  });
}

test("heroes: fixed fixture has the known movement speed", async ({
  request,
  page,
}) => {
  test.skip(
    process.env.MEDOTA2_SHARED_WEB === "1",
    "Known values use the reusable fixture database.",
  );
  const response = await request.get("/api/catalog/heroes?q=antimage");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.items).toHaveLength(1);
  expect(body.items[0].internalName).toBe("npc_dota_hero_antimage");
  expect(Number(body.items[0].movementSpeed)).toBe(310);
  // Detail includes the stored scalar, so this covers parse → persistence → render.
  await page.goto("/heroes/antimage");
  const speed = page
    .locator("dt")
    .filter({ hasText: /^移动速度$/ })
    .locator("..")
    .locator("dd");
  await expect(speed).toHaveText("310");
});
