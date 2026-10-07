import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test-fixture";

test("catalog APIs expose the verified test environment without private identity", async ({
  request,
}) => {
  for (const path of ["/api/catalog/heroes", "/api/catalog/abilities"]) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    const headers = response.headers();
    expect(headers["x-medota2-environment"]).toBe("test");
    expect(headers["x-medota2-data-class"]).toBe("synthetic-fixture");
    expect(headers["x-medota2-environment-verification"]).toBe("verified");
    expect(headers["x-medota2-database-name"]).toBe("medota2_test");
    expect(headers["x-medota2-database-fingerprint"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{8}$/u,
    );
    expect(headers["x-medota2-run-id"]).toBe(process.env.MEDOTA2_RUN_ID);
  }
});

const HERO_GROUP_ORDER = ["agility", "intelligence", "universal"] as const;
type HeroGroup = (typeof HERO_GROUP_ORDER)[number];

test("overview, canonical search URL and CM filter", async ({ page }) => {
  await page.goto("/heroes");
  await expect(page.getByRole("heading", { name: "英雄图鉴" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "敌法师" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Anti-Mage 图标", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("资料更新暂未完成，当前显示上一次可用的游戏资料。", {
      exact: true,
    }),
  ).toHaveCount(0);

  await page
    .getByPlaceholder("搜索英雄名称、拼音或别称…")
    .fill("  Ａnti-Mage  ");

  await expect(page).toHaveURL(/\/heroes\?q=anti-mage&release=c%3A/u);
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
  await expect(page).toHaveURL(/\/heroes\?release=c%3A/u);
  await expect
    .poll(() => list.locator("[data-infinite-list-chunk]").count())
    .toBeGreaterThanOrEqual(5);

  // A fetch boundary within one attribute must continue the previous row.
  const cells = await list
    .locator("[data-infinite-list-item]")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          group: node.getAttribute("data-hero-attribute"),
          left: rect.left,
          right: rect.right,
          top: rect.top,
        };
      }),
    );
  const rowEnd = Math.max(...cells.map((cell) => cell.right));
  for (let index = 1; index < cells.length; index++) {
    const previous = cells[index - 1]!;
    const current = cells[index]!;
    if (current.group === previous.group && current.top > previous.top + 2)
      expect(Math.abs(previous.right - rowEnd)).toBeLessThan(2);
  }

  const footer = page.getByRole("contentinfo");
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeVisible();

  const firstItem = list.locator(`[data-infinite-list-key="${firstItemKey}"]`);
  await addScrollRunway(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => list.locator("[data-infinite-list-spacer]").count())
    .toBeGreaterThan(0);
  await expect
    .poll(() => list.locator("[data-infinite-list-item]").count())
    .toBeLessThan(194);
  await expect(firstItem).toHaveCount(0);

  await page.locator("[data-e2e-scroll-runway]").evaluate((element) => {
    element.remove();
  });
  await list
    .locator('[data-infinite-list-sentinel="before"]')
    .scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(firstItem).toHaveCount(1);
  await firstItem.scrollIntoViewIfNeeded();
  await expect(firstItem).toBeVisible();
});

test("compact hero previews open immediately and filters stay keyboard accessible", async ({
  page,
}) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 840 });
    await page.goto("/heroes");
    const hero = page.locator('a[href^="/heroes/antimage?"]').last();
    await expect(hero).toBeVisible();
    await hero.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible({ timeout: 500 });
    await expect(tooltip).toContainText("移动速度 310");
    await expect(tooltip).toContainText("复杂程度");
    expect(await hero.getAttribute("title")).toBeNull();
    const bounds = await tooltip.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(8);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 8);
    await tooltip.hover();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
    await hero.focus();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator("summary").filter({ hasText: "主属性" }).click();
    await page.getByRole("checkbox", { name: "敏捷", exact: true }).check();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("checkbox", { name: "敏捷", exact: true }),
    ).not.toBeVisible();

    const mode = page.getByRole("combobox", { name: "队长模式" });
    await mode.focus();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("option", { name: "全部", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(mode).toBeFocused();
    await expect(page).toHaveURL(/cm=true/u);
    await mode.click();
    await page.keyboard.press("Escape");
    await expect(mode).toHaveAttribute("aria-expanded", "false");
    await expect(page).toHaveURL(/attribute=agility/u);
    await expect(page.getByRole("heading", { name: "测试守卫" })).toHaveCount(
      0,
    );
  }
});

