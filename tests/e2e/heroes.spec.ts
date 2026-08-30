import { expect, test } from "@playwright/test";

test("overview, canonical search URL and CM filter", async ({ page }) => {
  await page.goto("/heroes");
  await expect(
    page.getByRole("heading", { name: "游戏内定义，原样可追溯。" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "敌法师" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Anti-Mage icon", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "测试守卫" })).toBeVisible();
  await expect(
    page.getByText("最近一次 VPK 导入失败", { exact: false }),
  ).toBeVisible();

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
