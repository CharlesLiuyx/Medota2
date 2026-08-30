import { expect, test, type Page } from "@playwright/test";

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
  await expect(
    page.getByRole("img", { name: "Anti-Mage icon", exact: true }),
  ).toBeVisible();
  await waitForImages(page);
  await expect(page).toHaveScreenshot("heroes-catalog.png", {
    fullPage: false,
    animations: "disabled",
    caret: "initial",
  });
});

test("ability detail visual baseline", async ({ page }) => {
  await page.goto("/abilities/antimage_blink?lang=en");
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
  });
});

test("landmarks and heading structure remain semantic", async ({ page }) => {
  await page.goto("/abilities");
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: "Catalog entities" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
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
