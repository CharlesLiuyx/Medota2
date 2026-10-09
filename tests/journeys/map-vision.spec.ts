import { expect, test } from "../e2e/test-fixture";

test("map: vision sources, explanations, locale and dataset isolation", async ({
  page,
  request,
}, testInfo) => {
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
  if (native.patch === "7.41f")
    await expect(canvas).toHaveAttribute("data-no-ward", "visible");
  // Exercise the placement UI to find a valid nearby cell in the selected dataset.
  const legalPoint = async (dx = 40, dy = 0) => {
    const bounds = (await canvas.boundingBox())!;
    for (const [ox, oy] of [
      [0, 0],
      [16, 0],
      [-16, 0],
      [0, 16],
      [0, -16],
      [32, 0],
      [-32, 0],
      [0, 32],
      [0, -32],
      [32, 32],
      [-32, -32],
    ]) {
      const point = {
        x: bounds.x + bounds.width / 2 + dx + ox,
        y: bounds.y + bounds.height / 2 + dy + oy,
      };
      await page.mouse.move(point.x, point.y);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() =>
              setTimeout(() => requestAnimationFrame(() => resolve()), 0),
            ),
          ),
      );
      const region = page.locator("[data-placement-error]");
      if (
        (await region.getAttribute("data-placement-error")) === "" &&
        (await region.getAttribute("data-vision-preview"))
      )
        return point;
    }
    throw new Error("No legal placement cell near the intended test point");
  };
  const sourcePoint = await legalPoint();
  await expect(panel).toHaveAttribute("data-vision-preview", /^cursor:/);
  await expect(panel.getByRole("spinbutton")).toHaveCount(0);
  await page.mouse.click(sourcePoint.x, sourcePoint.y);
  await expect(panel.locator("[data-vision-status]")).toHaveAttribute(
    "data-vision-status",
    "done",
  );
  await expect(
    panel.getByRole("spinbutton", { name: "Source 1 day radius" }),
  ).toHaveValue("1600");
  await canvas.press("Escape");
  await expect(
    panel.getByRole("button", { name: "Select mode" }),
  ).toHaveAttribute("aria-pressed", "true");

  await canvas.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-no-ward", "hidden");
  await expect(
    page.getByRole("button", { name: "Vision", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Vision", exact: true }).click();
  await canvas.press("Escape");
  const sourceCard = panel.getByRole("button", { name: /^Source 1 ·/ });
  await sourceCard.hover();
  await expect(page.getByRole("tooltip")).toContainText("Ground Z:");
  await page.mouse.move(10, 10);
  await page.screenshot({
    path: testInfo.outputPath("map-tools-compact-source.png"),
  });
  const rect = (await canvas.boundingBox())!;
  const original = await panel
    .getByRole("button", { name: /^Source 1 ·/ })
    .textContent();
  const backgrounds = await canvas.getAttribute("data-background-builds");
  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await expect(canvas).toHaveAttribute(
    "data-hovered-vision-source",
    "source-1",
  );
  await expect(canvas).toHaveAttribute("data-background-builds", backgrounds!);
  await page.mouse.move(rect.x + 20, rect.y + rect.height - 20);
  await expect(canvas).toHaveAttribute("data-hovered-vision-source", "");
  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down();
  await legalPoint(100, -30);
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
  // Return to the same legal cell using the keyboard-accessible move action.
  await panel.getByRole("button", { name: "Move source", exact: true }).click();
  await page.mouse.click(sourcePoint.x, sourcePoint.y);
  await expect(panel.locator("[data-vision-status]")).toHaveAttribute(
    "data-vision-status",
    "done",
  );
  await panel.getByRole("button", { name: "Inspect location" }).click();
  await page.mouse.click(sourcePoint.x, sourcePoint.y);
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
  expect(workers.some((url) => url.includes("vision"))).toBe(true);
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
  await expect(panel).not.toContainText("trees removed");
  await expect(
    panel.getByRole("button", { name: "Restore all trees" }),
  ).toBeDisabled();
  await panel
    .getByRole("button", { name: "Cut / restore tree", exact: true })
    .click();
  await panel.getByRole("button", { name: "Add selected object" }).click();
  await expect(
    panel.getByRole("spinbutton", { name: "Source 2 day radius" }),
  ).toHaveValue("1800");
  await panel.getByRole("button", { name: /^Source 1 ·/ }).click();
  await panel
    .getByRole("button", { name: /^Source 2 ·/ })
    .click({ modifiers: ["Shift"] });
  await expect(panel.locator('li[data-selected="true"]')).toHaveCount(2);
  await panel
    .getByRole("button", { name: /^Source 1 ·/ })
    .click({ modifiers: ["Shift"] });
  await expect(panel.locator('li[data-selected="true"]')).toHaveCount(1);
  await canvas.click({ position: { x: 8, y: 8 } });
  await expect(panel.locator('li[data-selected="true"]')).toHaveCount(0);
  // Empty-map selection also cleared the static tree used by the next add-object step.
  await page
    .getByRole("list", { name: "Map points", exact: true })
    .getByRole("button")
    .first()
    .click();
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
  const explanation = page.getByRole("tooltip");
  await expect(explanation).toContainText("High ground and Sentry markers");
  await explanation.getByText("Model and limitations", { exact: true }).click();
  await expect(explanation).toContainText(/fog-of-war/);
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
  await chinese.getByRole("button", { name: "选中模式", exact: true }).click();
  await canvas.press("1");
  await expect(
    chinese.getByRole("button", { name: "侦查守卫", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await canvas.press("1");
  await expect(
    chinese.getByRole("button", { name: "侦查守卫", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    chinese.getByRole("button", { name: "选中模式", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await canvas.click();
  await expect(chinese.getByRole("spinbutton")).toHaveCount(0);
  await canvas.press("1");
  await canvas.press("0");
  const wardPoint = await legalPoint();
  await page.mouse.click(wardPoint.x, wardPoint.y);
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
  await page.mouse.click(wardPoint.x, wardPoint.y);
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
  const heroPoint = await legalPoint(-70);
  await page.mouse.click(heroPoint.x, heroPoint.y);
  await expect(chinese.locator("ol > li").last()).toContainText("暗夜魔王");
  const heroImage = chinese.locator("ol > li").last().locator("img");
  await expect(heroImage).toBeVisible();
  await expect(heroImage).toHaveAttribute(
    "src",
    /\/map\/icons\/minimap_heroicon_npc_dota_hero_night_stalker/,
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
  const hoverBackgrounds = await canvas.getAttribute("data-background-builds");
  await page.mouse.move(heroPoint.x, heroPoint.y);
  const heroTip = page.getByRole("tooltip", { name: "英雄视野信息" });
  await expect(heroTip).toContainText("暗夜魔王");
  await expect(heroTip).toContainText("白天视野800");
  await expect(heroTip).toContainText("夜晚视野1,800");
  await expect(heroTip).toContainText("初始移速295");
  await expect(canvas).toHaveAttribute(
    "data-background-builds",
    hoverBackgrounds!,
  );
  expect(await canvas.evaluate((el) => getComputedStyle(el).cursor)).toBe(
    "default",
  );
  await page.mouse.move(wardRect.x + 15, wardRect.y + 150);
  await expect(heroTip).toHaveCount(0);
  const heroPosition = await chinese
    .getByRole("button", { name: /^来源 3 ·/ })
    .getAttribute("aria-label");
  await chinese.getByRole("button", { name: "选择英雄" }).click();
  await chinese.getByRole("textbox", { name: "搜索英雄" }).fill("Slark");
  await chinese.getByRole("option", { name: "斯拉克", exact: true }).click();
  await expect(chinese.locator("ol > li").last()).toContainText("斯拉克");
  await expect(heroImage).toHaveAttribute(
    "src",
    /\/map\/icons\/minimap_heroicon_npc_dota_hero_slark/,
  );
  await expect(
    chinese.getByRole("spinbutton", { name: "来源 3 白天半径" }),
  ).toHaveValue("1800");
  await expect(
    chinese.getByRole("spinbutton", { name: "来源 3 夜晚半径" }),
  ).toHaveValue("1800");
  await expect(
    chinese.getByRole("button", { name: /^来源 3 ·/ }),
  ).toHaveAttribute("aria-label", heroPosition!);
  await expect(chinese.locator("ol > li")).toHaveCount(3);
  await expect(
    chinese.getByRole("button", { name: "选中模式" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(heroPoint.x, heroPoint.y);
  await expect(heroTip).toContainText("斯拉克");
  await expect(heroTip).toContainText("白天视野1,800");
  await expect(heroTip).toContainText("夜晚视野1,800");
  await expect(heroTip).toContainText("初始移速300");
  await page.mouse.move(wardRect.x + 15, wardRect.y + 150);
  await expect(heroTip).toHaveCount(0);
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
    await expect(chinese).not.toContainText("已移除");
    await expect(
      chinese.getByRole("button", { name: "恢复全部树木" }),
    ).toBeDisabled();
    if (other.patch === "7.41e")
      await expect(chinese).toContainText("此版本缺少高度");
  }
  expect(errors).toEqual([]);
});
