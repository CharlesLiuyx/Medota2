import { expect, test } from "../e2e/test-fixture";
test("units: search, clear, filter, open detail and follow ability", async ({
  page,
}) => {
  await page.goto("/units");
  await expect(
    page
      .getByRole("navigation", { name: "Catalog entities" })
      .getByRole("link", { name: "单位", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "单位图鉴", exact: true }),
  ).toBeVisible();
  const results = page.getByRole("list", { name: "单位结果" });
  if (!(await results.count())) {
    // Synthetic catalog fixtures deliberately have no unit source snapshot.
    await expect(
      page.getByText("该版本的单位资料尚未接入", { exact: false }),
    ).toBeVisible();
    return;
  }
  const items = results.getByRole("listitem");
  const total = await items.count();
  expect(total).toBeGreaterThan(0);
  const search = page.getByRole("textbox", { name: "搜索单位" });
  await search.fill("roushan");
  const roshan = results.locator('a[href="/units/npc_dota_roshan"]');
  await expect(roshan).toBeVisible();
  const portrait = roshan.locator("img");
  {
    await expect(portrait).toHaveAttribute(
      "src",
      /valve-assets\/unit\/npc_dota_roshan/,
    );
    await expect
      .poll(() =>
        portrait.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
  }

  await search.fill("");
  await expect(items).toHaveCount(total);
  await search.fill("zzzzzz-no-unit");
  await expect(items).toHaveCount(0);
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(items).toHaveCount(total);
  await page.getByRole("combobox", { name: "分类" }).click();
  await page.getByRole("option", { name: "首领", exact: true }).click();
  await expect(roshan).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "分类" })).toContainText(
    "首领",
  );
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await roshan.hover();
    await expect(page.getByRole("tooltip")).toContainText("生命值");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
  }
  await roshan.click();
  await expect(page.locator("h1")).toHaveText("肉山");
  await expect(page.getByRole("heading", { name: "单位技能" })).toBeVisible();
  await expect(page.locator("dl")).toContainText("生命值");

  await expect
    .poll(() =>
      page
        .locator("main header img")
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    )
    .toBe(true);
  const ability = page.locator('main a[href^="/abilities/"]').first();
  await expect(ability).toBeVisible();
  await ability.click();
  await expect(page.locator("h1")).toBeVisible();
  await page.goto("/units/unknown_unit");
  await expect(
    page.getByRole("heading", { name: "未找到该单位" }),
  ).toBeVisible();
});
