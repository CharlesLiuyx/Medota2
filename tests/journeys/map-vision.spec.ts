import { expect, test } from "../e2e/test-fixture";

test("map: vision sources, explanations, locale and dataset isolation", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/releases");
  expect(response.ok()).toBe(true);
  const index = await response.json();
  const versions = index.releases.filter(
    (release: { mapId: string | null }) => release.mapId,
  );
  test.skip(
    !versions.length,
    "This fixture has no map Dataset; synthetic vision flows run in unit tests.",
  );
  const native =
    versions.find((release: { patch: string }) => release.patch === "7.41f") ??
    versions[0];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  await page.goto(`/map?lang=en&release=${encodeURIComponent(native.id)}`);
  await page.getByRole("button", { name: "Vision", exact: true }).click();
  const panel = page.getByRole("region", {
    name: "Vision simulation",
    exact: true,
  });
  const canvas = page.locator("canvas").first();
  const initialRect = (await canvas.boundingBox())!;
  await page.mouse.move(
    initialRect.x + initialRect.width / 2 + 40,
    initialRect.y + initialRect.height / 2,
  );
  await expect(panel).toHaveAttribute("data-vision-preview", /^cursor:/);
  await expect(panel.getByRole("spinbutton")).toHaveCount(0);
  await canvas.click();
  await expect(panel.locator("[data-vision-status]")).toHaveAttribute(
    "data-vision-status",
    "done",
  );
  expect(workers.some((url) => url.includes("vision"))).toBe(true);
  await expect(
    panel.getByRole("spinbutton", { name: "Source 1 day radius" }),
  ).toHaveValue("1600");
  await canvas.press("Escape");
  await expect(
    panel.getByRole("button", { name: "Select mode" }),
  ).toHaveAttribute("aria-pressed", "true");

  const rect = (await canvas.boundingBox())!;
  const original = await panel
    .getByRole("button", { name: /^Source 1 ·/ })
    .textContent();
  const backgrounds = await canvas.getAttribute("data-background-builds");
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width / 2 + 60,
    rect.y + rect.height / 2 - 30,
    { steps: 24 },
  );
  await expect(panel.locator("[data-vision-status]")).toHaveAttribute(
    "data-vision-status",
    "done",
  );
  await expect(panel).toHaveAttribute("data-vision-preview", /^source-1:/);
  await expect(panel.getByRole("button", { name: /^Source 1 ·/ })).toHaveText(
    original!,
  );
  await expect(canvas).toHaveAttribute("data-background-builds", backgrounds!);
  await page.mouse.up();
  await expect(panel.locator("[data-vision-status]")).toHaveAttribute(
    "data-vision-status",
    "done",
  );
  await expect(
    panel.getByRole("button", { name: /^Source 1 ·/ }),
  ).not.toHaveText(original!);
  // Return to the center using the keyboard-accessible move action for the query below.
  await panel.getByRole("button", { name: "Move source", exact: true }).click();
  await canvas.click();
  await expect(panel.locator("[data-vision-status]")).toHaveAttribute(
    "data-vision-status",
    "done",
  );
  await panel.getByRole("button", { name: "Inspect location" }).click();
  await canvas.click();
  await expect(panel.getByLabel("Location visibility reason")).toContainText(
    /Visible|unknown/,
  );
  await canvas.press("Escape");
  await panel
    .getByRole("spinbutton", { name: "Source 1 day radius" })
    .fill("32768");
  await expect(panel.locator("[data-vision-status]")).toHaveAttribute(
    "data-vision-status",
    "running",
  );
  await panel
    .getByRole("button", { name: "Cancel vision calculation" })
    .click();
  await expect(panel.locator("[data-vision-status]")).toHaveAttribute(
    "data-vision-status",
    "cancelled",
  );
  await panel
    .getByRole("spinbutton", { name: "Source 1 day radius" })
    .fill("1800");
  await expect(panel.locator("[data-vision-status]")).toHaveAttribute(
    "data-vision-status",
    "done",
  );
  await page
    .getByRole("textbox", { name: "Search map points", exact: true })
    .fill("tree");
  await page
    .getByRole("list", { name: "Map points", exact: true })
    .getByRole("button")
    .first()
    .click();
  await panel
    .getByRole("button", { name: "Cut / restore tree", exact: true })
    .click();
  await canvas.click();
  await expect(panel).toContainText("1 trees removed");
  await panel.getByRole("button", { name: "Restore all trees" }).click();
  await expect(panel).toContainText("0 trees removed");
  await panel
    .getByRole("button", { name: "Cut / restore tree", exact: true })
    .click();
  await panel.getByRole("button", { name: "Add selected object" }).click();
  await expect(
    panel.getByRole("spinbutton", { name: "Source 2 day radius" }),
  ).toHaveValue("1800");
  await panel.getByRole("button", { name: "Night", exact: true }).click();
  await expect(panel.locator("[data-vision-status]")).toHaveAttribute(
    "data-vision-status",
    "done",
  );
  await panel.getByRole("button", { name: "Dire vision", exact: true }).click();
  await expect(panel.getByRole("spinbutton")).toHaveCount(0);
  await panel.getByRole("button", { name: "Add selected object" }).click();
  await expect(
    panel.getByRole("spinbutton", { name: "Source 3 day radius" }),
  ).toHaveValue("1800");
  await panel.getByRole("button", { name: "Both teams", exact: true }).click();
  await expect(panel.getByRole("spinbutton")).toHaveCount(6);
  await panel
    .getByRole("button", { name: "Radiant vision", exact: true })
    .click();
  await expect(panel.getByRole("spinbutton")).toHaveCount(4);
  const modelInfo = panel.getByRole("button", {
    name: "Vision simulation help",
  });
  await modelInfo.hover();
  await expect(page.getByRole("tooltip")).toContainText(/FoW/);
  await panel.getByRole("button", { name: "Night", exact: true }).hover();
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "简体中文", exact: true }).click();
  const chinese = page.getByRole("region", { name: "视野模拟", exact: true });
  await expect(
    chinese.getByRole("spinbutton", { name: "来源 1 白天半径" }),
  ).toHaveValue("1800");
  await expect(chinese.locator("[data-vision-status]")).toHaveAttribute(
    "data-vision-status",
    "done",
  );
  // Start a compact ward/hero scenario after the prior workflow.
  await chinese.getByRole("button", { name: "双方视野", exact: true }).click();
  for (let n = 0; n < 3; n++)
    await chinese
      .getByRole("button", { name: "移除来源", exact: true })
      .first()
      .click();
  await chinese.getByRole("button", { name: "天辉视野", exact: true }).click();
  await chinese.getByRole("button", { name: "侦查守卫", exact: true }).click();
  await canvas.press("0");
  await canvas.click();
  await expect(chinese.getByRole("spinbutton").first()).toHaveValue("1600");
  const observerImage = chinese.locator("ol img").first();
  await expect(observerImage).toBeVisible();
  await expect
    .poll(() =>
      observerImage.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await chinese.getByRole("button", { name: "夜魇视野", exact: true }).click();
  await chinese.getByRole("button", { name: "岗哨守卫", exact: true }).click();
  const wardRect = (await canvas.boundingBox())!;
  await canvas.click({
    position: { x: wardRect.width / 2 + 12, y: wardRect.height / 2 },
  });
  await expect(chinese.locator('[data-detected="true"]')).toHaveCount(1);
  await expect(chinese).toContainText("反隐范围：1,050；不提供视野");
  await chinese.getByRole("button", { name: "英雄", exact: true }).click();
  await expect(chinese.getByRole("button", { name: "选择英雄" })).toContainText(
    "斧王",
  );
  await chinese.getByRole("button", { name: "选择英雄" }).click();
  await chinese
    .getByRole("textbox", { name: "搜索英雄" })
    .fill("Night Stalker");
  await chinese.getByRole("option", { name: "暗夜魔王", exact: true }).click();
  await canvas.click({
    position: { x: wardRect.width / 2 - 70, y: wardRect.height / 2 },
  });
  await expect(chinese.locator("ol > li").last()).toContainText("暗夜魔王");
  const heroImage = chinese.locator("ol > li").last().locator("img");
  await expect(heroImage).toBeVisible();
  await expect(heroImage).toHaveAttribute(
    "src",
    /\/map\/hero-icons\/npc_dota_hero_night_stalker/,
  );
  await expect
    .poll(() =>
      heroImage.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await canvas.press("Escape");
  await expect(
    chinese.getByRole("button", { name: "选中模式" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await chinese.scrollIntoViewIfNeeded();
  await expect(
    chinese.getByRole("button", { name: "砍树／恢复" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const other = versions.find(
    (release: { mapId: string }) => release.mapId !== native.mapId,
  );
  if (other) {
    // Use the global version selector: this exercises the page key and client disposal.
    await page.getByRole("combobox", { name: "全局版本", exact: true }).click();
    await page.getByRole("option", { name: new RegExp(other.patch) }).click();
    await expect(
      page.getByRole("button", { name: "视野", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "视野", exact: true }).click();
    await expect(chinese.getByRole("spinbutton")).toHaveCount(0);
    await expect(chinese).toContainText("已移除 0 棵树");
    if (other.patch === "7.41e")
      await expect(chinese).toContainText("此版本缺少高度");
  }
  expect(errors).toEqual([]);
});
