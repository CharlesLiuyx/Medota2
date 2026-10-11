import type { APIRequestContext } from "@playwright/test";
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

test("heroes: column menus, float precision, attribute effects and long-press order persist", async ({
  page,
  request,
}) => {
  const fixture = await usesCatalogFixture(request);
  const growthValue = fixture ? 2 : 3;
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().includes("/api/catalog/table-attributes?") &&
      response.url().includes("kind=hero"),
  );
  const valuesResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/catalog/table-attributes?") &&
      response.url().includes("kind=hero"),
  );
  await page.goto(
    `/heroes?lang=zh-CN&view=table${fixture ? "&q=antimage" : ""}`,
  );
  const data = await (await response).json();
  const growth = data.columns.find(
    (column: { field: string }) => column.field === "strength_gain",
  );
  expect(growth).toBeTruthy();
  const table = page.locator("[data-entity-catalog-table] table");
  const header = (key: string) =>
    table.locator(`thead th[data-catalog-column=${JSON.stringify(key)}]`);
  await page.locator("[data-catalog-column-settings] summary").click();
  await page
    .getByRole("searchbox", { name: "搜索列", exact: true })
    .fill("strength_gain");
  await page.locator(`[data-column-key=${JSON.stringify(growth.key)}]`).check();
  await page.keyboard.press("Escape");
  const valueData = await (await valuesResponse).json();
  const owner = Object.entries(
    valueData.values as Record<string, Record<string, string[]>>,
  ).find(([, fields]) =>
    fields[growth.key]?.some((value) =>
      new RegExp(`^${growthValue}\\.0+$`, "u").test(value),
    ),
  )?.[0];
  expect(owner).toBeTruthy();
  await page
    .locator('input[name="q"]')
    .fill(owner!.replace("npc_dota_hero_", ""));
  const row = table.locator(`tr[data-catalog-entity=${JSON.stringify(owner)}]`);
  const cell = async (key: string) =>
    row.locator(`td[data-table-column=${JSON.stringify(key)}]`);
  await expect(await cell(growth.key)).toHaveText(String(growthValue));
  expect(
    await header(growth.key).evaluate(
      (node) => node.getBoundingClientRect().width,
    ),
  ).toBeLessThanOrEqual(65);
  expect(
    await header(growth.key)
      .locator("[data-table-header-content]")
      .evaluate((node) => node.getBoundingClientRect().height),
  ).toBeGreaterThan(30);

  await header(growth.key).hover();
  await header(growth.key)
    .getByRole("button", { name: `配置${growth.zh}列`, exact: true })
    .click();
  const menu = page.getByRole("dialog", {
    name: `配置${growth.zh}列`,
    exact: true,
  });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("combobox", { name: "小数位数" })).toContainText(
    "自动",
  );
  await menu.getByRole("combobox", { name: "小数位数" }).click();
  await menu.getByRole("option", { name: "3", exact: true }).click();
  await expect(await cell(growth.key)).toHaveText(`${growthValue}.000`);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(await cell(growth.key)).toHaveText(`${growthValue}.000`);
  await header(growth.key).hover();
  await header(growth.key)
    .getByRole("button", { name: `配置${growth.zh}列`, exact: true })
    .click();
  await expect(menu.getByRole("combobox", { name: "小数位数" })).toContainText(
    "3",
  );
  await menu.getByRole("button", { name: "恢复默认小数位数" }).click();
  await expect(await cell(growth.key)).toHaveText(String(growthValue));
  await expect(menu.getByRole("combobox", { name: "小数位数" })).toContainText(
    "自动",
  );
  await page.screenshot({
    path: "output/playwright/entity-table-auto-precision.png",
  });
  const growthIndex = await header(growth.key).evaluate((node) =>
    [...node.parentElement!.children].indexOf(node),
  );
  await menu.getByRole("button", { name: "向左移动", exact: true }).click();
  const order = () =>
    table
      .locator("thead th")
      .evaluateAll((headers) =>
        headers.map((item) => item.getAttribute("data-catalog-column")),
      );
  expect((await order())[growthIndex - 1]).toBe(growth.key);
  await page.getByRole("button", { name: "重置表格", exact: true }).click();
  await expect(header(growth.key)).toHaveCount(1);
  const original = await order();
  const source = await header("base_strength")
    .getByRole("button", { name: "按力量升序排序", exact: true })
    .boundingBox();
  const target = await header("movement_speed").boundingBox();
  await page.mouse.move(
    source!.x + source!.width / 2,
    source!.y + source!.height / 2,
  );
  await page.mouse.down();
  await expect(
    header("base_strength").locator("[data-pressing]"),
  ).toBeVisible();
  await page.waitForTimeout(220);
  await expect(
    header("base_strength").locator("[data-dragging]"),
  ).toBeVisible();
  await page.mouse.move(
    target!.x + target!.width - 5,
    target!.y + target!.height / 2,
    { steps: 12 },
  );
  await expect(header("movement_speed")).toHaveAttribute(
    "data-column-drop",
    "after",
  );
  await expect(
    header("movement_speed").locator("[data-table-header-content]"),
  ).toHaveCSS("box-shadow", "rgb(142, 203, 217) -3px 0px 0px 0px inset");
  await page.screenshot({ path: "output/playwright/entity-table-drag.png" });
  await page.mouse.up();
  const reordered = original.filter((key) => key !== "base_strength");
  reordered.splice(reordered.indexOf("movement_speed") + 1, 0, "base_strength");
  await expect.poll(order).toEqual(reordered);
  await expect(page).not.toHaveURL(/sort=/);
  await page.reload();
  await expect.poll(order).toEqual(reordered);
  const strengthCell = await cell("base_strength");
  const raw = Number(await strengthCell.innerText());
  await strengthCell.getByRole("link").hover();
  const details = page.locator("[data-attribute-calculation]");
  await expect(details).toContainText(
    "每点力量增加 22 点生命上限和 0.1 点/秒生命恢复。",
  );
  await expect(details).toContainText(`${raw} × 22 = ${raw * 22}`);
  await expect(details).toContainText("仅表示基础贡献");
  await page.screenshot({ path: "output/playwright/entity-table-formula.png" });
  await page.mouse.move(0, 0);
  await row.locator('td[data-table-column="entity"]').getByRole("link").hover();
  const heroCard = page.locator('[data-tooltip-depth="0"]');
  await expect(heroCard).toContainText(new RegExp(`力量\\s*${raw}\\b`));
  await expect(heroCard).not.toContainText(/\d+\.0{2,}/u);
  await page.screenshot({
    path: "output/playwright/entity-hero-auto-precision.png",
  });
  await page.mouse.move(0, 0);
  await header("category").hover();
  await header("category")
    .getByRole("button", { name: "配置分类列", exact: true })
    .click();
  await page.getByRole("button", { name: "隐藏此列", exact: true }).click();
  await expect(header("category")).toHaveCount(0);
  await page.getByRole("button", { name: "重置表格", exact: true }).click();
  await expect.poll(order).toEqual(original);
});

