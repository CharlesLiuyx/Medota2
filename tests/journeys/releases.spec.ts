import { expect, test } from "../e2e/test-fixture";
test("heroes releases: global version survives filters, details, related links and independent tabs", async ({
  page,
  request,
  context,
}) => {
  const response = await request.get("/api/releases");
  expect(response.ok()).toBe(true);
  const index = await response.json();
  const catalog = index.releases.find(
    (r: { catalogId: string | null }) => r.catalogId,
  );
  test.skip(!catalog, "No published catalog in this environment.");
  await page.goto(`/heroes?release=${encodeURIComponent(catalog.id)}`);
  await expect(
    page.getByRole("combobox", { name: "全局版本", exact: true }),
  ).toContainText(catalog.patch ?? "补丁未知");
  const headRequests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/catalog/head")
      headRequests.push(r.url());
  });
  const input = page.getByPlaceholder("搜索英雄名称、拼音或别称…");
  await input.fill("antimage");
  await expect(
    page.locator('a[href^="/heroes/antimage?"]').last(),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("release")).toBe(catalog.id);
  await page.getByRole("button", { name: /清除/ }).click();
  expect(new URL(page.url()).searchParams.get("release")).toBe(catalog.id);
  const link = page.locator('a[href^="/heroes/antimage?"]').last();
  expect(
    new URL((await link.getAttribute("href"))!, page.url()).searchParams.get(
      "release",
    ),
  ).toBe(catalog.id);
  await link.click();
  await expect(page.locator("h1")).toBeVisible();
  const ability = page.locator('a[href^="/abilities/"]').first();
  expect(
    new URL((await ability.getAttribute("href"))!, page.url()).searchParams.get(
      "release",
    ),
  ).toBe(catalog.id);
  await ability.click();
  await expect(page.locator("h1")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("release")).toBe(catalog.id);
  await page.reload();
  await expect(page.locator("h1")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(headRequests).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    index.releases.every(
      (release: { catalogId: string | null }) => release.catalogId,
    ),
  ).toBe(true);
  const otherRelease = index.releases.find(
    (release: { id: string; catalogId: string | null }) =>
      release.catalogId && release.id !== catalog.id,
  );
  if (otherRelease) {
    const compared = await request.get(
      `/api/releases/diff?from=${encodeURIComponent(otherRelease.id)}&to=${encodeURIComponent(catalog.id)}`,
    );
    expect(compared.ok()).toBe(true);
    const diff = await compared.json();
    expect(
      diff.changes.filter(
        (change: { category: string; entityKey: string; path: string }) =>
          change.category === "relation" &&
          change.entityKey.startsWith("hero-ability:") &&
          change.path === "/ordinal",
      ),
    ).toEqual([]);
    const other = await context.newPage();
    await other.goto(`/heroes?release=${encodeURIComponent(otherRelease.id)}`);
    await expect(
      other.getByRole("heading", { name: "英雄图鉴", exact: true }),
    ).toBeVisible();
    await expect(
      other.getByRole("combobox", { name: "全局版本", exact: true }),
    ).toContainText(otherRelease.patch);
    expect(new URL(page.url()).searchParams.get("release")).toBe(catalog.id);
    await other
      .getByRole("combobox", { name: "全局版本", exact: true })
      .click();
    await other
      .getByRole("option", { name: catalog.label, exact: true })
      .click();
    await expect(
      other.getByRole("heading", { name: "英雄图鉴", exact: true }),
    ).toBeVisible();
    await other.close();
  }
  const legacy = Object.entries(index.aliases ?? {}).find(
    ([, target]) => target === catalog.id,
  );
  if (legacy) {
    await page.goto(`/heroes?release=${encodeURIComponent(legacy[0])}`);
    await expect(page).toHaveURL(
      new RegExp(`release=${encodeURIComponent(catalog.id)}`),
    );
    await expect(
      page.getByRole("heading", { name: "英雄图鉴", exact: true }),
    ).toBeVisible();
  }
  const bad = await request.get(
    "/api/catalog/heroes?release=m%3Ano-such-version",
  );
  expect(bad.status()).toBe(410);
  const diff = await request.get(
    `/api/releases/diff?from=${encodeURIComponent(catalog.id)}&to=${encodeURIComponent(catalog.id)}`,
  );
  expect(diff.ok()).toBe(true);
  const result = await diff.json();
  expect(result.changes).toEqual([]);
  expect(result.fromVersion).toBe(catalog.id);
  expect(result.toVersion).toBe(catalog.id);
});
test("heroes changes: live dropdowns and search restore comparison filters", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/releases");
  expect(response.ok()).toBe(true);
  const index = await response.json();
  const catalog = index.releases.find(
    (release: { catalogId: string | null }) => release.catalogId,
  );
  test.skip(!catalog, "No published catalog in this environment.");
  const latest = index.releases.find(
    (release: { id: string }) => release.id === index.defaultRelease,
  );
  const previous = index.releases[index.releases.indexOf(latest) + 1] ?? latest;
  await page.goto("/changes?lang=zh-CN");
  await expect(
    page.getByRole("combobox", { name: "终点版本", exact: true }),
  ).toContainText(latest.label);
  await expect(
    page.getByRole("combobox", { name: "起始版本", exact: true }),
  ).toContainText(previous.label);
  expect(new URL(page.url()).searchParams.get("release")).toBe(latest.id);
  const query = new URLSearchParams({ release: catalog.id, from: catalog.id });
  await page.goto(`/changes?${query}`);
  await expect(
    page.getByRole("heading", { name: "版本变化", exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "起始版本", exact: true }).click();
  await page.getByRole("option", { name: catalog.label, exact: true }).click();
  const filterRequests: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/changes" &&
      request.headers()["rsc"] === "1"
    )
      filterRequests.push(request.url());
  });
  await page.getByRole("combobox", { name: "对象", exact: true }).click();
  await page.getByRole("option", { name: "其他", exact: true }).click();
  await page.getByRole("combobox", { name: "变化", exact: true }).click();
  await page.getByRole("option", { name: "增强", exact: true }).click();

  await expect(page).toHaveURL(/category=buff/);
  await expect(
    page.getByRole("combobox", { name: "对象", exact: true }),
  ).toContainText("其他");
  await expect(
    page.getByRole("combobox", { name: "变化", exact: true }),
  ).toContainText("增强");
  await expect(
    page.getByRole("button", { name: "比较", exact: true }),
  ).toHaveCount(0);
  const search = page.getByRole("searchbox", { name: "搜索变化" });
  await search.fill("MiXeD ");
  await expect(page).toHaveURL(/q=MiXeD/);
  await expect(search).toHaveValue("MiXeD ");
  await expect(search).toBeFocused();
  await search.fill("");
  await expect
    .poll(() => new URL(page.url()).searchParams.has("q"))
    .toBe(false);
  await search.dispatchEvent("compositionstart");
  await search.fill("护甲");
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
  await search.dispatchEvent("compositionend");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("护甲");
  await search.fill("");
  await expect
    .poll(() => new URL(page.url()).searchParams.has("q"))
    .toBe(false);
  await page.getByRole("button", { name: "版本变化", exact: true }).focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "数值按技能等级顺序排列",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  expect(filterRequests).toEqual([]);
  const params = new URL(page.url()).searchParams;
  expect(params.get("release")).toBe(catalog.id);
  expect(params.get("from")).toBe(catalog.id);
  expect(params.get("category")).toBe("buff");
  await page.reload();
  const entity = page.getByRole("combobox", { name: "对象", exact: true });
  await expect(entity).toContainText("其他");
  await entity.click();
  await expect(
    page.getByRole("option", { name: "其他", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(entity).toBeFocused();
  const other = index.releases.find(
    (release: { id: string }) => release.id !== catalog.id,
  );
  if (other) {
    const ending = page.getByRole("combobox", {
      name: "终点版本",
      exact: true,
    });
    await ending.click();
    await page.getByRole("option", { name: other.label, exact: true }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("release"))
      .toBe(other.id);
    expect(new URL(page.url()).searchParams.get("from")).toBe(catalog.id);
    expect(new URL(page.url()).searchParams.get("category")).toBe("buff");
    expect(new URL(page.url()).searchParams.get("entity")).toBe("other");
    await expect(ending).toContainText(other.label);
    await page.reload();
    await expect(ending).toContainText(other.label);
    await expect(
      page.getByRole("combobox", { name: "起始版本", exact: true }),
    ).toContainText(catalog.label);
    await page.getByRole("combobox", { name: "起始版本", exact: true }).click();
    await page.getByRole("option", { name: other.label, exact: true }).click();
    await expect(page.locator("main").getByRole("status")).toContainText(
      "起始与目标为同一版本",
    );
    await ending.click();
    await page
      .getByRole("option", { name: catalog.label, exact: true })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("release"))
      .toBe(catalog.id);
    await expect(page.locator("main").getByRole("status")).not.toContainText(
      "起始与目标为同一版本",
    );
  }
});

