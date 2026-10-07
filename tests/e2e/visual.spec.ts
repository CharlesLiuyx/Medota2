import type { Page } from "@playwright/test";
import { expect, test } from "./test-fixture";

test.beforeEach(async ({ page }, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === "mobile-chromium"
      ? { width: 412, height: 839 }
      : { width: 1280, height: 720 },
  );
});

test("heroes catalog visual baseline", async ({ page }) => {
  await page.goto("/heroes");
  await expect(page.getByRole("main")).toBeVisible();
  // The local replica takes over asynchronously; capture the completed catalog,
  // not a transient first 48-card frame during source replacement.
  await expect(
    page.getByText("已显示全部英雄。", { exact: true }).last(),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Anti-Mage 图标", exact: true }),
  ).toBeVisible();
  await waitForImages(page);
  await expect(page).toHaveScreenshot("heroes-catalog.png", {
    fullPage: false,
    animations: "disabled",
    caret: "initial",
    mask: [page.locator("[data-catalog-updated-at]")],
    maskColor: "#2b2106",
  });
});

test("ability detail visual baseline", async ({ page }) => {
  await page.goto("/abilities/antimage_blink?lang=en");
  await expect(
    page.getByRole("combobox", { name: "Game version" }),
  ).toContainText("Unknown patch");
  await expect(
    page.getByRole("heading", { name: "Blink", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Blink icon", exact: true }),
  ).toBeVisible();
  await waitForImages(page);
  await expect(page).toHaveScreenshot("ability-detail.png", {
    fullPage: false,
    animations: "disabled",
    caret: "initial",
    mask: [page.locator("[data-catalog-updated-at]")],
    maskColor: "#2b2106",
  });
});

test("landmarks and heading structure remain semantic", async ({ page }) => {
  await page.goto("/abilities");
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: "图鉴分类" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  const environmentStrip = page.getByRole("status", {
    name: "运行环境",
  });
  await expect(environmentStrip).toBeVisible();
  await expect(environmentStrip).toContainText("测试预览");
  await expect(environmentStrip).toContainText("测试样例数据");
  await expect(environmentStrip).toHaveAttribute(
    "data-verification",
    "verified",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-environment",
    "test",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-data-class",
    "synthetic-fixture",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-environment-verification",
    "verified",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-environment-run",
    /\S+/u,
  );
  await expect(page).toHaveTitle(/^\[测试预览\]/u);
});

async function waitForImages(page: Page): Promise<void> {
  await page.locator("img").evaluateAll(async (images) => {
    await Promise.all(
      images.map(async (image) => {
        if (!(image instanceof HTMLImageElement)) return;
        const rect = image.getBoundingClientRect();
        const visible =
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth;
        if (visible) await image.decode();
      }),
    );
  });
}
