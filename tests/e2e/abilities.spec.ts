import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test-fixture";

const TABLE_LIST = 'table[data-infinite-list][aria-label="Ability values"]';

test("registry defaults to current and restores canonical filter URL", async ({
  page,
}) => {
  await page.goto("/abilities");
  await expect(
    page.getByRole("heading", { name: "当前技能优先，全部定义可审计。" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "闪烁" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "闪烁 icon", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("fixture_unbound", { exact: true })).toHaveCount(
    0,
  );

  await page.getByLabel("状态").selectOption("defined_unbound");
  await page.getByLabel("语言").selectOption("en");
  await page
    .getByPlaceholder("名称或 internal name…")
    .fill(" fixture_unbound ");
  await page.getByRole("button", { name: "应用" }).click();
  await expect(page).toHaveURL(
    "/abilities?q=fixture_unbound&status=defined_unbound&lang=en",
  );
  await expect(
    page.getByRole("heading", { name: "fixture_unbound" }),
  ).toBeVisible();
});

test("ability registry continuously loads 4+ chunks, bounds its DOM, and restores the first item", async ({
  page,
}) => {
  test.slow();
  await page.goto("/abilities");
  const list = page.locator("[data-infinite-list]").filter({
    has: page.getByRole("list", { name: "技能结果" }),
  });
  await expect(list).toBeVisible();
  await expect(list.locator("[data-infinite-list-item]").first()).toBeVisible();

  const firstItemKey = await list
    .locator("[data-infinite-list-item]")
    .first()
    .getAttribute("data-infinite-list-key");
  if (!firstItemKey) throw new Error("Initial ability item has no stable key.");

  await expect(
    page.getByRole("navigation", { name: "Ability pages" }),
  ).toHaveCount(0);
  await expect(page.getByText(/上一页|下一页/iu)).toHaveCount(0);
  await expect(page.getByText(/page\s+\d+\s*\/\s*\d+/iu)).toHaveCount(0);
  await expect(page.locator('a[href*="page="]')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);

  const bottomSentinel = list.locator('[data-infinite-list-sentinel="after"]');
  const complete = list
    .locator(":scope > p:not([data-infinite-list-status])")
    .filter({ hasText: "已显示全部技能" });
  await scrollBoundaryUntil(page, bottomSentinel, async () =>
    complete.isVisible(),
  );

  await expect(complete).toBeVisible();
  await expect
    .poll(() => list.locator("[data-infinite-list-chunk]").count())
    .toBeGreaterThanOrEqual(5);
  await expect
    .poll(() => list.locator("[data-infinite-list-spacer]").count())
    .toBeGreaterThan(0);
  await expect
    .poll(() => list.locator("[data-infinite-list-item]").count())
    .toBeLessThan(192);

  const firstItem = list.locator(`[data-infinite-list-key="${firstItemKey}"]`);
  await expect(firstItem).toHaveCount(0);
  await list
    .locator('[data-infinite-list-sentinel="before"]')
    .scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(firstItem).toHaveCount(1);
  await firstItem.scrollIntoViewIfNeeded();
  await expect(firstItem).toBeVisible();
});

test("ability detail exposes values, modifiers, relations and provenance", async ({
  page,
}) => {
  await page.goto("/abilities/antimage_blink?lang=en");
  await expect(
    page.getByRole("heading", { name: "Blink", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "AbilityValues" }),
  ).toBeVisible();
  await expect(page.getByRole("row", { name: /blink_range/u })).toContainText(
    "750 · 900 · 1050 · 1200",
  );
  await expect(page.getByRole("row", { name: /blink_range/u })).toContainText(
    "special_bonus_unique_antimage_fixture",
  );
  await expect(
    page.getByRole("heading", { name: "Heroes & relations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Anti-Mage.*loadout/u }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provenance" })).toBeVisible();
  await expect(page.getByText("991daaf6fc24", { exact: false })).toBeVisible();

  const detailLists = page.locator("[data-infinite-list]");
  await expect(detailLists).toHaveCount(7);
  for (let index = 0; index < 7; index += 1) {
    await expect(
      detailLists.nth(index).locator("[data-infinite-list-item]").first(),
    ).toBeAttached();
  }
  await expect(page.locator("a[role=listitem]")).toHaveCount(0);
  await expect(page.locator("details[role=listitem]")).toHaveCount(0);
});

test("AbilityValues table lazily loads, recycles, and restores local chunks", async ({
  page,
}) => {
  test.slow();
  await page.goto("/abilities/fixture_scroll_001?lang=en");
  await expect(
    page.getByRole("heading", { name: "Scroll Fixture Ability 001", level: 1 }),
  ).toBeVisible();
  const table = page.locator(TABLE_LIST);
  await expect(table).toBeVisible();
  const firstRow = table.locator(
    '[data-infinite-list-key="0:fixture_value_001"]',
  );
  await expect(firstRow).toBeAttached();

  const bottomSentinel = table.locator('[data-infinite-list-sentinel="after"]');
  await scrollBoundaryUntil(
    page,
    bottomSentinel,
    async () =>
      (await table.locator("[data-infinite-list-chunk]").count()) >= 6,
  );
  await expect
    .poll(() => table.locator("[data-infinite-list-chunk]").count())
    .toBeGreaterThanOrEqual(6);
  await expect(
    table.locator('[data-infinite-list-key="143:fixture_value_144"]'),
  ).toBeAttached();

  await addScrollRunway(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => table.locator("[data-infinite-list-spacer]").count())
    .toBeGreaterThan(0);
  await expect
    .poll(() => table.locator("[data-infinite-list-item]").count())
    .toBeLessThan(144);
  await expect(firstRow).toHaveCount(0);

  await page.locator("[data-e2e-scroll-runway]").evaluate((element) => {
    element.remove();
  });
  await table
    .locator('[data-infinite-list-sentinel="before"]')
    .scrollIntoViewIfNeeded();
  await expect(firstRow).toHaveCount(1);
  await firstRow.scrollIntoViewIfNeeded();
  await expect(firstRow).toBeVisible();
});

test("missing abilities are exact 404s and stored icons remain accessible", async ({
  page,
}) => {
  await page.goto("/abilities/not_a_real_ability");
  await expect(
    page.getByRole("heading", { name: "没有这个 Ability internal name" }),
  ).toBeVisible();

  await page.goto("/abilities/antimage_blink");
  await expect(
    page.getByRole("img", { name: "闪烁 icon", exact: true }),
  ).toBeVisible();
});

test("asset route selects the smallest sufficient stored LoD", async ({
  request,
}) => {
  for (const [width, expectedLod, expectedType] of [
    [56, "w64", "image/webp"],
    [96, "w128", "image/webp"],
    [200, "w256", "image/webp"],
    [300, "w256", "image/webp"],
  ] as const) {
    const response = await request.get(
      `/valve-assets/ability/antimage_blink?width=${width}`,
    );
    expect(response.ok()).toBe(true);
    expect(response.headers()["x-medota2-asset-lod"]).toBe(expectedLod);
    expect(response.headers()["content-type"]).toBe(expectedType);
    expect((await response.body()).byteLength).toBeGreaterThan(0);
  }

  const original = await request.get("/valve-assets/ability/antimage_blink");
  expect(original.ok()).toBe(true);
  expect(original.headers()["x-medota2-asset-lod"]).toBe("original");
  expect(original.headers()["content-type"]).toBe("image/png");
});

async function scrollBoundaryUntil(
  page: Page,
  boundary: Locator,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await done()) return;
    await boundary.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(150);
  }
  expect(await done()).toBe(true);
}

async function addScrollRunway(page: Page): Promise<void> {
  await page.evaluate(() => {
    const runway = document.createElement("div");
    runway.setAttribute("data-e2e-scroll-runway", "");
    runway.style.height = `${window.innerHeight * 6}px`;
    runway.setAttribute("aria-hidden", "true");
    document.body.append(runway);
  });
}
