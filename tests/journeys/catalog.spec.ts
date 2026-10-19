import type { ReleaseIndex } from "@/domain/releases";
import { expect, test } from "../e2e/test-fixture";

// Read-only journeys work against the user's current data. Fixed numerical
// fixture checks are added by CI / --fixture without resetting development data.
for (const entity of ["heroes", "abilities"] as const) {
  test(`${entity}: query, filter and open a detail`, async ({
    page,
    request,
  }) => {
    const response = await request.get(`/api/catalog/${entity}`);
    expect(response.ok()).toBe(true);
    expect(response.headers()["x-medota2-environment-verification"]).toBe(
      "verified",
    );
    const data = await response.json();
    if (process.env.MEDOTA2_EXPECTED_DATA_VERSION) {
      expect(`${data.datasetVersionId}:${data.assetDatasetVersionId}`).toBe(
        process.env.MEDOTA2_EXPECTED_DATA_VERSION,
      );
    }
    const releases = await request.get("/api/releases");
    expect(releases.ok()).toBe(true);
    const index = (await releases.json()) as ReleaseIndex;
    const selected = index.releases.find((r) => r.id === index.defaultRelease);
    expect(selected).toBeTruthy();
    // Full-list scrolling has its own journey; navigation uses a known entity
    // on both the fixture and the current Catalog.
    await page.goto(`/${entity}?q=antimage`);
    await expect(
      page.getByRole("button", { name: "网格视图", exact: true }),
    ).toBeEnabled();
    const link = page.locator(`a[href^="/${entity}/"]`).first();
    await expect(link).toBeVisible();
    const icon = link.locator("img").first();
    await expect(icon).toBeVisible();
    await expect
      .poll(() =>
        icon.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const iconUrl = await icon.evaluate(
      (image: HTMLImageElement) => image.currentSrc,
    );
    const asset = await request.get(iconUrl);
    expect(asset.ok()).toBe(true);
    expect(asset.headers()["content-type"]).toMatch(/^image\//);
    if (process.env.MEDOTA2_SHARED_WEB === "1") {
      const workbench = await request
        .get("/api/development")
        .then((response) => response.json());
      if (workbench.dataSource === "local-review") {
        expect(asset.headers()["x-medota2-asset-source"]).toMatch(
          /^(exact|alias)$/,
        );
        expect(asset.headers()["x-medota2-asset-path"]).not.toMatch(
          /^generated\//,
        );
      }
    }
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/${entity}/[^?]+`));
    await expect(page.locator("h1")).toBeVisible();
    await page.goto(`/${entity}?q=antimage`);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(`a[href^="/${entity}/"]`).first()).toBeVisible();
  });
}

test("heroes: fixed fixture has the known movement speed", async ({
  request,
  page,
}) => {
  test.skip(
    process.env.MEDOTA2_SHARED_WEB === "1",
    "Known values use the reusable fixture database.",
  );
  const response = await request.get("/api/catalog/heroes?q=antimage");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.items).toHaveLength(1);
  expect(body.items[0].internalName).toBe("npc_dota_hero_antimage");
  expect(Number(body.items[0].movementSpeed)).toBe(310);
  // Detail includes the stored scalar, so this covers parse → persistence → render.
  await page.goto("/heroes/antimage");
  const speed = page.locator('[data-hero-stat="movementSpeed"]');
  await expect(speed).toHaveText("310");
});

test("heroes: adjustable levels, overview layout and introduction tooltip", async ({
  page,
}) => {
  await page.goto("/heroes/antimage");
  const heroLevel = page.getByRole("slider", {
    name: "英雄等级",
    exact: true,
  });
  await expect(heroLevel).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "英雄详情" })
      .getByRole("link", { name: "属性", exact: true }),
  ).toHaveCount(0);
  const strength = page.locator('[data-hero-attribute="strength"]');
  const initialStrength = await strength.innerText();
  const health = page.locator('[data-hero-stat="health"]');
  const mana = page.locator('[data-hero-stat="mana"]');
  const damage = page.locator('[data-hero-stat="damageMin"]');
  const healthBar = page.locator('[data-hero-stat-fill="health"]');
  const initialHealth = await health.innerText();
  const initialMana = await mana.innerText();
  const initialDamage = await damage.innerText();
  // Synthetic fixtures do not claim a reviewed real-game source commit.
  if (process.env.MEDOTA2_SHARED_WEB === "1")
    await expect(health).not.toHaveText("—");
  const calculated = initialHealth !== "—";
  const initialBar = calculated ? await healthBar.getAttribute("style") : null;

  await heroLevel.focus();
  await heroLevel.press("End");
  await expect(heroLevel).toHaveValue("30");
  await expect(strength).not.toHaveText(initialStrength);
  if (calculated) {
    await expect(health).not.toHaveText(initialHealth);
    await expect(mana).not.toHaveText(initialMana);
    await expect(damage).not.toHaveText(initialDamage);
    const regeneration = page.locator('[data-hero-stat-regen="health"]');
    await expect(regeneration).toBeVisible();
    // CSS serializes percentages to fewer digits than the pure model. Check
    // rendered edges within two 1/64px layout units, after the transition.
    await expect
      .poll(() =>
        regeneration.evaluate((element) => {
          const segment = element.getBoundingClientRect();
          const meter = element.parentElement!.getBoundingClientRect();
          return Math.abs(segment.right - meter.right);
        }),
      )
      .toBeLessThanOrEqual(1 / 32);
    expect(
      await regeneration.evaluate(
        (element) => element.getBoundingClientRect().width,
      ),
    ).toBeGreaterThan(0);
    expect(await healthBar.getAttribute("style")).not.toBe(initialBar);
  }

  const intro = page.getByRole("button", { name: "英雄介绍", exact: true });
  await intro.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const blink = page.locator("#skill-antimage_blink");
  await expect(blink).toContainText("最高等级 4");
  const cooldown = blink.getByRole("link", { name: /^冷却 / });
  const manaCost = blink.getByRole("link", { name: /^魔法消耗 / });
  await expect(cooldown.locator("svg")).toHaveCount(1);
  await expect(cooldown.locator("svg.lucide-clock")).toBeVisible();
  await expect(manaCost.locator("svg")).toHaveCount(1);
  await expect(manaCost.locator("svg.lucide-droplet")).toBeVisible();
  for (const cost of [cooldown, manaCost]) {
    expect(
      await cost.evaluate((element) => {
        const icon = element.querySelector("svg")!.getBoundingClientRect();
        const text = element.lastElementChild!.getBoundingClientRect();
        return Math.abs(icon.y + icon.height / 2 - text.y - text.height / 2);
      }),
    ).toBeLessThanOrEqual(1);
  }
  const initialCooldown = await cooldown.innerText();
  await blink.getByRole("radio", { name: "4", exact: true }).check();
  await blink.getByRole("radio", { name: "4", exact: true }).press("ArrowLeft");
  await expect(
    blink.getByRole("radio", { name: "3", exact: true }),
  ).toBeChecked();
  await blink
    .getByRole("radio", { name: "3", exact: true })
    .press("ArrowRight");
  await expect(
    blink.getByRole("radio", { name: "4", exact: true }),
  ).toBeChecked();
  await expect(cooldown).toHaveText(initialCooldown);
  await expect(cooldown.locator('[data-selected="true"]')).toHaveCount(1);
  if (process.env.MEDOTA2_SHARED_WEB !== "1")
    await expect(cooldown).toContainText("6 秒");
  await page.setViewportSize({ width: 1280, height: 900 });
  const headerBox = await page.locator(".hero-stage").boundingBox();
  const statsBox = await page.locator("#stats").boundingBox();
  const talentsBox = await page.locator("#talents").boundingBox();
  const inventoryBox = await page.locator("#inventory").boundingBox();
  expect(talentsBox!.x).toBeGreaterThanOrEqual(headerBox!.x);
  expect(talentsBox!.y).toBeGreaterThan(headerBox!.y);
  expect(talentsBox!.y + talentsBox!.height).toBeLessThanOrEqual(
    headerBox!.y + headerBox!.height,
  );
  expect(inventoryBox!.x).toBeGreaterThan(headerBox!.x + headerBox!.width);
  expect(statsBox!.x).toBeGreaterThan(inventoryBox!.x + inventoryBox!.width);
  await expect(page.locator('#talents a[href^="/abilities/"]')).toHaveCount(8);
  await expect(
    page
      .getByRole("navigation", { name: "英雄详情" })
      .getByRole("link", { name: "天赋树", exact: true }),
  ).toHaveCount(0);
  await heroLevel.press("Home");
  await expect(heroLevel).toHaveValue("1");
  await expect(strength).toHaveText(initialStrength);
  await expect(health).toHaveText(initialHealth);
  await expect(mana).toHaveText(initialMana);
  await expect(damage).toHaveText(initialDamage);
  await heroLevel.press("ArrowRight");
  await expect(heroLevel).toHaveValue("2");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const mobileHeader = await page.locator(".hero-stage").boundingBox();
  const mobileStats = await page.locator("#stats").boundingBox();
  const mobileTalents = await page.locator("#talents").boundingBox();
  const mobileInventory = await page.locator("#inventory").boundingBox();
  expect(mobileTalents!.y).toBeGreaterThan(mobileHeader!.y);
  expect(mobileTalents!.y + mobileTalents!.height).toBeLessThanOrEqual(
    mobileHeader!.y + mobileHeader!.height,
  );
  expect(mobileInventory!.y).toBeGreaterThan(
    mobileHeader!.y + mobileHeader!.height,
  );
  expect(mobileStats!.y).toBeGreaterThan(
    mobileInventory!.y + mobileInventory!.height,
  );
});

test("heroes: real talent selection raises level and changes the correct stats", async ({
  page,
}) => {
  test.skip(
    process.env.MEDOTA2_SHARED_WEB !== "1",
    "Axe's reviewed talent values use the pinned real Catalog.",
  );
  await page.goto("/heroes/axe");
  const level = page.getByRole("slider", { name: "英雄等级", exact: true });
  const strength = page.getByRole("button", { name: "+15 力量", exact: true });
  const helix = page.getByRole("button", {
    name: "+40 反击螺旋伤害",
    exact: true,
  });
  const health = page.locator('[data-hero-stat="health"]');
  const damage = page.locator('[data-hero-stat="damageMin"]');
  const highTier = page.getByRole("button", {
    name: "+85 狂战士之吼范围",
    exact: true,
  });
  // Semantic links are independent of the talent's selection surface.
  const hunger = page
    .locator("#talents")
    .getByRole("link", { name: "战斗饥渴", exact: true })
    .first();
  await hunger.hover();
  await expect(page.getByRole("tooltip")).toContainText("激怒一个敌方单位");
  await expect(page.locator("#skill-axe_battle_hunger")).toHaveCount(1);
  await hunger.click();
  await expect(page).toHaveURL(/#skill-axe_battle_hunger$/);
  await expect(level).toHaveValue("1");
  await expect(highTier).toHaveAttribute("aria-pressed", "false");
  const target = await page.locator("#skill-axe_battle_hunger").boundingBox();
  expect(target!.y).toBeGreaterThanOrEqual(0);
  expect(target!.y).toBeLessThan(150);
  await page.keyboard.press("Escape");
  const strengthReference = page
    .locator("#talents")
    .getByRole("link", { name: "力量", exact: true });
  await strengthReference.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "影响生命上限和生命恢复",
  );
  await page.keyboard.press("Escape");
  const facet = page.locator("#facets");
  await facet.getByRole("link", { name: "护甲", exact: true }).first().hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "负护甲会增加所受物理伤害",
  );
  await page.keyboard.press("Escape");
  const facetAbility = facet
    .getByRole("link", { name: "狂战士之吼", exact: true })
    .first();
  await facetAbility.focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "斧王嘲讽附近的敌方单位",
  );
  await facetAbility.press("Enter");
  await expect(page).toHaveURL(/#skill-axe_berserkers_call$/);
  await page.keyboard.press("Escape");
  await highTier.click({ position: { x: 3, y: 3 } });
  await expect(level).toHaveValue("25");
  await expect(highTier).toHaveAttribute("aria-pressed", "true");
  await highTier.click({ position: { x: 3, y: 3 } });
  await expect(highTier).toHaveAttribute("aria-pressed", "false");
  await level.press("Home");
  await strength.click({ position: { x: 3, y: 3 } });
  await expect(level).toHaveValue("20");
  await expect(health).toHaveText("2128.6");
  await expect(damage).toHaveText("122.3 – 126.3");
  await helix.click({ position: { x: 3, y: 3 } });
  await expect(strength).toHaveAttribute("aria-pressed", "false");
  await expect(health).toHaveText("1798.6");
  await expect(damage).toHaveText("107.3 – 111.3");
  await expect(page.locator("#talents")).toContainText(
    "技能修正见对应技能卡；条件缺项会标明，未计入基础面板",
  );
  await level.press("End");
  await strength.click({ position: { x: 3, y: 3 } });
  await expect(helix).toHaveAttribute("aria-pressed", "true");
  await expect(strength).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "清除选择", exact: true }).click();
  await expect(strength).toHaveAttribute("aria-pressed", "false");
  await expect(helix).toHaveAttribute("aria-pressed", "false");
  await strength.press("Enter");
  await expect(strength).toHaveAttribute("aria-pressed", "true");
  await level.press("Home");
  await expect(strength).toHaveAttribute("aria-pressed", "false");
  await expect(health).toHaveText("670");
  await expect(damage).toHaveText("56 – 60");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("heroes: talent modifiers follow skill level and revert on deselection", async ({
  page,
}) => {
  test.skip(
    process.env.MEDOTA2_SHARED_WEB !== "1",
    "Uses Axe's pinned real Catalog modifiers.",
  );
  await page.goto("/heroes/axe");
  const card = page.locator("#skill-axe_counter_helix");
  const damage = card.locator('[data-ability-value="damage"] dd');
  const talent = page.getByRole("button", {
    name: "+40 反击螺旋伤害",
    exact: true,
  });
  await expect(damage).toHaveText("100 / 120 / 140 / 160");
  await expect(damage.locator('[data-selected="true"]')).toHaveCount(0);
  const skillLevel = card.getByRole("radio", {
    name: "1",
    exact: true,
  });
  await expect(
    card.getByRole("radiogroup", { name: "当前等级", exact: true }),
  ).toHaveAttribute("data-interactive-ready", "true");
  await skillLevel.check();
  await talent.click({ position: { x: 3, y: 3 } });
  await expect(damage).toHaveText("140 / 160 / 180 / 200");
  await expect(damage.locator('[data-selected="true"]')).toHaveText("140");
  await expect(card.locator("[data-applied-talents]")).toContainText(
    "+40 反击螺旋伤害",
  );
  await card.getByRole("radio", { name: "4", exact: true }).check();
  await expect(damage.locator('[data-selected="true"]')).toHaveText("200");
  await talent.click({ position: { x: 3, y: 3 } });
  await expect(damage.locator('[data-selected="true"]')).toHaveText("160");
  await expect(card.locator("[data-applied-talents]")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await talent.click({ position: { x: 3, y: 3 } });
  await expect(damage.locator('[data-selected="true"]')).toHaveText("200");
  await page
    .getByRole("slider", { name: "英雄等级", exact: true })
    .press("Home");
  await expect(damage).toHaveText("100 / 120 / 140 / 160");
  await expect(damage.locator('[data-selected="true"]')).toHaveText("100");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("heroes and abilities: readable tooltips and mobile layout", async ({
  page,
}) => {
  await page.goto("/heroes/antimage");
  await expect(
    page.getByRole("heading", { name: "天赋树", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "英雄属性", exact: true }),
  ).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(
    /npc_dota_|DOTA_ABILITY_|special_bonus_|\{s:|%[a-z_]+%|SourceRevision|SHA-256/u,
  );
  await page.goto("/abilities/antimage_blink");
  await expect(
    page.getByRole("heading", { name: "闪烁", level: 1 }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText("冷却");
  await expect(page.locator("main")).toContainText("魔法消耗");
  expect(await page.locator("main").innerText()).not.toMatch(
    /antimage_blink|DOTA_|blink_range|BaseClass|Provenance/u,
  );
  if (process.env.MEDOTA2_SHARED_WEB !== "1") {
    await expect(page.locator("main")).toContainText("12 / 10 / 8 / 6");
    await expect(page.locator("main")).toContainText("750 / 900 / 1050 / 1200");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "/heroes",
    "/heroes/antimage",
    "/abilities",
    "/abilities/antimage_blink",
  ]) {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test("viewport: prewarms first-screen images before tab navigation and keeps search interactive", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/heroes");
  await page.waitForFunction(
    () =>
      ["heroes", "abilities", "units", "items"].every((entity) =>
        performance
          .getEntriesByType("mark")
          .some((entry) =>
            entry.name.startsWith(`medota2:viewport:${entity}:`),
          ),
      ),
    undefined,
    { timeout: 60_000 },
  );
  const timings = [];
  for (const [entity, label, search] of [
    ["abilities", "技能", "搜索技能"],
    ["heroes", "英雄", "搜索英雄"],
    ["units", "单位", "搜索单位"],
    ["heroes", "英雄", "搜索英雄"],
    ["items", "物品", "搜索物品"],
    ["heroes", "英雄", "搜索英雄"],
  ]) {
    // Observe the first painted destination frame, not a later image-loaded state.
    await page.evaluate(
      ({ entity, label }) => {
        let started = performance.now();
        document.addEventListener(
          "pointerdown",
          () => {
            started = performance.now();
          },
          { once: true, capture: true },
        );
        (window as unknown as { viewportSample: unknown }).viewportSample =
          null;
        const observe = () => {
          // Inspect destination geometry only. Scanning the old, still-growing
          // catalog every frame forces layout and can delay the navigation itself.
          if (
            location.pathname !== `/${entity}` ||
            !document.querySelector("main h1")?.textContent?.includes(label)
          ) {
            requestAnimationFrame(observe);
            return;
          }
          const images = [
            ...document.querySelectorAll<HTMLImageElement>("main img"),
          ].filter((img) => {
            const rect = img.getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              rect.top < innerHeight &&
              rect.bottom > 28
            );
          });
          if (location.pathname === `/${entity}` && images.length) {
            (window as unknown as { viewportSample: unknown }).viewportSample =
              {
                entity,
                elapsed: performance.now() - started,
                visible: images.length,
                visibleSources: images.map((img) => img.currentSrc || img.src),
                disabledSearch:
                  document.querySelector<HTMLInputElement>(
                    'main input:not([type="hidden"])',
                  )?.disabled ?? true,
                missing: images
                  .filter((img) => !img.complete || !img.naturalWidth)
                  .map((img) => img.currentSrc || img.src),
              };
          } else requestAnimationFrame(observe);
        };
        requestAnimationFrame(observe);
      },
      { entity, label },
    );
    await page
      .getByRole("navigation", { name: "图鉴分类" })
      .getByRole("link", { name: label, exact: true })
      .click();
    await page.waitForFunction(
      () => (window as unknown as { viewportSample: unknown }).viewportSample,
    );
    const sample = await page.evaluate(
      () =>
        (
          window as unknown as {
            viewportSample: {
              missing: string[];
              disabledSearch: boolean;
              visibleSources: string[];
            };
          }
        ).viewportSample,
    );
    timings.push(sample);
    expect(sample.missing).toEqual([]);
    expect(sample.disabledSearch).toBe(false);
    const input = page.getByRole("textbox", { name: search, exact: true });
    await expect(input).toBeEnabled();
    if (entity === "heroes" || entity === "units") {
      await page.waitForTimeout(200);
      const settled = await page.locator("main img").evaluateAll((images) =>
        images
          .filter((img) => {
            const rect = img.getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              rect.top < innerHeight &&
              rect.bottom > 28
            );
          })
          .map(
            (img) =>
              (img as HTMLImageElement).currentSrc ||
              (img as HTMLImageElement).src,
          ),
      );
      expect(
        settled.filter((src) => !sample.visibleSources.includes(src)),
      ).toEqual([]);
      const card = page.locator(`main a[href^="/${entity}/"]`).first();
      await card.focus();
      await expect(page.getByRole("tooltip").first()).toBeVisible();
      await card.press("Escape");
    }
    await input.fill("test");
    await expect(input).toHaveValue("test");
    await input.fill("");
  }
  await testInfo.attach("viewport-tab-timings", {
    body: JSON.stringify(timings, null, 2),
    contentType: "application/json",
  });
});

test("viewport: cached hero return keeps URL, filters, details and history usable without a route request", async ({
  page,
}) => {
  await page.goto("/heroes");
  await expect(page.locator('[data-browser-cache="ready"]')).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "图鉴分类" });
  await tabs.getByRole("link", { name: "技能", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "技能图鉴", exact: true }),
  ).toBeVisible();
  const routeRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/heroes" && request.headers().rsc)
      routeRequests.push(request.url());
  });
  await tabs.getByRole("link", { name: "英雄", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "英雄图鉴", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/英雄/);
  expect(routeRequests).toEqual([]);
  const search = page.getByRole("textbox", { name: "搜索英雄", exact: true });
  await search.fill("antimage");
  await expect(page.locator('main a[href^="/heroes/"]')).toHaveCount(1);
  await expect(page).toHaveURL(/q=antimage/);
  await page.locator('main a[href^="/heroes/antimage?"]').click();
  await expect(page).toHaveURL(/\/heroes\/antimage\?/);
  await page.goBack();
  await expect(search).toHaveValue("antimage");
  await expect(page.locator('main a[href^="/heroes/"]')).toHaveCount(1);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "技能图鉴", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(search).toHaveValue("antimage");
  await tabs.getByRole("link", { name: "单位", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "单位图鉴", exact: true }),
  ).toBeVisible();
  await tabs.getByRole("link", { name: "英雄", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "网格视图", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await search.fill("antimage");
  await tabs.getByRole("link", { name: "英雄", exact: true }).click();
  await expect(search).toHaveValue("");
  await search.fill("antimage");
  await page.getByRole("combobox", { name: "语言", exact: true }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hero Catalog", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Search heroes", exact: true }),
  ).toHaveValue("antimage");
  expect(new URL(page.url()).searchParams.get("lang")).toBe("en");
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Search heroes", exact: true }),
  ).toHaveValue("antimage");
  await expect(page.locator('main a[href^="/heroes/"]')).toHaveCount(1);
});

test("heroes: inventory search, upgrades, consumption and complete reset", async ({
  page,
}) => {
  test.skip(
    process.env.MEDOTA2_SHARED_WEB !== "1",
    "Uses reviewed 7.41f item and hero data.",
  );
  await page.goto("/heroes/axe?lang=zh-CN");
  const health = page.locator('[data-hero-stat="health"]');
  const search = page.getByRole("textbox", { name: "搜索并装备物品" });
  await expect(
    page.getByRole("heading", { name: "物品和状态", exact: true }),
  ).toBeVisible();
  await expect(health).toHaveText("670");
  await expect(search).toHaveCount(0);
  const firstSlot = page.locator(
    '[data-inventory-slot="0"] button[aria-haspopup="dialog"]',
  );
  await firstSlot.click();
  await expect(search).toBeFocused();
  await search.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(firstSlot).toBeFocused();
  await firstSlot.press("Enter");
  const picker = page.locator("[data-inventory-picker-panel]");
  expect((await picker.boundingBox())!.width).toBe(760);
  const columns = await picker
    .locator("[data-equip-item]")
    .evaluateAll(
      (nodes) =>
        new Set(nodes.map((node) => node.getBoundingClientRect().x)).size,
    );
  expect(columns).toBe(4);
  // The wider picker can cover the inventory heading; use an actual outside target.
  await page.getByRole("heading", { name: "斧王", exact: true }).click();
  await expect(search).toHaveCount(0);
  await expect(page.getByText("正在配置第 1 格", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("装备与状态即时生效 · 悬停或点击信息图标查看简介", {
      exact: true,
    }),
  ).toHaveCount(0);
  const slotBoxes = await page
    .locator("[data-inventory-slot]")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y };
      }),
    );
  expect(new Set(slotBoxes.map((box) => box.x)).size).toBe(2);
  expect(new Set(slotBoxes.map((box) => box.y)).size).toBe(3);
  await expect(page.locator("[data-unmodeled-abilities]")).toHaveCount(0);
  await page.getByRole("button", { name: "属性说明", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "部分条件／被动效果未计入",
  );
  await page.keyboard.press("Escape");
  await firstSlot.click();
  await search.fill("A杖");
  await page
    .locator("[data-item-picker]")
    .getByRole("button", { name: "物品简介：阿哈利姆神杖", exact: true })
    .hover();
  await expect(page.getByRole("tooltip")).toContainText("阿哈利姆神杖");
  await page.keyboard.press("Escape");
  await search.fill("A杖");
  await search.press("Enter");
  await expect(health).toHaveText("1065");
  await expect(search).toHaveCount(0);
  await firstSlot.hover();
  await expect(page.getByRole("tooltip")).toContainText("阿哈利姆神杖");
  await expect(page.locator('[data-source-changes="slot:0"]')).toContainText(
    "+395",
  );
  const healthSegment = page.locator(
    '[data-stat-segments="health"] [data-stat-segment="slot:0"]',
  );
  await expect(healthSegment).toHaveAttribute("data-contribution", "395");
  await expect(healthSegment).toHaveAttribute("data-related", "true");
  await page.keyboard.press("Escape");
  await healthSegment.getByRole("button").hover();
  await expect(
    page.locator('[data-stat-source="slot:0"]').first(),
  ).toHaveAttribute("data-related", "true");
  await expect(page.getByRole("tooltip")).toContainText("395");
  await page.keyboard.press("Escape");
  await firstSlot.focus();
  await expect(firstSlot).toBeFocused();
  await expect(page.locator("[data-inventory-value]")).toHaveText("4,200");
  await expect(page.locator("#skill-axe_counter_helix")).toContainText(
    "冷却 0 秒",
  );
  await page.getByRole("combobox", { name: "神杖配置", exact: true }).click();
  await page.getByRole("option", { name: "已吞服", exact: true }).click();
  await expect(health).toHaveText("670");
  await expect(page.locator("[data-inventory-value]")).toHaveText("0");
  await expect(page.locator("[data-configuration-value]")).toHaveText("5,800");
  await page.getByRole("combobox", { name: "神杖配置", exact: true }).click();
  await page.getByRole("option", { name: "炼金赠予", exact: true }).click();
  await expect(health).toHaveText("1065");
  await expect(page.locator("[data-hero-statuses]")).toContainText(
    "炼金赠予神杖",
  );
  await page.getByRole("button", { name: "魔晶", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "魔晶", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .locator('[data-inventory-slot="1"] button[aria-haspopup="dialog"]')
    .click();
  await search.fill("yinyuezhijing");
  await page
    .getByRole("button", { name: "装备：银月之晶", exact: true })
    .click();
  await expect(page.locator('[data-hero-stat="attackSpeed"]')).toHaveText(
    "268",
  );
  await page.getByRole("button", { name: "银月祝福", exact: true }).click();
  await expect(page.locator('[data-hero-stat="attackSpeed"]')).toHaveText(
    "188",
  );
  await expect(
    page.locator(
      '[data-stat-segments="attackSpeed"] [data-stat-segment="status:moon-consumed"]',
    ),
  ).toHaveAttribute("data-contribution", "60");
  await expect(page.locator("[data-inventory-value]")).toHaveText("0");
  const moonStatus = page.locator('[data-hero-status="moon-consumed"]');
  const moonIcon = moonStatus.getByRole("button", {
    name: "银月祝福",
    exact: true,
  });
  const circle = await moonIcon.boundingBox();
  expect(circle!.width).toBe(32);
  expect(circle!.height).toBe(32);
  const radius = await moonIcon.evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).borderRadius),
  );
  expect(radius).toBeGreaterThanOrEqual(circle!.width / 2);
  await moonIcon.hover();
  await expect(page.getByRole("tooltip")).toContainText("攻击速度 +60");
  await page.keyboard.press("Escape");
  await moonStatus
    .getByRole("button", { name: "移除状态：银月祝福", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(moonStatus).toHaveCount(0);
  await expect(page.locator('[data-hero-stat="attackSpeed"]')).toHaveText(
    "128",
  );
  await page.getByRole("button", { name: "银月祝福", exact: true }).click();
  const summaryRows = await page
    .locator("[data-hero-summary-stats] > div")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().top),
    );
  expect(new Set(summaryRows).size).toBe(1);
  const ordinary = await page
    .locator('[data-inventory-slot="0"]')
    .boundingBox();
  expect(ordinary!.width).toBe(44);
  const controls = await page.locator("[data-upgrade-controls]").boundingBox();
  const lastSlot = await page
    .locator('[data-inventory-slot="1"]')
    .boundingBox();
  expect(controls!.x).toBeGreaterThanOrEqual(lastSlot!.x + lastSlot!.width);
  await page
    .getByRole("slider", { name: "英雄等级", exact: true })
    .press("End");
  await page
    .locator("#skill-axe_counter_helix")
    .getByRole("radio", { name: "4", exact: true })
    .check();
  await page.getByRole("button", { name: "重置全部模拟", exact: true }).click();
  await expect(health).toHaveText("670");
  await expect(
    page.getByRole("slider", { name: "英雄等级", exact: true }),
  ).toHaveValue("1");
  await expect(page.locator('[data-hero-stat="attackSpeed"]')).toHaveText(
    "118",
  );
  await expect(page.locator("[data-configuration-value]")).toHaveText("0");
  await expect(page.locator("[data-hero-statuses]")).toContainText(
    "暂无额外状态",
  );
  await expect(page.locator("#skill-axe_counter_helix")).toContainText(
    "冷却 0.3 秒",
  );
});

test("heroes: neutral item states, tiered enchantments and mobile layout", async ({
  page,
}) => {
  test.skip(
    process.env.MEDOTA2_SHARED_WEB !== "1",
    "Uses reviewed 7.41f neutral pools.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/heroes/axe?lang=zh-CN");
  const health = page.locator('[data-hero-stat="health"]');
  const tiers = page.getByRole("group", { name: "中立档位", exact: true });
  await page
    .getByRole("button", { name: "配置：中立物品附魔", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "搜索中立附魔", exact: true })
    .fill("壮实");
  const enchantSearch = page.getByRole("textbox", {
    name: "搜索中立附魔",
    exact: true,
  });
  const brawny = page.getByRole("button", { name: "装备：壮实", exact: true });
  await expect(brawny).toContainText("110");
  await tiers.getByRole("radio", { name: "4 级", exact: true }).check();
  await expect(enchantSearch).toBeVisible();
  await expect(enchantSearch).toHaveValue("壮实");
  await expect(brawny).toContainText("230");
  await tiers
    .getByRole("radio", { name: "4 级", exact: true })
    .press("ArrowLeft");
  await expect(
    tiers.getByRole("radio", { name: "3 级", exact: true }),
  ).toBeChecked();
  await expect(brawny).toContainText("190");
  await tiers.getByRole("radio", { name: "1 级", exact: true }).check();
  await page.getByRole("button", { name: "装备：壮实", exact: true }).click();
  await expect(health).toHaveText("780");
  await page
    .getByRole("button", { name: "配置：中立物品", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "搜索中立物品", exact: true })
    .fill("stonefeather");
  await tiers.getByRole("radio", { name: "2 级", exact: true }).check();
  const neutralSearch = page.getByRole("textbox", {
    name: "搜索中立物品",
    exact: true,
  });
  await expect(neutralSearch).toBeVisible();
  await expect(neutralSearch).toHaveValue("stonefeather");
  await expect(page.getByText("没有匹配的物品", { exact: true })).toBeVisible();
  await tiers.getByRole("radio", { name: "1 级", exact: true }).check();
  await page.locator('[data-equip-item="item_stonefeather_satchel"]').click();
  await expect(page.locator('[data-hero-stat="movementSpeed"]')).toHaveText(
    "327",
  );
  await page
    .getByRole("combobox", { name: "中立物品状态", exact: true })
    .click();
  await page.getByRole("option", { name: "石头", exact: true }).click();
  await expect(page.locator('[data-hero-stat="movementSpeed"]')).toHaveText(
    "315",
  );
  await expect(page.locator('[data-hero-stat="armor"]')).toHaveText("5.88");
  await expect(tiers.getByRole("radio")).toHaveCount(5);
  await tiers.getByRole("radio", { name: "4 级", exact: true }).check();
  await expect(
    tiers.getByRole("radio", { name: "4 级", exact: true }),
  ).toBeChecked();
  await expect(health).toHaveText("670");
  await page
    .getByRole("button", { name: "配置：中立物品附魔", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "搜索中立附魔", exact: true })
    .fill("壮实");
  await page.getByRole("button", { name: "装备：壮实", exact: true }).click();
  await expect(health).toHaveText("900");
  await page
    .getByRole("button", { name: "配置：中立物品", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "搜索中立物品", exact: true })
    .fill("enchanters_bauble");
  await page.locator('[data-equip-item="item_enchanters_bauble"]').click();
  await expect(health).toHaveText("923");
  await page
    .getByRole("spinbutton", { name: "再次打造次数", exact: true })
    .fill("2");
  await expect(health).toHaveText("1084");
  await expect(page.locator("[data-enchantment-state]")).toContainText("×1.8");
  await expect(page.locator("[data-configuration-value]")).toHaveText("0");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "重置全部模拟", exact: true }).click();
  await expect(health).toHaveText("670");
  await expect(page.locator("[data-enchantment-state]")).toHaveCount(0);
});

test("heroes: calculated values link to sources and item actions appear on hover or focus", async ({
  page,
}) => {
  test.skip(
    process.env.MEDOTA2_SHARED_WEB !== "1",
    "Uses reviewed hero and item data.",
  );
  await page.goto("/heroes/axe?lang=zh-CN");
  const healthCalculation = page.locator(
    '[data-calculated-stat="health"] button',
  );
  await healthCalculation.hover();
  await expect(page.locator('[data-calculation-card="health"]')).toContainText(
    "25 × 22",
  );
  await expect(
    page.locator('[data-stat-source="base_health"]'),
  ).toHaveAttribute("data-related", "true");
  await expect(
    page.locator('[data-calculated-stat="strength"]'),
  ).toHaveAttribute("data-related", "true");
  await expect(
    page.locator('[data-calculated-stat="agility"]'),
  ).not.toHaveAttribute("data-related");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-related]")).toHaveCount(0);
  const attackTime = page.locator(
    '[data-calculated-stat="baseAttackTime"] button',
  );
  await attackTime.focus();
  await expect(
    page.locator('[data-calculation-card="baseAttackTime"]'),
  ).toContainText("= 1.7");
  await expect(
    page.locator('[data-stat-source="attack_rate"]'),
  ).toHaveAttribute("data-related", "true");
  await expect(
    page.locator('[data-calculated-stat="attackSpeed"]'),
  ).not.toHaveAttribute("data-related");
  await page.keyboard.press("Escape");
  const search = page.getByRole("textbox", {
    name: "搜索并装备物品",
    exact: true,
  });
  await page
    .locator('[data-inventory-slot="0"] button[aria-haspopup="dialog"]')
    .click();
  await search.fill("A杖");
  await search.press("Enter");
  await healthCalculation.hover();
  await expect(page.locator('[data-calculation-card="health"]')).toContainText(
    "35 × 22",
  );
  await expect(page.locator('[data-calculation-card="health"]')).toContainText(
    "= 1065",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "重置全部模拟", exact: true }).focus();
  await page.getByRole("heading", { name: "物品和状态", exact: true }).hover();
  const slot = page.locator('[data-inventory-slot="0"]');
  const remove = slot.getByRole("button", { name: "移除装备 1", exact: true });
  const brief = slot.getByRole("button", {
    name: "物品简介：阿哈利姆神杖",
    exact: true,
  });
  await expect(remove).toHaveCSS("opacity", "0");
  await expect(brief.locator("..")).toHaveCSS("opacity", "0");
  await slot.hover();
  await expect(remove).toHaveCSS("opacity", "1");
  await expect(brief.locator("..")).toHaveCSS("opacity", "1");
  const ordinaryFrame = slot.locator("button[aria-pressed] > span").first();
  await expect(ordinaryFrame).toHaveCSS("border-radius", "0px");
  const bounds = await ordinaryFrame.boundingBox();
  expect(bounds!.width).toBe(bounds!.height);
  await brief.hover();
  await expect(page.getByRole("tooltip")).toContainText("阿哈利姆神杖");
  await page.keyboard.press("Escape");
  await page.getByRole("heading", { name: "物品和状态", exact: true }).hover();
  await remove.focus();
  await expect(remove).toHaveCSS("opacity", "1");
  await remove.press("Enter");
  await expect(page.locator('[data-hero-stat="health"]')).toHaveText("670");
  await expect(
    page
      .locator('[data-neutral-slot="neutral"] button[aria-pressed] > span')
      .first(),
  ).toHaveCSS("border-radius", "50%");
  await expect(
    page
      .locator('[data-neutral-slot="enchantment"] button[aria-pressed] > span')
      .first(),
  ).toHaveCSS("border-radius", "50%");
});

test("heroes: every panel value ranks against the same-level Catalog and shows growth", async ({
  page,
}) => {
  test.skip(
    process.env.MEDOTA2_SHARED_WEB !== "1",
    "Uses the pinned real hero population.",
  );
  await page.goto("/heroes/legion_commander");
  const stats = page.locator("#stats");
  const health = stats.locator('[data-hero-stat="health"] button');
  await health.hover();
  const card = page.locator('[data-hero-ranking="health"]');
  await expect(card).toContainText("同版本 · 1级");
  await expect(card.locator('[data-rank-kind="values"]')).toContainText("670");
  await expect(card.locator('[data-rank-kind="growth"]')).toContainText("66");
  await expect(card.locator("[data-rank-result]").first()).toHaveText(
    /第 \d+ \/ \d+ 名 · P\d+$/,
  );
  expect(
    await card.locator('[data-rank-kind="values"] rect').count(),
  ).toBeGreaterThan(100);
  const plot = card.locator('[data-rank-kind="values"] svg');
  const pointTip = card.locator("[data-rank-point-tooltip]");
  await expect(plot.locator("title")).toHaveCount(0);
  await plot.hover({ position: { x: 1, y: 20 } });
  await expect(pointTip).toBeVisible();
  const firstPoint = await pointTip.innerText();
  const nextFrameText = await plot.evaluate((element) => {
    const box = element.getBoundingClientRect();
    element.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: box.right - 1,
        clientY: box.top + 20,
      }),
    );
    return new Promise<string | null>((resolve) =>
      requestAnimationFrame(() => {
        resolve(
          element.parentElement!.querySelector("[data-rank-point-tooltip]")
            ?.textContent ?? null,
        );
      }),
    );
  });
  expect(nextFrameText).toMatch(/: [\d.]+$/);
  expect(nextFrameText).not.toBe(firstPoint);
  await plot.focus();
  await plot.press("Home");
  await expect(pointTip).toHaveText(firstPoint);
  await plot.press("End");
  await expect(pointTip).toHaveText(nextFrameText!);
  await card.locator("strong").first().hover();
  await expect(pointTip).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("slider", { name: "英雄等级", exact: true }).fill("20");
  await health.focus();
  await expect(card).toContainText("同版本 · 20级");
  await expect(card.locator('[data-rank-kind="values"]')).toContainText("1924");
  await page.keyboard.press("Escape");
  await stats.locator('[data-hero-stat="damageMin"] button').hover();
  const damage = page.locator('[data-hero-ranking="damageMin"]');
  await expect(damage.locator('[data-rank-kind="values"]')).toHaveCount(2);
  await expect(damage).toContainText("下限");
  await expect(damage).toContainText("上限");
  await page.keyboard.press("Escape");
  await stats
    .getByRole("button", { name: "攻击前摇 · 全英雄排名", exact: true })
    .hover();
  await expect(
    page.locator('[data-hero-ranking="raw:attack_animation_point"]'),
  ).toContainText("0.46");
  await page.keyboard.press("Escape");
  await stats
    .getByRole("button", { name: "力量成长 · 全英雄排名", exact: true })
    .hover();
  await expect(
    page.locator(
      '[data-hero-ranking="raw:strength_gain"] [data-rank-kind="growth"]',
    ),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await health.hover();
  const mobilePlot = card.locator('[data-rank-kind="values"] svg');
  await mobilePlot.focus();
  await mobilePlot.press("End");
  const tipBox = await pointTip.boundingBox();
  expect(tipBox!.x).toBeGreaterThanOrEqual(0);
  expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(390);
  const box = await card.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("heroes: search provider states, configure levels and remove their contributions", async ({
  page,
}) => {
  test.skip(
    process.env.MEDOTA2_SHARED_WEB !== "1",
    "Uses pinned modifier localization and providers.",
  );
  await page.goto("/heroes/axe?lang=zh-CN");
  const speed = page.locator('[data-hero-stat="attackSpeed"]');
  await expect(speed).toHaveText("118");
  await page.getByRole("button", { name: "添加状态", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "添加状态", exact: true });
  const search = panel.getByRole("textbox", { name: "搜索状态或提供方" });
  await search.fill("ogre bloodlust");
  const result = panel.locator(
    '[data-status-result$=":modifier_ogre_magi_bloodlust"]',
  );
  await expect(result).toHaveCount(1);
  await expect(result).toContainText("食人魔魔法师");
  await result.getByRole("button", { name: "4", exact: true }).click();
  await result
    .getByRole("button", { name: "添加状态：嗜血术", exact: true })
    .click();
  await expect(speed).toHaveText("198");
  await search.fill("tower");
  await panel.getByRole("button", { name: "建筑", exact: true }).click();
  await expect(panel.locator("[data-status-result]").first()).toBeVisible();
  await search.press("Escape");
  const state = page.locator(
    '[data-hero-status$=":modifier_ogre_magi_bloodlust"]',
  );
  await state.getByRole("button", { name: "嗜血术", exact: true }).hover();
  await expect(page.getByRole("tooltip").last()).toContainText("食人魔魔法师");
  await state.getByRole("button", { name: "移除状态：嗜血术" }).click();
  await expect(speed).toHaveText("118");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "添加状态", exact: true }).click();
  await search.fill("legion press");
  await panel.getByRole("button", { name: "全部来源", exact: true }).click();
  const press = panel.locator(
    '[data-status-result$=":modifier_legion_commander_press_the_attack"]',
  );
  await press
    .getByRole("button", { name: "添加状态：强攻", exact: true })
    .click();
  await search.press("Escape");
  await expect(
    page.locator(
      '[data-hero-status$=":modifier_legion_commander_press_the_attack"]',
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "重置全部模拟", exact: true }).click();
  await expect(page.locator('[data-hero-status^="external:"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
