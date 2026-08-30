import { expect, test, type Locator, type Page } from "@playwright/test";

const HERO_GROUP_ORDER = ["agility", "intelligence", "universal"] as const;
type HeroGroup = (typeof HERO_GROUP_ORDER)[number];

test("overview, canonical search URL and CM filter", async ({ page }) => {
  await page.goto("/heroes");
  await expect(
    page.getByRole("heading", { name: "游戏内定义，原样可追溯。" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "敌法师" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Anti-Mage icon", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("最近一次 VPK 导入失败", { exact: false }),
  ).toHaveCount(0);

  await page
    .getByPlaceholder("搜索中文名、英文名或内部名称…")
    .fill("  Ａnti-Mage  ");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page).toHaveURL(/\/heroes\?q=anti-mage$/u);
  await expect(page.getByRole("heading", { name: "敌法师" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "测试守卫" })).toHaveCount(0);

  await page.goto("/heroes?cm=false");
  await expect(page.getByRole("heading", { name: "测试守卫" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "敌法师" })).toHaveCount(0);
});

test("hero catalog continuously loads five chunks without repeating group headings", async ({
  page,
}) => {
  test.slow();
  await page.goto("/heroes");
  const list = page.locator("[data-infinite-list]").filter({
    has: page.getByRole("group", { name: "英雄结果" }),
  });
  await expect(list).toBeVisible();
  await expect(list.locator("[data-infinite-list-item]").first()).toBeVisible();

  const firstItemKey = await list
    .locator("[data-infinite-list-item]")
    .first()
    .getAttribute("data-infinite-list-key");
  if (!firstItemKey) throw new Error("Initial hero item has no stable key.");

  await expect(
    page.getByRole("navigation", { name: "Hero pages" }),
  ).toHaveCount(0);
  await expect(page.getByText(/上一页|下一页/iu)).toHaveCount(0);
  await expect(page.getByText(/page\s+\d+\s*\/\s*\d+/iu)).toHaveCount(0);
  await expect(page.locator('a[href*="page="]')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);

  const seenGroups: HeroGroup[] = [];
  const groupHeadingText = new Map<HeroGroup, string>();
  const observeGroups = () =>
    observeHeroGroups(list, seenGroups, groupHeadingText);
  await observeGroups();

  const bottomSentinel = list.locator('[data-infinite-list-sentinel="after"]');
  const complete = list
    .locator(":scope > p:not([data-infinite-list-status])")
    .filter({ hasText: "已显示全部英雄" });
  await scrollBoundaryUntil(
    page,
    bottomSentinel,
    async () => complete.isVisible(),
    observeGroups,
  );

  await expect(complete).toBeVisible();
  await observeGroups();
  expect(seenGroups).toEqual(HERO_GROUP_ORDER);
  expect(groupHeadingText.get("agility")).toContain("1");
  expect(groupHeadingText.get("intelligence")).toContain("96");
  expect(groupHeadingText.get("universal")).toContain("97");
  await expect(list.locator('[data-infinite-list-key="900192"]')).toBeVisible();
  await expect(page).toHaveURL(/\/heroes$/u);
  await expect
    .poll(() => list.locator("[data-infinite-list-chunk]").count())
    .toBeGreaterThanOrEqual(5);
  await expect
    .poll(() => list.locator("[data-infinite-list-spacer]").count())
    .toBeGreaterThan(0);
  await expect
    .poll(() => list.locator("[data-infinite-list-item]").count())
    .toBeLessThan(194);

  const footer = page.getByRole("contentinfo");
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeVisible();

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

test("detail renders ability graph, raw values, provenance and paired reference drift", async ({
  page,
}) => {
  await page.goto("/heroes/antimage");
  await expect(
    page.getByRole("heading", { name: "敌法师", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Abilities", level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Talents & Upgrades", level: 2 }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /闪烁/u }).first()).toBeVisible();
  await expect(page.getByText("基础 / 原始定义")).toBeVisible();
  await expect(page.getByText("Catalog Provenance")).toBeVisible();
  await expect(
    page.getByText("共享 Catalog 快照", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("dotaconstants 参考，不参与规范值"),
  ).toBeVisible();
  await expect(page.getByText("base_health", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("code").filter({ hasText: /^120$/u }),
  ).toBeVisible();
  await expect(
    page.getByRole("code").filter({ hasText: /^999$/u }),
  ).toBeVisible();

  const detailLists = page.locator("[data-infinite-list]");
  await expect(detailLists).toHaveCount(13);
  for (let index = 0; index < 13; index += 1) {
    await expect(
      detailLists.nth(index).locator("[data-infinite-list-item]").first(),
    ).toBeAttached();
  }
  await expect(page.locator('a[role="listitem"]')).toHaveCount(0);
  await expect(page.locator('details[role="listitem"]')).toHaveCount(0);
});

test("locale switch preserves the selected hero and exposes keyboard focus", async ({
  page,
}) => {
  await page.goto("/heroes/antimage");
  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(page).toHaveURL("/heroes/antimage?lang=en");
  await expect(
    page.getByRole("heading", { name: "Anti-Mage", level: 1 }),
  ).toBeVisible();

  await page.goto("/heroes");
  await page.keyboard.press("Tab");
  const identity = page.getByRole("link", { name: "Medota2 Heroes" });
  await expect(identity).toBeFocused();
  await expect(identity).toHaveCSS("outline-style", "solid");
});

test("unknown query values are visible and unknown slugs return 404", async ({
  page,
}) => {
  await page.goto("/heroes?attribute=luck");
  await expect(page.getByText("未知主属性：luck")).toBeVisible();
  await page.goto("/heroes/not-a-real-hero");
  await expect(
    page.getByRole("heading", { name: "没有这个英雄 slug" }),
  ).toBeVisible();
});

async function scrollBoundaryUntil(
  page: Page,
  boundary: Locator,
  done: () => Promise<boolean>,
  observe: () => Promise<void>,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await observe();
    if (await done()) return;
    await boundary.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(150);
  }
  await observe();
  expect(await done()).toBe(true);
}

async function observeHeroGroups(
  list: Locator,
  seenGroups: HeroGroup[],
  headingText: Map<HeroGroup, string>,
): Promise<void> {
  const headings = await list
    .locator("[data-hero-group-heading]")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        group: node.getAttribute("data-hero-group-heading"),
        text: node.textContent ?? "",
      })),
    );
  const groups = headings.map(({ group }) => group);
  expect(new Set(groups).size).toBe(groups.length);

  const ranks = groups.map((group) =>
    HERO_GROUP_ORDER.indexOf(group as HeroGroup),
  );
  expect(ranks.every((rank) => rank >= 0)).toBe(true);
  expect(ranks).toEqual([...ranks].sort((left, right) => left - right));

  for (const heading of headings) {
    const group = heading.group as HeroGroup;
    if (!seenGroups.includes(group)) seenGroups.push(group);
    headingText.set(group, heading.text);
  }
}