test("detail renders readable skills, talents, facets and base stats", async ({
  page,
}) => {
  await page.goto("/heroes/antimage");
  await expect(
    page.getByRole("heading", { name: "敌法师", level: 1 }),
  ).toBeVisible();
  for (const name of ["英雄技能", "天赋树", "命石", "英雄属性", "英雄故事"])
    await expect(
      page.getByRole("heading", { name, level: 2, exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "闪烁", exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText("310");
  expect(await page.locator("main").innerText()).not.toMatch(
    /npc_dota_|special_bonus_|DOTA_ABILITY_|SHA-256|base_health|Catalog Provenance/u,
  );
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 600 });
    const nav = page.getByRole("navigation", { name: "英雄详情" });
    await nav.getByRole("link", { name: "属性", exact: true }).click();
    await expect(page).toHaveURL(/#stats$/u);
    await expect(
      nav.getByRole("link", { name: "属性", exact: true }),
    ).toHaveAttribute("aria-current", "location");
    await expect
      .poll(async () => (await nav.boundingBox())!.y)
      .toBeCloseTo(28, 0);
    const navBounds = (await nav.boundingBox())!;
    const statsBounds = (await page.locator("#stats").boundingBox())!;
    expect(statsBounds.y).toBeGreaterThanOrEqual(
      navBounds.y + navBounds.height,
    );
    await nav.getByRole("link", { name: "技能", exact: true }).click();
    await expect(
      nav.getByRole("link", { name: "技能", exact: true }),
    ).toHaveAttribute("aria-current", "location");
    await page.locator("#talents").evaluate((node) => node.scrollIntoView());
    await expect(
      nav.getByRole("link", { name: "天赋树", exact: true }),
    ).toHaveAttribute("aria-current", "location");
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect(
      nav.getByRole("link", { name: "英雄故事", exact: true }),
    ).toHaveAttribute("aria-current", "location");
    await nav.getByRole("link", { name: "技能", exact: true }).click();
    const skillsBounds = (await page.locator("#abilities").boundingBox())!;
    expect(skillsBounds.y).toBeGreaterThanOrEqual(76);
    expect(
      await page
        .locator("h1")
        .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    ).toBeLessThanOrEqual(width < 640 ? 18 : 20);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
});

test("locale switch preserves the selected hero and exposes keyboard focus", async ({
  page,
}) => {
  await page.goto("/heroes/antimage");
  await expect(page).toHaveURL(/\/heroes\/antimage\?release=c%3A/u);
  const release = new URL(page.url()).searchParams.get("release")!;
  expect(release).toMatch(/^c:/u);
  await page.getByRole("combobox", { name: "语言", exact: true }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/heroes/antimage\\?release=${encodeURIComponent(release)}&lang=en`,
    ),
  );
  await expect(
    page.getByRole("heading", { name: "Anti-Mage", level: 1 }),
  ).toBeVisible();

  await page.goto("/heroes");
  await expect(page).toHaveURL(/\/heroes\?release=c%3A/u);
  await expect(
    page.getByRole("heading", { name: "Hero Catalog", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  const identity = page.getByRole("link", { name: "Medota2 Hero Catalog" });
  await expect(identity).toBeFocused();
  await expect(identity).toHaveCSS("outline-style", "none");
  await expect
    .poll(async () =>
      identity.evaluate((node) =>
        Number(
          getComputedStyle(node).backgroundColor.match(/, ([\d.]+)\)$/)?.[1],
        ),
      ),
    )
    .toBeCloseTo(0.025, 2);
});

test("unknown query values are visible and unknown slugs return 404", async ({
  page,
}) => {
  await page.goto("/heroes?attribute=luck");
  await expect(page.getByText("未知主属性：luck")).toBeVisible();
  await page.getByRole("textbox", { name: "搜索英雄" }).fill("dfs");
  await expect(page.getByText("未知主属性：luck")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "敌法师", exact: true }),
  ).toBeVisible();
  await page.goto("/heroes/not-a-real-hero");
  await expect(
    page.getByRole("heading", { name: "未找到这个英雄" }),
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

async function addScrollRunway(page: Page): Promise<void> {
  await page.evaluate(() => {
    const runway = document.createElement("div");
    runway.setAttribute("data-e2e-scroll-runway", "");
    runway.style.height = `${window.innerHeight * 8}px`;
    runway.setAttribute("aria-hidden", "true");
    document.body.append(runway);
  });
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

test("online fallback handles aliases, IME, cache and URL restoration without a page request", async ({
  page,
}) => {
  await page.route("**/api/catalog/replica", (route) => route.abort());
  await page.goto("/heroes");
  const input = page.getByRole("textbox", { name: "搜索英雄" });
  await expect(input).toBeVisible();
  await expect(page.getByRole("button", { name: "应用筛选" })).toHaveCount(0);
  const searchRequests: string[] = [];
  const documentRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === "/api/catalog/heroes" &&
      url.searchParams.has("q") &&
      !url.searchParams.has("after")
    )
      searchRequests.push(url.searchParams.get("q")!);
    if (request.isNavigationRequest() || url.searchParams.has("_rsc"))
      documentRequests.push(request.url());
  });
  await input.pressSequentially("difashi", { delay: 8 });
  await expect(page.locator("[data-live-results]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("heading", { name: "敌法师", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "测试守卫", exact: true }),
  ).toHaveCount(0);
  expect(searchRequests).toEqual(["difashi"]);
  expect(documentRequests).toEqual([]);
  await input.fill("dfs");
  await expect(page.locator("[data-live-results]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page).toHaveURL(/\/heroes\?q=dfs&release=c%3A/u);
  await input.fill("magina");
  await expect(page.locator("[data-live-results]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await input.fill("dfs");
  await expect(page.locator("[data-live-results]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(searchRequests.filter((q) => q === "dfs")).toHaveLength(1);

  const beforeComposition = searchRequests.length;
  await input.dispatchEvent("compositionstart");
  await input.fill("di");
  await page.waitForTimeout(140);
  expect(searchRequests).toHaveLength(beforeComposition);
  await input.fill("敌法");
  await input.dispatchEvent("compositionend", { data: "敌法" });
  await expect(page.locator("[data-live-results]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page).toHaveURL(/q=%E6%95%8C%E6%B3%95&release=c%3A/u);
  await expect(input).toBeFocused();
  await page.locator('a[href^="/heroes/antimage?"]').last().click();
  await expect(page).toHaveURL(/\/heroes\/antimage\?release=c%3A/u);
  await page.goBack();
  await expect(input).toHaveValue("敌法");
  await expect(
    page.getByRole("heading", { name: "测试守卫", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /清除/u }).click();
  await expect(input).toHaveValue("");
  await expect(page).toHaveURL(/\/heroes\?release=c%3A/u);
  await expect(
    page.getByRole("heading", { name: "测试守卫", exact: true }),
  ).toBeVisible();
});

test("clearing a search fills a tall viewport without needing another scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1680, height: 1480 });
  await page.goto("/heroes");
  const cards = page.locator("[data-infinite-list-item]");
  const input = page.getByRole("textbox", { name: "搜索英雄" });
  await expect(cards).toHaveCount(194);
  await input.fill("dfs");
  await expect(cards).toHaveCount(1);
  await input.fill("");
  await expect(cards).toHaveCount(194);
  await input.fill("antimage");
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "清除 1", exact: true }).click();
  await expect(cards).toHaveCount(194);
});
