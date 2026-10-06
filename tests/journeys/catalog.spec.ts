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

test("heroes and abilities: readable tooltips and mobile layout", async ({
  page,
}) => {
  await page.goto("/heroes/antimage");
  await expect(
    page.getByRole("heading", { name: "天赋树", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "英雄属性", exact: true }),
  ).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(
    /npc_dota_|DOTA_ABILITY_|special_bonus_|\{s:|%[a-z_]+%|SourceRevision|SHA-256/u,
  );
  await page.goto("/abilities/antimage_blink");
  await expect(
    page.getByRole("heading", { name: "闪烁", level: 1 }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText("冷却");
  await expect(page.locator("main")).toContainText("魔法消耗");
  expect(await page.locator("main").innerText()).not.toMatch(
    /antimage_blink|DOTA_|blink_range|BaseClass|Provenance/u,
  );
  if (process.env.MEDOTA2_SHARED_WEB !== "1") {
    await expect(page.locator("main")).toContainText("12 / 10 / 8 / 6");
    await expect(page.locator("main")).toContainText("750 / 900 / 1050 / 1200");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "/heroes",
    "/heroes/antimage",
    "/abilities",
    "/abilities/antimage_blink",
  ]) {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});
