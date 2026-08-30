import { expect, test } from "@playwright/test";

test("registry defaults to current and restores canonical filter URL", async ({
  page,
}) => {
  await page.goto("/abilities");
  await expect(
    page.getByRole("heading", { name: "当前技能优先，全部定义可审计。" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "闪烁" })).toBeVisible();
  await expect(page.getByText("fixture_unbound", { exact: true })).toHaveCount(
    0,
  );

  await page.getByLabel("状态").selectOption("defined_unbound");
  await page.getByLabel("语言").selectOption("en");
  await page
    .getByPlaceholder("名称或 internal name…")
    .fill(" fixture_unbound ");
  await page.getByRole("button", { name: "应用" }).click();
  await expect(page).toHaveURL(
    "/abilities?q=fixture_unbound&status=defined_unbound&lang=en",
  );
  await expect(
    page.getByRole("heading", { name: "fixture_unbound" }),
  ).toBeVisible();
});

test("ability detail exposes values, modifiers, relations and provenance", async ({
  page,
}) => {
  await page.goto("/abilities/antimage_blink?lang=en");
  await expect(
    page.getByRole("heading", { name: "Blink", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "AbilityValues" }),
  ).toBeVisible();
  await expect(page.getByRole("row", { name: /blink_range/u })).toContainText(
    "750 · 900 · 1050 · 1200",
  );
  await expect(page.getByRole("row", { name: /blink_range/u })).toContainText(
    "special_bonus_unique_antimage_fixture",
  );
  await expect(
    page.getByRole("heading", { name: "Heroes & relations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Anti-Mage.*loadout/u }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provenance" })).toBeVisible();
  await expect(page.getByText("991daaf6fc24", { exact: false })).toBeVisible();
});

test("missing abilities are exact 404s and local asset fallback remains accessible", async ({
  page,
}) => {
  await page.goto("/abilities/not_a_real_ability");
  await expect(
    page.getByRole("heading", { name: "没有这个 Ability internal name" }),
  ).toBeVisible();

  await page.goto("/abilities/antimage_blink");
  await expect(
    page.getByRole("img", { name: "闪烁 icon unavailable" }),
  ).toBeVisible();
});
