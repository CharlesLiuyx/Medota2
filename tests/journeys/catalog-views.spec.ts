import { mkdir } from "node:fs/promises";
import type { APIRequestContext, Page } from "@playwright/test";
import type { ReleaseIndex } from "@/domain/releases";
import { expect, test } from "../e2e/test-fixture";

async function usesCatalogFixture(request: APIRequestContext) {
  const response = await request.get("/api/releases");
  expect(response.ok()).toBe(true);
  const index = (await response.json()) as ReleaseIndex;
  const selected = index.releases.find((r) => r.id === index.defaultRelease);
  expect(selected).toBeTruthy();
  return selected!.catalogClient?.startsWith("fixture-") ?? false;
}

async function expectMissingFixtureSource(page: Page, entity: string) {
  const label = entity === "units" ? "单位" : "物品";
  await expect(
    page.getByRole("heading", { name: `${label}图鉴`, exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `该版本的${label}资料尚未接入` }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "网格视图", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "表格视图", exact: true }),
  ).toHaveCount(0);
}

for (const [entity, realQuery] of [
  ["heroes", "axe"],
  ["abilities", "blink"],
  ["units", "roshan"],
  ["items", "blink"],
] as const) {
  test(`${entity}: grid and table preserve search, navigation and language`, async ({
    page,
    request,
  }) => {
    const fixture = await usesCatalogFixture(request);
    const query = fixture && entity === "heroes" ? "antimage" : realQuery;
    await page.goto(
      `/${entity}?lang=zh-CN${fixture && entity === "heroes" ? "&q=fixture_scroll_00" : ""}`,
    );
    if (fixture && (entity === "units" || entity === "items")) {
      await expectMissingFixtureSource(page, entity);
      return;
    }
    const grid = page.getByRole("button", { name: "网格视图", exact: true });
    const table = page.getByRole("button", { name: "表格视图", exact: true });
    await expect(grid).toHaveAttribute("aria-pressed", "true");
    await table.click();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page).toHaveURL(/view=table/);
    const search = page.locator('input[name="q"]');
    await search.fill(query);
    await expect(page).toHaveURL(new RegExp(`q=${query}`));
    await expect(table).toHaveAttribute("aria-pressed", "true");
    const first = page
      .locator(`[data-entity-catalog-table] table a[href^="/${entity}/"]`)
      .first();
    await expect(first).toBeVisible();
    const href = await first.getAttribute("href");
    await first.hover();
    await expect(page.getByRole("tooltip").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await first.click();
    await expect(page).toHaveURL(new RegExp(`/${entity}/`));
    expect(href).toContain(`/${entity}/`);
    await page.goBack();
    await expect(table).toHaveAttribute("aria-pressed", "true");
    await expect(search).toHaveValue(query);
    await page.reload();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(search).toHaveValue(query);
  });
  test(`${entity}: empty search, clear and language preserve table view`, async ({
    page,
    request,
  }) => {
    const fixture = await usesCatalogFixture(request);
    const query = fixture && entity === "heroes" ? "antimage" : realQuery;
    await page.goto(`/${entity}?lang=zh-CN&view=table&q=${query}`);
    if (fixture && (entity === "units" || entity === "items")) {
      await expectMissingFixtureSource(page, entity);
      return;
    }
    const grid = page.getByRole("button", { name: "网格视图", exact: true });
    const table = page.getByRole("button", { name: "表格视图", exact: true });
    const search = page.locator('input[name="q"]');
    await expect(page.getByRole("table")).toBeVisible();
    // SSR table markup precedes hydration; the view switch exposes readiness.
    await expect(table).toBeEnabled();
    await page
      .getByRole("button", { name: /^清除(?:筛选|全部| \d+)$/ })
      .click();
    await expect(search).toHaveValue("");
    await expect(table).toHaveAttribute("aria-pressed", "true");
    await search.fill("zzzznotanentity");
    await expect(
      page.getByText("没有符合条件的结果。", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /^清除(?:筛选|全部| \d+)$/ })
      .click();
    await expect(page.getByRole("table")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(table).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await grid.click();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(grid).toHaveAttribute("aria-pressed", "true");
    await page.goto(`/${entity}?lang=en&view=table&q=${query}`);
    await expect(
      page.getByRole("button", { name: "Table view", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("columnheader", { name: /Entity/ }),
    ).toBeVisible();
  });
  test(`${entity}: sorting and frozen headers stay aligned on mobile`, async ({
    page,
    request,
  }) => {
    const fixture = await usesCatalogFixture(request);
    const fixtureHeroes = fixture && entity === "heroes";
    await page.goto(
      `/${entity}?lang=zh-CN&view=table${fixtureHeroes ? "&q=fixture_scroll_00" : ""}`,
    );
    if (fixtureHeroes) {
      // Nine known rows still cover complete-result ordering. A shorter viewport
      // lets this compact fixture exercise vertical pinning without filler rows.
      await page.setViewportSize({ width: 1280, height: 320 });
      await expect(
        page.getByRole("status").filter({ hasText: "9 / 194" }),
      ).toBeVisible();
    }
    if (fixture && (entity === "units" || entity === "items")) {
      await expectMissingFixtureSource(page, entity);
      return;
    }
    await expect(page.getByRole("table")).toBeVisible();
    const sortLabel =
      entity === "heroes"
        ? "移动速度"
        : entity === "abilities"
          ? "魔法消耗"
          : entity === "units"
            ? "生命值"
            : "价格";
    const sortAscending = page.getByRole("button", {
      name: `按${sortLabel}升序排序`,
      exact: true,
    });
    await expect(sortAscending).toBeEnabled();
    await expect(
      page.locator('thead th[data-catalog-column="entity"]'),
    ).toHaveAttribute("data-table-frozen", "");
    const categoryHeader = page.locator(
      'thead th[data-catalog-column="category"]',
    );
    await categoryHeader.hover();
    await categoryHeader
      .getByRole("button", { name: "配置分类列", exact: true })
      .click();
    await page.getByRole("button", { name: "冻结至此列", exact: true }).click();
    await expect(page.getByRole("table")).toHaveAttribute(
      "data-frozen-count",
      "2",
    );

    if (entity === "heroes") {
      await expect(
        page.locator("[data-entity-catalog-table] thead th"),
      ).toHaveCount(19);
      const defaultFields = await page
        .locator("[data-entity-catalog-table] thead th")
        .evaluateAll((headers) =>
          headers.map((header) => {
            const key = header.getAttribute("data-catalog-column")!;
            return key.startsWith("attribute:")
              ? JSON.parse(key.slice("attribute:".length))[1]
              : key;
          }),
        );
      expect(defaultFields).toEqual([
        "entity",
        "category",
        "base_strength",
        "strength_gain",
        "base_agility",
        "agility_gain",
        "base_intelligence",
        "intelligence_gain",
        "movement_speed",
        "base_armor",
        "night_vision",
        "complexity",
        "base_health_regen",
        "base_attack_damage_min",
        "base_attack_damage_max",
        "base_attack_speed",
        "attack_rate",
        "attack_range",
        "roles",
      ]);
      await categoryHeader.hover();
      await categoryHeader
        .getByRole("button", { name: "配置分类列", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "冻结至此列", exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "取消冻结", exact: true }).click();
      await expect(page.getByRole("table")).toHaveAttribute(
        "data-frozen-count",
        "0",
      );
      await categoryHeader.hover();
      await categoryHeader
        .getByRole("button", { name: "配置分类列", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "取消冻结", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "冻结至此列", exact: true })
        .click();
      await page.evaluate(() => window.scrollTo(0, 350));
      const pinned = page.locator(
        "[data-entity-catalog-table] [data-table-header-content][data-table-pinned]",
      );
      await expect(pinned).toHaveCount(19);
      await expect
        .poll(async () =>
          pinned.evaluateAll((headers) => {
            const bounds = headers.map((header) =>
              header.getBoundingClientRect(),
            );
            return (
              Math.max(...bounds.map((b) => b.top)) -
                Math.min(...bounds.map((b) => b.top)) <
                1 &&
              Math.max(...bounds.map((b) => b.bottom)) -
                Math.min(...bounds.map((b) => b.bottom)) <
                1
            );
          }),
        )
        .toBe(true);
      await expect(pinned.first()).toHaveCSS("padding-top", "3px");
      await page.screenshot({
        path: "output/playwright/hero-table-pinned-header.png",
      });
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    await sortAscending.click();
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText(
      sortLabel,
    );
    const readValues = () =>
      page.locator("[data-entity-catalog-table] table").evaluate((table) => {
        const index = [...table.querySelectorAll("thead th")].findIndex(
          (cell) => cell.getAttribute("aria-sort") !== "none",
        );
        return [...table.querySelectorAll("tr[data-catalog-entity]")]
          .map(
            (row) =>
              [...row.children]
                .find(
                  (cell, cellIndex, cells) =>
                    cells
                      .slice(0, cellIndex + 1)
                      .reduce(
                        (sum, cell) =>
                          sum + (cell as HTMLTableCellElement).colSpan,
                        0,
                      ) > index,
                )
                ?.textContent?.trim() ?? "",
          )
          .filter((value) => value !== "—")
          .map((value) => Number(value.match(/[+-]?\d+(?:\.\d+)?/)?.[0]))
          .filter(Number.isFinite);
      });
    await expect
      .poll(async () => {
        const values = await readValues();
        return (
          values.length > 1 &&
          values.every(
            (value, index) => index === 0 || value >= values[index - 1],
          )
        );
      })
      .toBe(true);
    await page
      .getByRole("button", { name: `按${sortLabel}降序排序`, exact: true })
      .click();
    await expect(page.locator('th[aria-sort="descending"]')).toContainText(
      sortLabel,
    );
    await expect
      .poll(async () => {
        const values = await readValues();
        return (
          values.length > 1 &&
          values.every(
            (value, index) => index === 0 || value <= values[index - 1],
          )
        );
      })
      .toBe(true);
    if (entity === "heroes") {
      await mkdir("output/playwright", { recursive: true });
      await page.screenshot({
        path: "output/playwright/entity-table-heroes.png",
      });
    }
    await page.setViewportSize({
      width: 390,
      height: fixtureHeroes ? 320 : 844,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const scroll = page
      .locator("[data-entity-catalog-table] table")
      .locator("..");
    const frozenPositions = () =>
      page
        .locator("[data-entity-catalog-table] thead th[data-table-frozen]")
        .evaluateAll((cells) =>
          cells.map((cell) => Math.round(cell.getBoundingClientRect().left)),
        );
    const positions = await frozenPositions();
    await scroll.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    await expect.poll(frozenPositions).toEqual(positions);
    const frozenBody = await page
      .locator("[data-entity-catalog-table] tr[data-catalog-entity]")
      .first()
      .locator("[data-table-frozen]")
      .evaluateAll((cells) =>
        cells.map((cell) => Math.round(cell.getBoundingClientRect().left)),
      );
    expect(frozenBody).toEqual(positions);

    await expect(
      page.locator("[data-entity-catalog-table] thead th[data-table-frozen]"),
    ).toHaveCount(2);
    expect(await page.locator("select").count()).toBe(0);

    expect(await scroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo(0, 350));
    await expect
      .poll(async () =>
        page
          .locator("[data-entity-catalog-table] [data-table-header-content]")
          .evaluateAll((headers) => {
            const bounds = headers.map((header) =>
              header.getBoundingClientRect(),
            );
            return (
              headers.every((header) =>
                header.hasAttribute("data-table-pinned"),
              ) &&
              Math.max(...bounds.map((b) => b.top)) -
                Math.min(...bounds.map((b) => b.top)) <
                1 &&
              Math.max(...bounds.map((b) => b.bottom)) -
                Math.min(...bounds.map((b) => b.bottom)) <
                1
            );
          }),
      )
      .toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
  });
}

for (const [entity, kind, field, realQuery] of [
  ["heroes", "hero", "base_mana_regen", "axe"],
  ["abilities", "ability", "AbilityCastRange", "blink"],
  ["units", "unit", "MovementTurnRate", "roshan"],
  ["items", "item", "ItemStockMax", "blink"],
] as const) {
  test(`${entity}: column choices include complete attributes, persist and reset in the title row`, async ({
    page,
    request,
  }) => {
    const fixture = await usesCatalogFixture(request);
    const query = fixture && entity === "heroes" ? "antimage" : realQuery;
    if (fixture && (entity === "units" || entity === "items")) {
      await page.goto(`/${entity}?lang=zh-CN&view=table`);
      await expectMissingFixtureSource(page, entity);
      return;
    }
    const response = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/catalog/table-attributes?`) &&
        response.url().includes(`kind=${kind}`),
    );
    await page.goto(
      `/${entity}?lang=zh-CN&view=table${fixture && entity === "heroes" ? "&q=antimage" : ""}`,
    );
    const data = await (await response).json();
    const extra = data.columns.find(
      (column: { field: string }) => column.field === field,
    );
    expect(extra).toBeTruthy();
    const table = page.locator("[data-entity-catalog-table] table");
    const chooser = page.locator(
      "[data-catalog-header] [data-catalog-column-settings] summary",
    );
    await expect(chooser).toBeVisible();
    const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
    const position = await chooser.boundingBox();
    expect(
      Math.abs(
        position!.y + position!.height / 2 - heading!.y - heading!.height / 2,
      ),
    ).toBeLessThan(5);
    const originalCount = await table.locator("thead th").count();
    await chooser.click();
    await page.getByRole("checkbox", { name: "分类", exact: true }).uncheck();
    await page
      .getByRole("searchbox", { name: "搜索列", exact: true })
      .fill(field);
    const option = page.locator(
      `[data-column-key=${JSON.stringify(extra.key)}]`,
    );
    await expect(option).toBeVisible();
    await option.check();
    await page.keyboard.press("Escape");
    await expect(table.locator("thead th")).toHaveCount(originalCount);
    const extraSort = page.getByRole("button", {
      name: `按${extra.zh}升序排序`,
      exact: true,
    });
    await expect(extraSort).toBeVisible();
    await extraSort.click();
    await expect(page).toHaveURL(/order=asc/);
    await page.reload();
    await expect(
      page.getByRole("button", { name: `按${extra.zh}降序排序`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "按分类升序排序", exact: true }),
    ).toHaveCount(0);
    await page.locator('input[name="q"]').fill(query);
    await expect(page).toHaveURL(new RegExp(`q=${query}`));
    await expect(table.locator("thead th")).toHaveCount(originalCount);
    await chooser.click();
    await page
      .getByRole("searchbox", { name: "搜索列", exact: true })
      .fill(field);
    await expect(option).toBeChecked();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "网格视图", exact: true }).click();
    await expect(chooser).toHaveCount(0);
    await page.getByRole("button", { name: "表格视图", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `按${extra.zh}降序排序`, exact: true }),
    ).toBeVisible();
    if (entity === "heroes") {
      await page.screenshot({
        path: "output/playwright/entity-table-columns.png",
      });
    }
    const url = new URL(page.url());
    url.searchParams.set("lang", "en");
    await page.goto(url.href);
    await expect(
      page.getByRole("button", {
        name: `Sort ${extra.en} descending`,
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Reset table", exact: true })
      .click();
    await expect(page).not.toHaveURL(/sort=|order=/);
    await expect(
      page.getByRole("button", {
        name:
          entity === "heroes"
            ? "Sort Category descending"
            : "Sort Category ascending",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: `Sort ${extra.en} ascending`,
        exact: true,
      }),
    ).toHaveCount(0);
    await page.reload();
    await expect(table.locator("thead th")).toHaveCount(originalCount);
    expect(
      await page.evaluate(
        (kind) => localStorage.getItem(`medota2:catalog-columns:v1:${kind}`),
        kind,
      ),
    ).toBeNull();
    await page.setViewportSize({ width: 390, height: 844 });
    await chooser.click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
