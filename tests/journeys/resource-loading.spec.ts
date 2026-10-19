import { expect, test } from "../e2e/test-fixture";
import type { ReleaseIndex } from "@/domain/releases";

test("viewport: repeated catalog navigation releases old trees and image listeners", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "Uses Chromium heap diagnostics.");
  test.skip(process.env.MEDOTA2_SHARED_WEB !== "1", "Uses all real catalogs.");
  test.setTimeout(90_000);
  await page.goto("/heroes?lang=zh-CN");
  await expect(page.locator('[data-browser-cache="ready"]')).toBeVisible();
  const session = await page.context().newCDPSession(page);
  const routes = [
    ["英雄", "/heroes"],
    ["技能", "/abilities"],
    ["单位", "/units"],
    ["物品", "/items"],
    ["属性", "/attributes"],
    ["地图", "/map"],
  ];
  const samples = [];
  try {
    for (let round = 1; round <= 9; round++) {
      for (const [name, path] of routes) {
        await page
          .getByRole("navigation", { name: "图鉴分类" })
          .getByRole("link", { name, exact: true })
          .click();
        await page.waitForURL((url) => url.pathname === path);
        await expect(page).toHaveTitle(new RegExp(name));
      }
      if (round === 3 || round === 9) {
        // Let pending image decoding settle before comparing surviving objects.
        await page.waitForTimeout(1000);
        await session.send("HeapProfiler.collectGarbage");
        samples.push({
          round,
          ...(await session.send("Memory.getDOMCounters")),
          heap: (await session.send("Runtime.getHeapUsage")).usedSize,
        });
      }
    }
    await testInfo.attach("catalog-navigation-memory", {
      body: JSON.stringify(samples, null, 2),
      contentType: "application/json",
    });
    const [warm, final] = samples;
    expect(final.documents).toBe(warm.documents);
    expect(final.nodes - warm.nodes).toBeLessThan(2000);
    expect(final.jsEventListeners - warm.jsEventListeners).toBeLessThan(400);
    expect(final.heap - warm.heap).toBeLessThan(8 * 1024 * 1024);
  } finally {
    await session.detach();
  }
});

test("items: wide table windows columns and keeps frozen objects while scrolling", async ({
  page,
  request,
}) => {
  const index = (await (
    await request.get("/api/releases")
  ).json()) as ReleaseIndex;
  test.skip(
    Boolean(
      index.releases
        .find((release) => release.id === index.defaultRelease)
        ?.catalogClient?.startsWith("fixture-"),
    ),
    "This fixture has no item source.",
  );
  await page.goto("/items?lang=zh-CN&view=table");
  const table = page.locator("[data-entity-catalog-table] table");
  const scroll = page.locator("[data-column-window]");
  await expect(scroll).toBeVisible();
  const count = await table.locator("colgroup col").count();
  expect(count).toBeGreaterThan(64);
  expect(
    await table.locator("thead [data-catalog-column]").count(),
  ).toBeLessThan(40);
  const entity = table.locator('thead [data-catalog-column="entity"]');
  await expect(entity).toHaveAttribute("data-table-frozen", "");
  const before = (await entity.boundingBox())!;
  const firstRow = table.locator("tr[data-catalog-entity]").first();
  await expect(firstRow).toBeVisible();
  const rowHeight = (await firstRow.boundingBox())!.height;
  await scroll.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
  });
  await expect(table.locator(`thead [aria-colindex="${count}"]`)).toBeVisible();
  const after = (await entity.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
  expect((await firstRow.boundingBox())!.height).toBeGreaterThanOrEqual(
    rowHeight - 1,
  );
  expect(
    await table.locator("thead [data-catalog-column]").count(),
  ).toBeLessThan(40);
  expect(
    await table
      .locator("tr[data-catalog-entity]")
      .first()
      .evaluate((row: HTMLTableRowElement) =>
        [...row.cells].reduce((sum, cell) => sum + cell.colSpan, 0),
      ),
  ).toBe(count);
  const firstChunk = table.locator("tbody[data-infinite-list-chunk]").first();
  await expect
    .poll(
      async () => {
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight),
        );
        return firstChunk.locator("[data-infinite-list-spacer]").count();
      },
      { timeout: 15_000 },
    )
    .toBe(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(
    firstChunk.locator("tr[data-catalog-entity]").first(),
  ).toBeVisible();
  expect(
    (await firstChunk.locator("tr[data-catalog-entity]").first().boundingBox())!
      .height,
  ).toBeGreaterThanOrEqual(rowHeight - 1);
  await expect(table.locator(`thead [aria-colindex="${count}"]`)).toBeVisible();
});