test("heroes: shared dropdown opens synchronously without rebuilding table rows", async ({
  page,
}) => {
  await page.goto(
    `/heroes?lang=zh-CN&view=table${fixture ? "&q=antimage" : ""}`,
  );
  await expect(
    page.getByRole("button", { name: "按力量升序排序", exact: true }),
  ).toBeEnabled();
  // Initial virtual chunks are appended after sorting becomes available. Start
  // measuring menu work only after that independent rendering has settled.
  await page.locator("[data-entity-catalog-table] table").evaluate(
    (table) =>
      new Promise<void>((resolve, reject) => {
        let quiet: ReturnType<typeof setTimeout>;
        const observer = new MutationObserver(() => {
          clearTimeout(quiet);
          quiet = setTimeout(finish, 100);
        });
        const deadline = setTimeout(() => {
          observer.disconnect();
          clearTimeout(quiet);
          reject(new Error("Initial table rendering did not settle"));
        }, 5000);
        function finish() {
          observer.disconnect();
          clearTimeout(deadline);
          resolve();
        }
        observer.observe(table, { childList: true, subtree: true });
        quiet = setTimeout(finish, 100);
      }),
  );
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const metrics = await page
    .getByRole("combobox", { name: "队长模式", exact: true })
    .evaluate(async (trigger) => {
      const mutations: MutationRecord[] = [];
      const table = document.querySelector(
        "[data-entity-catalog-table] table",
      )!;
      const observer = new MutationObserver((records) =>
        mutations.push(...records),
      );
      observer.observe(table, { childList: true, subtree: true });
      const samples = [];
      for (let i = 0; i < 12; i++) {
        const start = performance.now();
        (trigger as HTMLElement).click();
        const popup =
          trigger.parentElement!.querySelector<HTMLElement>("[role=listbox]")!;
        const visible =
          popup.getBoundingClientRect().height > 0 &&
          getComputedStyle(popup).display !== "none";
        samples.push({ ms: performance.now() - start, visible });
        (trigger as HTMLElement).click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      observer.disconnect();
      return {
        cpu: "4x",
        samples,
        rowMutations: mutations.length,
        changes: mutations.map((record) => ({
          target: (record.target as Element).outerHTML?.slice(0, 300),
          added: [...record.addedNodes].map((node) => node.nodeName),
          removed: [...record.removedNodes].map((node) => node.nodeName),
        })),
      };
    });
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  console.log("dropdown-performance", JSON.stringify(metrics));
  await test.info().attach("dropdown-performance", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
  expect(metrics.samples.every((sample) => sample.visible)).toBe(true);
  expect(metrics.rowMutations).toBe(0);
});
