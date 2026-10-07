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
test("heroes changes: shared dropdowns submit and restore comparison filters", async ({
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
  const query = new URLSearchParams({ release: catalog.id, from: catalog.id });
  await page.goto(`/changes?${query}`);
  await expect(
    page.getByRole("heading", { name: "版本变化", exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "起始版本", exact: true }).click();
  await page.getByRole("option", { name: catalog.label, exact: true }).click();
  await page.getByRole("combobox", { name: "对象", exact: true }).click();
  await page.getByRole("option", { name: "地图对象", exact: true }).click();
  await page.getByRole("combobox", { name: "变化", exact: true }).click();
  await page.getByRole("option", { name: "属性", exact: true }).click();
  await page.getByRole("button", { name: "比较", exact: true }).click();
  await expect(page).toHaveURL(/entity=map_object/);
  await expect(
    page.getByRole("combobox", { name: "对象", exact: true }),
  ).toContainText("地图对象");
  await expect(
    page.getByRole("combobox", { name: "变化", exact: true }),
  ).toContainText("属性");
  const params = new URL(page.url()).searchParams;
  expect(params.get("release")).toBe(catalog.id);
  expect(params.get("from")).toBe(catalog.id);
  expect(params.get("category")).toBe("property");
  await page.reload();
  const entity = page.getByRole("combobox", { name: "对象", exact: true });
  await expect(entity).toContainText("地图对象");
  await entity.click();
  await expect(
    page.getByRole("option", { name: "地图对象", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(entity).toBeFocused();
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
    bane.getByRole("heading", { name: "祸乱之源", exact: true }),
  ).toBeVisible();
  await expect(
    bane.getByText("基础护甲：降低1点", { exact: true }),
  ).toBeVisible();
  await expect(bane.locator(".change-value-row")).toHaveText("基础护甲1→0");
  await expect(
    page.getByRole("link", { name: "7.41f 官方更新说明 ↗", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("searchbox", { name: "搜索变化" }).fill("恐鳌之心");
  await page.getByRole("button", { name: "比较", exact: true }).click();
  const heart = page.locator('[data-change-group="item_heart"]');
  await expect(
    heart.getByRole("heading", { name: "恐鳌之心", exact: true, level: 2 }),
  ).toBeVisible();
  await expect(
    heart.getByRole("heading", { name: "恐鳌之心图纸", exact: true }),
  ).toBeVisible();
  await expect(heart.locator(".change-value-row").last()).toHaveText(
    "价格700→800",
  );
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "搜索变化" })).toHaveValue(
    "恐鳌之心",
  );
  await page.goto(
    `/changes?${new URLSearchParams({ release: from.id, from: to.id, q: "祸乱之源" })}`,
  );
  await expect(
    page.locator('[data-change-group="npc_dota_hero_bane"] .change-value-row'),
  ).toHaveText("基础护甲0→1");
  await expect(
    page.getByRole("link", { name: "7.41e 官方更新说明 ↗", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("searchbox", { name: "搜索变化" }).fill("恐鳌之心");
  await page.getByRole("button", { name: "比较", exact: true }).click();
  await expect(
    page.locator('[data-change-group="item_heart"] .change-value-row').last(),
  ).toHaveText("价格800→700");
});

test("heroes global language persists across catalogs, details, history and reload", async ({
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
}) => {
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
      page.getByRole("heading", { name: heading, exact: true }).first(),
    ).toBeVisible();
    const content =
      path === "/dev/database"
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