test("heroes: table resources reuse selected columns and keep measurement DOM bounded", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/catalog/table-attributes"))
      requests.push(request.method());
  });
  await page.goto("/heroes?lang=zh-CN&view=table");
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  await expect.poll(() => requests.includes("POST")).toBe(true);
  await expect(
    table
      .getByRole("columnheader", { name: /基础护甲/ })
      .getByRole("button")
      .first(),
  ).toBeEnabled();
  const count = requests.length;
  const samples = page.locator("[data-width-text]");
  expect(await samples.count()).toBeLessThanOrEqual(
    (await table.locator("col").count()) * 2,
  );
  expect(
    await samples.evaluateAll((nodes) =>
      nodes.every(
        (node) => node.children.length === 0 && Boolean(node.textContent),
      ),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "网格视图", exact: true }).click();
  await expect(table).toHaveCount(0);
  await page.getByRole("button", { name: "表格视图", exact: true }).click();
  await expect(table).toBeVisible();
  await expect(
    table
      .getByRole("columnheader", { name: /基础护甲/ })
      .getByRole("button")
      .first(),
  ).toBeEnabled();
  expect(requests).toHaveLength(count);
});

test("map: delayed vision preserves keyboard intent and cancellation", async ({
  page,
  request,
}) => {
  const index = (await (
    await request.get("/api/releases")
  ).json()) as ReleaseIndex;
  const release = index.releases.find(
    (entry) => entry.mapId && entry.patch === "7.41f",
  );
  test.skip(!release, "This fixture has no native map Dataset.");
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let requests = 0;
  await page.route("**/api/map/vision?*", async (route) => {
    requests++;
    await gate;
    await route.continue();
  });
  await page.goto(`/map?lang=en&release=${encodeURIComponent(release!.id)}`);
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  const vision = page.getByRole("button", { name: "Vision", exact: true });
  await canvas.press("q");
  await canvas.press("q");
  await expect(vision).toHaveAttribute("aria-busy", "true");
  await canvas.press("w");
  await expect(vision).toHaveAttribute("aria-busy", "false");
  const response = page.waitForResponse((response) =>
    response.url().includes("/api/map/vision?"),
  );
  resume();
  expect((await response).ok()).toBe(true);
  await expect(
    page.getByRole("button", { name: "Routes", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(vision).toHaveAttribute("aria-pressed", "false");
  await canvas.press("q");
  await expect(vision).toHaveAttribute("aria-pressed", "true");
  const rect = (await canvas.boundingBox())!;
  const panel = page.getByRole("region", {
    name: "Vision simulation",
    exact: true,
  });
  for (const [dx, dy] of [
    [0, 0],
    [32, 0],
    [-32, 0],
    [0, 32],
    [0, -32],
    [32, 32],
    [-32, -32],
  ]) {
    await page.mouse.move(
      rect.x + rect.width / 2 + dx,
      rect.y + rect.height / 2 + dy,
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    if (await panel.getAttribute("data-vision-preview")) break;
  }
  await expect(panel).toHaveAttribute("data-vision-preview", /^cursor:/);
  expect(requests).toBe(1);
});

test("heroes changes: raw audit is requested only when opened and reused", async ({
  page,
  request,
}) => {
  const responseIndex = await request.get("/api/releases");
  expect(responseIndex.ok()).toBe(true);
  const index = (await responseIndex.json()) as ReleaseIndex;
  const latestIndex = index.releases.findIndex(
    (release) => release.id === index.defaultRelease,
  );
  const sameVersion = !index.releases[latestIndex + 1];
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/releases/change-resource")) requests++;
  });
  await page.goto("/changes?lang=zh-CN");
  const search = page.getByRole("searchbox", { name: "搜索变化" });
  await expect(search).toBeEnabled();
  await search.fill("zzzz-resource-test");
  await expect(page).toHaveURL(/q=zzzz-resource-test/);
  const status = page.locator("main [role=status]").first();
  await expect(status).toContainText(
    sameVersion ? "起始与目标为同一版本。" : "0 个对象",
  );
  await search.fill("");
  await expect
    .poll(() => new URL(page.url()).searchParams.has("q"))
    .toBe(false);
  if (sameVersion) await expect(status).toHaveText("起始与目标为同一版本。");
  else await expect(status).not.toContainText("0 个对象");
  await page
    .getByRole("button", { name: "比较范围与来源", exact: true })
    .click();
  const summary = page
    .locator("summary")
    .filter({ hasText: /^原始资料及尚未解释的变化/ });
  await expect(summary).toBeVisible();
  expect(requests).toBe(0);
  const response = page.waitForResponse((response) =>
    response.url().includes("/api/releases/change-resource"),
  );
  await summary.click();
  expect((await response).ok()).toBe(true);
  await expect(
    summary.locator("..").getByText("正在加载资料…", { exact: true }),
  ).toHaveCount(0);
  await summary.click();
  await summary.click();
  expect(requests).toBe(1);
});
