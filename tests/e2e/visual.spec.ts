import { expect, test } from "@playwright/test";

test("heroes catalog visual baseline", async ({ page }) => {
  await page.goto("/heroes");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Anti-Mage portrait unavailable" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("heroes-catalog.png", {
    fullPage: true,
    animations: "disabled",
  });
});

test("ability detail visual baseline", async ({ page }) => {
  await page.goto("/abilities/antimage_blink?lang=en");
  await expect(
    page.getByRole("heading", { name: "Blink", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Blink icon unavailable" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("ability-detail.png", {
    fullPage: true,
    animations: "disabled",
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
