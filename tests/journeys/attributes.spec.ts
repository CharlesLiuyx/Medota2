import { expect, test } from "../e2e/test-fixture";
test("attributes: bidirectional armor links, calculation, search, language and historical context", async ({
  page,
}) => {
  await page.goto("/items/item_platemail?lang=zh-CN");
  await expect(page.locator("h1")).toBeVisible();
  const release = new URL(page.url()).searchParams.get("release");
  expect(release).toBeTruthy();
  await page.locator('main a[href^="/attributes/armor?"]').first().click();
  await expect(page.locator("h1")).toHaveText("护甲");
  expect(new URL(page.url()).searchParams.get("release")).toBe(release);
  await expect(
    page.getByText("社区机制资料，待引擎复核", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("output")).toContainText("70.42");
  await page.getByRole("spinbutton", { name: "示例总护甲" }).fill("-10");
  await expect(page.locator("output")).toContainText("137.50");
  await page.getByRole("textbox", { name: "搜索关联对象" }).fill("platemail");
  const plate = page.locator('main a[href^="/items/item_platemail?"]');
  await expect(plate).toBeVisible();
  await plate.click();
  await expect(page.locator("h1")).toHaveText(/板甲|片甲/);
  await page
    .getByRole("navigation", { name: "图鉴分类" })
    .getByRole("link", { name: "属性", exact: true })
    .click();
  await expect(page.locator("h1")).toHaveText("属性图鉴");
  await expect(
    page.getByRole("region", { name: "基础属性" }).getByRole("link"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "夜间视野", exact: true }),
  ).toBeVisible();
  const catalogCards = page
    .getByRole("list", { name: "属性结果" })
    .getByRole("listitem");
  await expect(catalogCards).toHaveCount(63);
  for (const [width, columns] of [
    [1280, 4],
    [900, 3],
    [390, 2],
  ]) {
    await page.setViewportSize({ width, height: 844 });
    const cards = await catalogCards.evaluateAll((nodes) =>
      nodes
        .filter((node) => !node.closest('section[aria-label="基础属性"]'))
        .map((node) => {
          const box = node.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, left: box.left };
        }),
    );
    for (let index = 1; index < cards.length; index++) {
      if (index % columns) {
        expect(Math.abs(cards[index].top - cards[index - 1].top)).toBeLessThan(
          1,
        );
        expect(cards[index].left).toBeGreaterThan(cards[index - 1].left);
      } else {
        expect(cards[index].top - cards[index - 1].bottom).toBeCloseTo(4, 0);
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 844 });
  await page
    .getByRole("textbox", { name: "搜索属性", exact: true })
    .fill("hujia");
  await expect(
    page
      .getByRole("list", { name: "属性结果" })
      .getByRole("heading", { name: "护甲", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "搜索属性", exact: true }),
  ).toHaveValue("hujia");
  await page.getByRole("combobox", { name: "全局版本", exact: true }).click();
  await page.getByRole("option", { name: /7\.41e/ }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("release"))
    .not.toBe(release);
  const historical = new URL(page.url()).searchParams.get("release");
  expect(historical).not.toBe(release);
  await page.getByRole("list", { name: "属性结果" }).getByRole("link").click();
  await expect(page.locator("h1")).toHaveText("护甲");
  expect(new URL(page.url()).searchParams.get("release")).toBe(historical);
  await expect(page.getByText(/^客户端版本 6918 ·/)).toBeVisible();
  await page.getByRole("combobox", { name: "语言", exact: true }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("Armor");
  await expect(
    page.getByRole("heading", { name: "Meaning and scope" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.goto("/attributes/dispel-type?lang=zh-CN");
  await expect(page.locator("h1")).toHaveText("驱散类型");
  await expect(
    page.getByRole("heading", { name: "枚举值", exact: true }),
  ).toBeVisible();
  for (const value of [
    "SPELL_DISPELLABLE_YES",
    "SPELL_DISPELLABLE_YES_STRONG",
    "SPELL_DISPELLABLE_NO",
  ])
    await expect(page.getByText(value, { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "枚举值筛选", exact: true }).click();
  await page.getByRole("option", { name: "仅强驱散", exact: true }).click();
  const enumResults = page.getByRole("list", { name: "属性关联结果" });
  await expect(
    enumResults.getByText("仅强驱散", { exact: true }).first(),
  ).toBeVisible();
  await enumResults.getByRole("link").first().click();
  await page.locator("summary").filter({ hasText: "完整属性引用" }).click();
  await page
    .getByRole("link", { name: "驱散类型", exact: true })
    .first()
    .click();
  await expect(page.locator("h1")).toHaveText("驱散类型");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.goto(`/attributes/strength?lang=zh-CN&release=${historical}`);
  const evidence = page.locator("section").filter({
    has: page.getByRole("heading", { name: "VPK 证据与版本", exact: true }),
  });
  const health = evidence.getByRole("link", { name: "生命值", exact: true });
  await expect(health).toBeVisible();
  await expect(health).toHaveAttribute("data-attribute-reference", "health");
  await expect(
    evidence.getByRole("link", { name: "生命恢复", exact: true }).first(),
  ).toHaveAttribute("href", /attributes\/health-regen\?/);
  await health.click();
  await expect(page.locator("h1")).toHaveText("生命值");
  expect(new URL(page.url()).searchParams.get("release")).toBe(historical);
  expect(new URL(page.url()).searchParams.get("lang")).toBe("zh-CN");
  await page.goto("/attributes/not-a-real-attribute?lang=en");
  await expect(
    page.getByRole("heading", {
      name: "This version or page is not available",
      exact: true,
    }),
  ).toBeVisible();
});
