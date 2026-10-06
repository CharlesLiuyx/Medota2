import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test-fixture";

test("registry defaults to current and restores canonical filter URL", async ({
  page,
}) => {
  await page.goto("/abilities");
  await expect(page.getByRole("heading", { name: "技能图鉴" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "闪烁" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "闪烁 icon", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("fixture_unbound", { exact: true })).toHaveCount(
    0,
  );

  const blink = page.locator('a[href="/abilities/antimage_blink"]');
  await expect(
    page.locator('a[href="/abilities/special_bonus_unique_antimage_fixture"]'),
  ).toContainText("10 级天赋");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 840 });
    await blink.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible({ timeout: 500 });
    await expect(tooltip).toContainText("传送一小段距离。");
    await expect(tooltip).toContainText("12 / 10 / 8 / 6");
    const box = (await tooltip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
    expect((await blink.boundingBox())!.height).toBe(62);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
  }

  await page.getByRole("combobox", { name: "状态" }).click();
  await page.getByRole("option", { name: "其他技能", exact: true }).click();
  await page.getByRole("combobox", { name: "语言" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await page
    .getByPlaceholder("搜索技能名称、拼音或别称…")
    .fill(" fixture_unbound ");

  await expect(page).toHaveURL(
    "/abilities?q=fixture_unbound&status=defined_unbound&lang=en",
  );
  await expect(
    page.getByRole("heading", { name: "技能名称待补充" }),
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
  // Dense cards can fit inside the overscan window; move beyond it before
  // asserting that offscreen chunks have been unmounted.
  await page.evaluate(() => {
    const runway = document.createElement("div");
    runway.setAttribute("data-e2e-scroll-runway", "");
    runway.style.height = `${window.innerHeight * 8}px`;
    runway.setAttribute("aria-hidden", "true");
    document.body.append(runway);
    window.scrollTo(0, document.body.scrollHeight);
  });
  await expect
    .poll(() => list.locator("[data-infinite-list-spacer]").count())
    .toBeGreaterThan(0);
  await expect
    .poll(() => list.locator("[data-infinite-list-item]").count())
    .toBeLessThan(192);

  const firstItem = list.locator(`[data-infinite-list-key="${firstItemKey}"]`);
  await expect(firstItem).toHaveCount(0);
  await page
    .locator("[data-e2e-scroll-runway]")
    .evaluate((node) => node.remove());
  await list
    .locator('[data-infinite-list-sentinel="before"]')
    .scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(firstItem).toHaveCount(1);
  await firstItem.scrollIntoViewIfNeeded();
  await expect(firstItem).toBeVisible();
});

test("ability detail resolves readable values and hero links", async ({
  page,
}) => {
  await page.goto("/abilities/antimage_blink?lang=en");
  await expect(
    page.getByRole("heading", { name: "Blink", level: 1 }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText("750 / 900 / 1050 / 1200");
  await expect(page.locator("main")).toContainText("12 / 10 / 8 / 6");
  await expect(page.getByRole("link", { name: /Anti-Mage/u })).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(
    /blink_range|special_bonus_|DOTA_|Provenance|991daaf6/u,
  );
});

test("untranslated engine fields stay out of the player tooltip", async ({
  page,
}) => {
  await page.goto("/abilities/fixture_scroll_001?lang=en");
  await expect(
    page.getByRole("heading", { name: "Scroll Fixture Ability 001", level: 1 }),
  ).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(
    /fixture_value_|raw_definition|Modifiers/u,
  );
});

test("missing abilities are exact 404s and stored icons remain accessible", async ({
  page,
}) => {
  await page.goto("/abilities/not_a_real_ability");
  await expect(
    page.getByRole("heading", { name: "未找到这个技能" }),
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

test("online ability fallback is bilingual and ignores superseded responses", async ({
  page,
  request,
}) => {
  for (const q of ["闪烁", "Blink", "shanshuo", "ss", "闪现", "am blink"]) {
    const response = await request.get(
      `/api/catalog/abilities?lang=en&q=${encodeURIComponent(q)}`,
    );
    expect(response.ok()).toBe(true);
    expect(
      (await response.json()).items.map(
        (item: { internalName: string }) => item.internalName,
      ),
    ).toContain("antimage_blink");
  }
  await page.route("**/api/catalog/replica", (route) => route.abort());
  await page.goto("/abilities");
  const input = page.getByRole("textbox", { name: "搜索技能" });
  await expect(input).toBeVisible();
  await expect(page.getByRole("button", { name: "应用筛选" })).toHaveCount(0);
  let release: () => void = () => {};
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/catalog/abilities?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") !== "fixture")
      return route.continue();
    const response = await route.fetch();
    await delayed;
    await route.fulfill({ response }).catch(() => {});
  });
  const oldRequest = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get("q") === "fixture",
  );
  await input.fill("fixture");
  await oldRequest;
  await input.fill("shanshuo");
  await expect(page.locator("[data-live-results]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("heading", { name: "闪烁", exact: true }),
  ).toBeVisible();
  release();
  await page.waitForTimeout(150);
  await expect(
    page.getByRole("heading", { name: /Scroll Fixture Ability/u }),
  ).toHaveCount(0);
  await page.getByRole("combobox", { name: "语言" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Blink", exact: true }),
  ).toBeVisible();
  await input.fill("闪烁");
  await expect(page.locator("[data-live-results]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("heading", { name: "Blink", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(input).toHaveValue("闪烁");
  await expect(
    page.getByRole("heading", { name: "Blink", exact: true }),
  ).toBeVisible();
});