test("heroes changes: named official notes and readable values survive search, reverse comparison and mobile layout", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/releases");
  expect(response.ok()).toBe(true);
  const index = await response.json();
  const from = index.releases.find(
    (r: { sourceCommit: string }) =>
      r.sourceCommit === "991daaf6fc24b08445209d9ce8767e145bab107e",
  );
  const to = index.releases.find(
    (r: { sourceCommit: string }) =>
      r.sourceCommit === "f4c45719314754567cb4ef4fe343bbc790a311f4",
  );
  test.skip(
    !from || !to,
    "Reviewed 7.41e/7.41f source pair is not present in this environment.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `/changes?${new URLSearchParams({ release: to.id, from: from.id, q: "祸乱之源" })}`,
  );
  const bane = page.locator('[data-change-group="npc_dota_hero_bane"]');
  await expect(
    bane.getByRole("link", { name: /祸乱之源/ }).first(),
  ).toBeVisible();
  await expect(bane.locator("[data-change-before]")).toHaveText("1");
  await expect(bane.locator("[data-change-after]")).toHaveText("0");
  await expect(bane.getByRole("button", { name: "削弱 -100%" })).toBeVisible();
  await bane.getByRole("button", { name: /变化依据/ }).click();
  await expect(page.getByRole("tooltip")).toContainText("基础护甲：降低1点");
  await expect(
    page.getByRole("tooltip").getByRole("link", { name: /官方更新说明/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("searchbox", { name: "搜索变化" }).fill("恐鳌之心");
  const heart = page.locator('[data-change-group="item_heart"]');
  await expect(
    heart.getByRole("link", { name: /恐鳌之心/ }).first(),
  ).toBeVisible();
  const recipe = page
    .locator('[data-table-group="item_heart"]')
    .filter({ has: page.locator('a[href^="/items/item_recipe_heart?"]') });
  await expect(recipe.locator("[data-change-before]")).toHaveText("700");
  await expect(recipe.locator("[data-change-after]")).toHaveText("800");
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "搜索变化" })).toHaveValue(
    "恐鳌之心",
  );
  await page.goto(
    `/changes?${new URLSearchParams({ release: from.id, from: to.id, q: "祸乱之源" })}`,
  );
  await expect(bane.locator("[data-change-before]")).toHaveText("0");
  await expect(bane.locator("[data-change-after]")).toHaveText("1");
  await expect(bane.getByRole("button", { name: "增强 —" })).toBeVisible();
  await page
    .getByRole("button", { name: "比较范围与来源", exact: true })
    .click();
  await expect(
    page.getByRole("tooltip").getByRole("link", { name: /官方更新说明/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("searchbox", { name: "搜索变化" }).fill("恐鳌之心");
  await expect(recipe.locator("[data-change-before]")).toHaveText("800");
  await expect(recipe.locator("[data-change-after]")).toHaveText("700");
});

test("heroes changes: compact entity tables keep ranking, tooltips and continuous scrolling", async ({
  page,
  request,
}) => {
  const index = await (await request.get("/api/releases")).json();
  const from = index.releases.find(
    (r: { patch: string }) => r.patch === "7.41e",
  );
  const to = index.releases.find((r: { patch: string }) => r.patch === "7.41f");
  test.skip(!from || !to, "Reviewed source pair is not present.");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `/changes?${new URLSearchParams({ release: to.id, from: from.id })}`,
  );
  for (const name of ["机制", "英雄", "物品", "其他"])
    await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  const heroes = page.getByRole("table", { name: "英雄", exact: true });
  await expect(heroes.locator("[data-change-row]").first()).toBeVisible();
  await expect
    .poll(() => heroes.locator("[data-change-row]").count())
    .toBeGreaterThan(25);
  await expect(page.getByRole("navigation", { name: "变化分页" })).toHaveCount(
    0,
  );
  const contentColumnWidths = () =>
    heroes
      .locator("col")
      .evaluateAll((cols) =>
        cols
          .slice(1, 4)
          .map((col) => Math.round(col.getBoundingClientRect().width)),
      );
  await expect
    .poll(async () => (await contentColumnWidths())[0])
    .toBeLessThan(146);
  const initialWidths = await contentColumnWidths();
  expect(initialWidths[1]).toBeLessThanOrEqual(216);
  expect(initialWidths[2]).toBeGreaterThan(200);
  const treantSubjects = heroes.locator(
    '[data-table-group="npc_dota_hero_treant"] [data-table-column="subject"]',
  );
  await expect(
    treantSubjects.filter({
      has: page.locator('a[href^="/abilities/treant_leech_seed?"]'),
    }),
  ).toHaveAttribute("rowspan", "2");
  await expect(
    treantSubjects.filter({
      has: page.locator('a[href^="/abilities/treant_living_armor?"]'),
    }),
  ).toHaveAttribute("rowspan", "3");
  const first = heroes.locator("[data-change-row]").first();
  expect((await first.boundingBox())!.height).toBeLessThanOrEqual(32);
  const icons = await first.evaluate((row) =>
    [...row.querySelectorAll("img")].map((img) => ({
      height: img.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(img).lineHeight),
      fontSize: parseFloat(getComputedStyle(img).fontSize),
    })),
  );
  expect(icons[0].height).toBeCloseTo(icons[0].fontSize * 1.25, 0);
  for (const icon of icons)
    expect(icon.height).toBeLessThanOrEqual(icon.lineHeight);
  expect(icons[1].height).toBeCloseTo(icons[1].fontSize, 0);
  const impactLayout = await first
    .locator('[data-table-column="impact"] button')
    .evaluate((button) => {
      const [direction, percent, delta] = [...button.children].map((el) =>
        el.getBoundingClientRect(),
      );
      return {
        direction: direction.top,
        percent: percent.top,
        delta: delta.top,
        height: button.getBoundingClientRect().height,
      };
    });
  expect(Math.abs(impactLayout.direction - impactLayout.percent)).toBeLessThan(
    2,
  );
  expect(impactLayout.height).toBeLessThanOrEqual(18);
  expect(Math.abs(impactLayout.direction - impactLayout.delta)).toBeLessThan(2);
  await expect(first.locator("[data-change-delta]")).toHaveText("Δ +35");
  await first.locator('[data-table-column="impact"] button').focus();
  await expect(page.getByRole("tooltip")).toContainText("差值为终点减起点");
  await page.keyboard.press("Escape");
  const hero = first.locator('th[scope="row"] a');
  await hero.focus();
  await expect(page.getByRole("tooltip").locator("img")).toBeVisible();
  await expect(page.getByRole("tooltip")).toContainText("基础力量");
  const parentCard = page.locator('[role="tooltip"][data-tooltip-depth="0"]');
  const facts = await parentCard.locator("dl > div").evaluateAll((items) =>
    items.map((item) => {
      const label = item.querySelector("dt")!.getBoundingClientRect(),
        value = item.querySelector("dd")!.getBoundingClientRect();
      return { top: label.top, left: label.left, valueLeft: value.left };
    }),
  );
  // Two content-sized columns align labels and values, without a fixed 720px card.
  expect(facts).toHaveLength(4);
  expect(facts[0].top).toBe(facts[1].top);
  expect(facts[2].top).toBe(facts[3].top);
  expect(facts[2].top).toBeGreaterThan(facts[0].top);
  expect(facts[0].left).toBe(facts[2].left);
  expect(facts[0].valueLeft).toBe(facts[2].valueLeft);
  expect(facts[1].valueLeft).toBe(facts[3].valueLeft);
  expect((await parentCard.boundingBox())!.width).toBeLessThan(520);
  const strength = parentCard.getByRole("link", {
    name: "基础力量",
    exact: true,
  });
  const strengthUrl = new URL(
    (await strength.getAttribute("href"))!,
    page.url(),
  );
  expect(strengthUrl.pathname).toBe("/attributes/strength");
  expect(strengthUrl.searchParams.get("release")).toBe(to.id);
  await strength.focus();
  const attributeCard = page.locator(
    '[role="tooltip"][data-tooltip-depth="1"]',
  );
  await expect(attributeCard).toContainText("生命上限");
  await expect(parentCard).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(attributeCard).toHaveCount(0);
  await expect(parentCard).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const merged = heroes.locator("[data-table-merged-content]").first();
  await merged.evaluate((content) => {
    const cell = content.closest("th,td")!;
    window.scrollTo(0, window.scrollY + cell.getBoundingClientRect().top + 30);
  });
  const header = heroes.locator("[data-table-header-content]").first();
  await expect
    .poll(async () => Math.round((await header.boundingBox())!.y))
    .toBe(28);
  const stickyTop = 28 + (await header.boundingBox())!.height + 4;
  await expect
    .poll(async () => (await merged.boundingBox())!.y)
    .toBeCloseTo(stickyTop, 0);
  // Read at every animation frame during bidirectional scrolling, before any
  // delayed JS correction. A settled-position check misses visible shaking.
  const motion = await merged.evaluate(async (content) => {
    const tops: number[] = [];
    for (let frame = 0; frame < 40; frame++) {
      await new Promise(requestAnimationFrame);
      tops.push(content.getBoundingClientRect().top);
      window.scrollBy(0, frame < 20 ? 4 : -4);
    }
    return { min: Math.min(...tops), max: Math.max(...tops) };
  });
  expect(motion.min).toBeCloseTo(stickyTop, 0);
  expect(motion.max).toBeCloseTo(stickyTop, 0);
  // At the group boundary the old item moves out, without covering the next item.
  await merged.evaluate((content) => {
    window.scrollBy(
      0,
      content.closest("th,td")!.getBoundingClientRect().bottom - 50,
    );
  });
  await expect
    .poll(() =>
      merged.evaluate(
        (content) =>
          content.getBoundingClientRect().bottom <=
          content.closest("th,td")!.getBoundingClientRect().bottom,
      ),
    )
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(() =>
      merged.evaluate((content) =>
        Math.round(
          content.getBoundingClientRect().top -
            content.parentElement!.getBoundingClientRect().top,
        ),
      ),
    )
    .toBe(0);
  // The same primitive works in an embedded scrolling table, under its sticky header.
  await heroes.evaluate((table) => {
    const root = table.parentElement!;
    root.style.maxHeight = "220px";
    root.scrollTop = 100;
  });
  await expect
    .poll(() =>
      merged.evaluate((content) => {
        const header = content
          .closest("table")!
          .querySelector("[data-table-header-content]")!;
        return Math.round(
          content.getBoundingClientRect().top -
            header.getBoundingClientRect().bottom,
        );
      }),
    )
    .toBe(4);
  await page.setViewportSize({ width: 390, height: 844 });
  await heroes.evaluate((table) => {
    table.parentElement!.scrollLeft = 70;
  });
  const aligned = await merged.evaluate((content) => {
    const cell = content.closest("th,td")!;
    return (
      content.getBoundingClientRect().left - cell.getBoundingClientRect().left
    );
  });
  expect(aligned).toBeCloseTo(8, 0);
  await heroes
    .getByRole("button", { name: "冻结至第2列", exact: true })
    .press("Enter");
  await expect(heroes).toHaveAttribute("data-frozen-count", "2");
  await expect
    .poll(() =>
      merged.evaluate((content) =>
        Math.round(
          content.getBoundingClientRect().left -
            content.closest("th,td")!.getBoundingClientRect().left,
        ),
      ),
    )
    .toBe(8);
  await expect
    .poll(() =>
      heroes.evaluate((table) => {
        const headers = [
          ...table.querySelectorAll<HTMLElement>("thead th[data-table-frozen]"),
        ];
        return (
          headers.length === 2 &&
          Math.abs(
            headers[0].getBoundingClientRect().left -
              table.parentElement!.getBoundingClientRect().left,
          ) < 2
        );
      }),
    )
    .toBe(true);

  await heroes.evaluate((table) => {
    table.parentElement!.style.maxHeight = "";
    table.parentElement!.scrollLeft = 0;
    table.parentElement!.scrollTop = 0;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(
    page.locator('[data-change-group="official:fixes"]'),
  ).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: "物品", exact: true })
      .locator("[data-change-row]")
      .last(),
  ).toBeAttached();
  expect(await contentColumnWidths()).toEqual(initialWidths);
  const subjectRuns = await heroes
    .locator("[data-change-row]")
    .evaluateAll((rows) => {
      const groups = new Map<string, string[]>();
      for (const row of rows) {
        const el = row as HTMLElement,
          subjects = groups.get(el.dataset.tableGroup!) ?? [];
        if (subjects.at(-1) !== el.dataset.changeSubject)
          subjects.push(el.dataset.changeSubject!);
        groups.set(el.dataset.tableGroup!, subjects);
      }
      return [...groups.values()];
    });
  for (const subjects of subjectRuns)
    expect(new Set(subjects).size).toBe(subjects.length);
  const ranks = await heroes
    .locator("[data-change-row]")
    .evaluateAll((rows) => {
      const groups = new Map<string, number[]>();
      for (const row of rows) {
        const group = `${(row as HTMLElement).dataset.tableGroup}:${(row as HTMLElement).dataset.changeSubject}:${(row as HTMLElement).dataset.direction}`;
        const scores = groups.get(group) ?? [];
        scores.push(Number((row as HTMLElement).dataset.impactScore));
        groups.set(group, scores);
      }
      return [...groups.values()];
    });
  for (const scores of ranks)
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  const segments = await heroes
    .locator("[data-change-row]")
    .evaluateAll((rows) => {
      const previous = new Map<string, string>();
      return rows.map((row) => {
        const el = row as HTMLElement,
          group = `${el.dataset.tableGroup}:${el.dataset.changeSubject}`,
          direction = el.dataset.direction!;
        const prior = previous.get(group);
        previous.set(group, direction);
        return {
          direction,
          prior,
          starts: el.hasAttribute("data-direction-start"),
          padding: getComputedStyle(el.querySelector("td")!).paddingTop,
          border: getComputedStyle(el.querySelector("td")!).borderTopWidth,
          shadow: getComputedStyle(el.querySelector("td")!).boxShadow,
          frozenEdge: el
            .querySelector("td")!
            .hasAttribute("data-table-frozen-edge"),
        };
      });
    });
  for (const segment of segments) {
    expect(segment.starts).toBe(segment.prior !== segment.direction);
    if (segment.prior)
      expect(
        ["nerf", "buff", "neutral"].indexOf(segment.direction),
      ).toBeGreaterThanOrEqual(
        ["nerf", "buff", "neutral"].indexOf(segment.prior),
      );
    if (segment.starts) expect(segment.padding).toBe("9px");
    expect(segment.border).toBe("0px");
    if (segment.frozenEdge) expect(segment.shadow).not.toBe("none");
    else expect(segment.shadow).toBe("none");
  }
  const heroSection = page.getByRole("region", { name: "英雄", exact: true });
  await expect(
    heroSection.locator('[data-direction-count="nerf"]'),
  ).toContainText("削弱");
  await expect(
    heroSection.locator('[data-direction-count="buff"]'),
  ).toContainText("增强");
  await expect(
    heroSection.locator('[data-direction-count="neutral"]'),
  ).toContainText("持平");

  await page.getByRole("searchbox", { name: "搜索变化" }).fill("敌法师");
  // This group already exists before filtering. Wait for the debounced result,
  // otherwise focus can target the old row immediately before it is replaced.
  await expect(heroes.locator("[data-change-row]")).toHaveCount(1);
  await expect
    .poll(async () => {
      const widths = await contentColumnWidths();
      return widths[0] + widths[1];
    })
    .toBeLessThan(initialWidths[0] + initialWidths[1]);
  const antimage = page.locator('[data-change-group="npc_dota_hero_antimage"]');
  await expect(antimage).toHaveCount(1);
  await expect(
    antimage.getByRole("button", { name: "增强 +8.3%" }),
  ).toBeVisible();
  await antimage.locator('a[href^="/abilities/antimage_mana_break?"]').focus();
  await expect(page.getByRole("tooltip")).toContainText("法力损毁");
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "变化", exact: true }).click();
  await page.getByRole("option", { name: "削弱", exact: true }).click();
  await expect(antimage).toHaveCount(0);
  await expect(heroSection.locator("[data-direction-count]")).toHaveCount(0);
});

