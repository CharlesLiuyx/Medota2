import { expect, test } from "../e2e/test-fixture";
test("items: navigation, search, filters, recipe links and version context", async ({
  page,
}) => {
  await page.goto("/items?lang=zh-CN");
  await expect(
    page.getByRole("heading", { name: "物品图鉴", exact: true }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "图鉴分类" });
  expect(await nav.getByRole("link").allTextContents()).toEqual([
    "英雄",
    "技能",
    "单位",
    "物品",
    "属性",
    "地图",
    "变化",
  ]);
  await expect(
    nav.getByRole("link", { name: "物品", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const results = page.getByRole("list", { name: /物品结果|Item results/ });
  if (!(await results.count())) {
    await expect(
      page.getByText("该版本的物品资料尚未接入", { exact: false }),
    ).toBeVisible();
    return;
  }
  const search = page.getByRole("textbox", { name: /搜索物品|Search items/ });
  await expect(search).toBeEnabled();
  await search.fill("shanshuobishou");
  const blink = results.locator('a[href^="/items/item_blink?"]');
  await expect(blink).toBeVisible();
  const loadedIcon = async (image: import("@playwright/test").Locator) => {
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(image).toHaveAttribute(
      "src",
      /\/valve-assets\/item\/item_blink\?v=/,
    );
  };
  await loadedIcon(blink.locator("img"));
  const imageVersion = await blink.locator("img").getAttribute("src");
  const release = new URL(page.url()).searchParams.get("release");
  expect(release).toBeTruthy();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await blink.hover();
    await expect(page.getByRole("tooltip")).toContainText("2250");
    await loadedIcon(page.getByRole("tooltip").locator("img"));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
  }
  await blink.click();
  await expect(page.locator("h1")).toHaveText("闪烁匕首");
  await loadedIcon(page.locator("main header img"));
  await expect(page.getByRole("heading", { name: "可合成为" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("release")).toBe(release);
  await page.getByRole("link", { name: "← 物品图鉴" }).click();
  await search.fill("zzzz-no-item");
  await expect(
    page.getByText("没有符合条件的物品，请调整关键词或分类。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await page.getByRole("combobox", { name: "分类" }).click();
  await page.getByRole("option", { name: "合成图纸", exact: true }).click();
  await search.fill("magic wand");
  await page.reload();
  await expect(search).toHaveValue("magic wand");
  await expect(page.getByRole("combobox", { name: "分类" })).toContainText(
    "合成图纸",
  );
  await results.locator('a[href^="/items/item_recipe_magic_wand?"]').click();
  await expect(page.getByRole("heading", { name: "合成配方" })).toBeVisible();
  await page.locator('main a[href^="/items/item_magic_wand?"]').click();
  await expect(page.locator("h1")).toHaveText("魔杖");
  expect(new URL(page.url()).searchParams.get("release")).toBe(release);
  await page.getByRole("link", { name: "← 物品图鉴" }).click();
  await expect(
    page.getByRole("heading", { name: "物品图鉴", exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "语言" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Item Catalog", exact: true }),
  ).toBeVisible();
  await search.fill("blink dagger");
  await expect(results.locator('a[href^="/items/item_blink?"]')).toContainText(
    "Blink Dagger",
  );
  await page.getByRole("combobox", { name: /全局版本|Game version/ }).click();
  const historical = page.getByRole("option", { name: /7\.41e/ });
  if (await historical.count()) {
    await historical.click();
    await expect(
      page.getByRole("combobox", { name: /全局版本|Game version/ }),
    ).toContainText("7.41e");
    await expect(
      results.locator('a[href^="/items/item_blink?"]'),
    ).toContainText("Blink Dagger");
    expect(new URL(page.url()).searchParams.get("release")).not.toBe(release);
    await loadedIcon(blink.locator("img"));
    expect(await blink.locator("img").getAttribute("src")).not.toBe(
      imageVersion,
    );
    await results.locator('a[href^="/items/item_blink?"]').click();
    await expect(page.locator("h1")).toHaveText("Blink Dagger");
    expect(new URL(page.url()).searchParams.get("release")).not.toBe(release);
  } else await page.keyboard.press("Escape");
  await page.goto("/items/not-an-item");
  await expect(
    page.getByRole("heading", { name: "Item not found" }),
  ).toBeVisible();
});