test("heroes global language persists across catalogs, details and reload", async ({
  page,
  context,
}) => {
  await page.goto("/heroes?q=axe");
  const release = new URL(page.url()).searchParams.get("release");
  await expect(
    page.getByRole("combobox", { name: "语言", exact: true }),
  ).toHaveCount(1);
  await page
    .locator("header")
    .first()
    .getByRole("combobox", { name: "语言", exact: true })
    .click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: "Hero Catalog", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Search heroes" }),
  ).toHaveValue("axe");
  expect(new URL(page.url()).searchParams.get("release")).toBe(release);
  await page.getByRole("button", { name: /Clear/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Search heroes" }),
  ).toHaveValue("");
  expect(new URL(page.url()).searchParams.get("lang")).toBe("en");
  for (const [label, heading] of [
    ["Abilities", "Ability Catalog"],
    ["Units", "Unit Catalog"],
    ["Items", "Item Catalog"],
  ]) {
    await page
      .getByRole("navigation")
      .getByRole("link", { name: label, exact: true })
      .click();
    await page.waitForURL(new RegExp(`/${label.toLowerCase()}\\?`));
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("lang")).toBe("en");
    expect(new URL(page.url()).searchParams.get("release")).toBe(release);
  }
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Heroes", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search heroes" }).fill("antimage");
  await page.locator('a[href^="/heroes/antimage?"]').last().click();
  await expect(
    page.getByRole("heading", { name: "Anti-Mage", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(
    (await context.cookies()).find((c) => c.name === "medota2-locale")?.value,
  ).toBe("en");
});

test("heroes global language persists through cookies, history and map navigation", async ({
  page,
  context,
}) => {
  // These flows keep their own 30s budget: repeated full catalog reloads can
  // otherwise leave less than a second for the final navigation on CI.
  await page.goto("/heroes?lang=en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect
    .poll(
      async () =>
        (await context.cookies()).find((c) => c.name === "medota2-locale")
          ?.value,
    )
    .toBe("en");
  await page.goto("/heroes");
  await expect(
    page.getByRole("heading", { name: "Hero Catalog", exact: true }),
  ).toBeVisible();
  expect(
    (await context.cookies()).find((c) => c.name === "medota2-locale")?.value,
  ).toBe("en");
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "简体中文", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "英雄图鉴", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Hero Catalog", exact: true }),
  ).toBeVisible();
  for (const label of ["Map", "Changes"]) {
    await page
      .getByRole("navigation")
      .getByRole("link", { name: label, exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Language", exact: true }),
    ).toBeVisible();
    await page.waitForURL(new RegExp(`/${label.toLowerCase()}\\?.*lang=en`));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("combobox", { name: "Language", exact: true }),
  ).toBeVisible();
});

test("heroes global locale covers deep pages and preserves map state", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/releases");
  expect(response.ok()).toBe(true);
  const index = await response.json();
  const selected = index.releases.find(
    (r: { id: string }) => r.id === index.defaultRelease,
  );
  const fixture = selected?.catalogClient?.startsWith("fixture-");
  for (const [path, heading] of [
    ["/heroes/antimage", "Anti-Mage"],
    ["/abilities/antimage_blink", "Blink"],
    ["/units", "Unit Catalog"],
    ["/units/npc_dota_roshan", "Roshan"],
    ["/design-system", "Medota2 interface examples"],
    ["/dev/database", "Development database"],
    ["/items", "Item Catalog"],
    ["/items/item_blink", "Blink Dagger"],
    ["/changes", "Version changes"],
  ]) {
    await page.goto(`${path}?lang=en`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page
        .getByRole("heading", {
          name:
            path === "/dev/database" && process.env.MEDOTA2_SHARED_WEB !== "1"
              ? "This version or page is not available"
              : fixture && path.startsWith("/units/")
                ? "Unit data unavailable"
                : fixture && path.startsWith("/items/")
                  ? "Items data is not available for this version"
                  : heading,
          exact: true,
        })
        .first(),
    ).toBeVisible();
    const content =
      path === "/dev/database" && process.env.MEDOTA2_SHARED_WEB === "1"
        ? page.getByRole("region", { name: "Development database inspector" })
        : page.locator("main");
    const untranslated = await content.evaluate((main) => {
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT),
        found: string[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode,
          element = node.parentElement;
        if (
          !element ||
          element.closest("[data-source-text],pre,code") ||
          !element.getClientRects().length
        )
          continue;
        if (/\p{Script=Han}/u.test(node.textContent ?? ""))
          found.push(node.textContent!.trim());
      }
      return found;
    });
    expect(untranslated, path).toEqual([]);
  }
  await page.goto("/map?lang=en#map-state");
  if (fixture && !selected.mapId) {
    await expect(
      page.getByRole("heading", {
        name: "Map data is not available for this version",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "Language", exact: true }).click();
    await page.getByRole("option", { name: "简体中文", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(
      page.getByRole("heading", {
        name: "该版本的地图资料未收录",
        exact: true,
      }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("release")).toBe(selected.id);
    expect(new URL(page.url()).hash).toBe("#map-state");
    return;
  }
  await page
    .getByRole("textbox", { name: "Search map points", exact: true })
    .fill("bounty");
  await page
    .getByRole("list", { name: "Map points", exact: true })
    .getByRole("button")
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "Point details", exact: true }),
  ).toBeVisible();
  const zoom = await page
    .getByLabel("Zoom level", { exact: true })
    .textContent();
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "简体中文", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("textbox", { name: "搜索地图点位", exact: true }),
  ).toHaveValue("bounty");
  await expect(
    page.getByRole("region", { name: "点位详情", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("缩放比例", { exact: true })).toHaveText(zoom!);
  expect(new URL(page.url()).hash).toBe("#map-state");
});
