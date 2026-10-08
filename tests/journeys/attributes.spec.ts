import { expect, test } from "../e2e/test-fixture";
import type { ReleaseIndex } from "@/domain/releases";
test("attributes: bidirectional armor links, calculation, search, language and historical context", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/releases");
  expect(response.ok()).toBe(true);
  const index = (await response.json()) as ReleaseIndex;
  const selected = index.releases.find((r) => r.id === index.defaultRelease);
  if (selected?.catalogClient?.startsWith("fixture-")) {
    await page.goto("/attributes?lang=zh-CN");
    await expect(page.locator("h1")).toHaveText("属性图鉴");
    await expect(page.getByText(/^部分关联来源缺失：/)).toBeVisible();
    await page
      .getByRole("textbox", { name: "搜索属性", exact: true })
      .fill("hujia");
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "搜索属性", exact: true }),
    ).toHaveValue("hujia");
    await page
      .getByRole("list", { name: "属性结果" })
      .getByRole("link")
      .click();
    await expect(page.locator("h1")).toHaveText("护甲");
    expect(new URL(page.url()).searchParams.get("release")).toBe(selected.id);
    await expect(
      page.getByText("部分关联来源缺失：物品、单位", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/^客户端版本 fixture-1 ·/)).toBeVisible();
    await expect(
      page.getByText("社区机制资料，待引擎复核", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("output")).toContainText("70.42");
    await page.getByRole("spinbutton", { name: "示例总护甲" }).fill("-10");
    await expect(page.locator("output")).toContainText("137.50");
    await page.getByRole("combobox", { name: "语言", exact: true }).click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await expect(page.locator("h1")).toHaveText("Armor");
    await expect(
      page.getByRole("heading", { name: "Meaning and scope" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    const hero = page.locator('main a[href^="/heroes/"]').first();
    await expect(hero).toBeVisible();
    await hero.click();
    await expect(page.locator("h1")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("release")).toBe(selected.id);
    expect(new URL(page.url()).searchParams.get("lang")).toBe("en");
    return;
  }
  await page.goto("/items/item_platemail?lang=zh-CN");
  await expect(page.locator("h1")).toBeVisible();
  const release = new URL(page.url()).searchParams.get("release");
  expect(release).toBeTruthy();
  await page.locator('main a[href^="/attributes/armor?"]').first().click();
  await expect(page.locator("h1")).toHaveText("护甲");
  expect(new URL(page.url()).searchParams.get("release")).toBe(release);
  await expect(
    page.getByText("社区机制资料，待引擎复核", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("output")).toContainText("70.42");
  await page.getByRole("spinbutton", { name: "示例总护甲" }).fill("-10");
  await expect(page.locator("output")).toContainText("137.50");
  await page.getByRole("textbox", { name: "搜索关联对象" }).fill("platemail");
  const plate = page.locator('main a[href^="/items/item_platemail?"]');
  await expect(plate).toBeVisible();
  await plate.click();
  await expect(page.locator("h1")).toHaveText(/板甲|片甲/);
  await page
    .getByRole("navigation", { name: "图鉴分类" })
    .getByRole("link", { name: "属性", exact: true })
    .click();
  await expect(page.locator("h1")).toHaveText("属性图鉴");
  await expect(
    page.getByRole("region", { name: "基础属性" }).getByRole("link"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "夜间视野", exact: true }),
  ).toBeVisible();
  const catalogCards = page
    .getByRole("list", { name: "属性结果" })
    .getByRole("listitem");
  await expect(catalogCards).toHaveCount(63);
  const allAttributes = await request.get(
    `/api/attributes?scope=all&release=${selected!.id}`,
  );
  expect(allAttributes.ok()).toBe(true);
  const allCount = (await allAttributes.json()).total as number;
  const status = page.locator("main [role=status]").first();
  await expect(status).toHaveText(
    `63 / ${new Intl.NumberFormat("zh-CN").format(allCount)} 个属性`,
  );
  await page.getByRole("button", { name: "属性图鉴", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText("专属参数保留所属对象");
  await page.keyboard.press("Escape");

  for (const [width, columns] of [
    [1280, 4],
    [900, 3],
    [390, 2],
  ]) {
    await page.setViewportSize({ width, height: 844 });
    const cards = await catalogCards.evaluateAll((nodes) =>
      nodes
        .filter((node) => !node.closest('section[aria-label="基础属性"]'))
        .map((node) => {
          const box = node.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, left: box.left };
        }),
    );
    for (let index = 1; index < cards.length; index++) {
      if (index % columns) {
        expect(Math.abs(cards[index].top - cards[index - 1].top)).toBeLessThan(
          1,
        );
        expect(cards[index].left).toBeGreaterThan(cards[index - 1].left);
      } else {
        expect(cards[index].top - cards[index - 1].bottom).toBeCloseTo(4, 0);
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 844 });
  await page
    .getByRole("textbox", { name: "搜索属性", exact: true })
    .fill("hujia");
  await expect(
    page
      .getByRole("list", { name: "属性结果" })
      .getByRole("heading", { name: "护甲", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "搜索属性", exact: true }),
  ).toHaveValue("hujia");
  await page.getByRole("combobox", { name: "全局版本", exact: true }).click();
  await page.getByRole("option", { name: /7\.41e/ }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("release"))
    .not.toBe(release);
  const historical = new URL(page.url()).searchParams.get("release");
  expect(historical).not.toBe(release);
  await page.getByRole("list", { name: "属性结果" }).getByRole("link").click();
  await expect(page.locator("h1")).toHaveText("护甲");
  expect(new URL(page.url()).searchParams.get("release")).toBe(historical);
  await expect(page.getByText(/^客户端版本 6918 ·/)).toBeVisible();
  await page.getByRole("combobox", { name: "语言", exact: true }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("Armor");
  await expect(
    page.getByRole("heading", { name: "Meaning and scope" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.goto("/attributes/dispel-type?lang=zh-CN");
  await expect(page.locator("h1")).toHaveText("驱散类型");
  await expect(
    page.getByRole("heading", { name: "枚举值", exact: true }),
  ).toBeVisible();
  for (const value of [
    "SPELL_DISPELLABLE_YES",
    "SPELL_DISPELLABLE_YES_STRONG",
    "SPELL_DISPELLABLE_NO",
  ])
    await expect(page.getByText(value, { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "枚举值筛选", exact: true }).click();
  await page.getByRole("option", { name: "仅强驱散", exact: true }).click();
  const enumResults = page.getByRole("list", { name: "属性关联结果" });
  await expect(
    enumResults.getByText("仅强驱散", { exact: true }).first(),
  ).toBeVisible();
  await enumResults.getByRole("link").first().click();
  await page.locator("summary").filter({ hasText: "完整属性引用" }).click();
  await page
    .getByRole("link", { name: "驱散类型", exact: true })
    .first()
    .click();
  await expect(page.locator("h1")).toHaveText("驱散类型");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.goto(`/attributes/strength?lang=zh-CN&release=${historical}`);
  const evidence = page.locator("section").filter({
    has: page.getByRole("heading", { name: "VPK 证据与版本", exact: true }),
  });
  const health = evidence.getByRole("link", { name: "生命值", exact: true });
  await expect(health).toBeVisible();
  await expect(health).toHaveAttribute("data-attribute-reference", "health");
  await expect(
    evidence.getByRole("link", { name: "生命恢复", exact: true }).first(),
  ).toHaveAttribute("href", /attributes\/health-regen\?/);
  await health.click();
  await expect(page.locator("h1")).toHaveText("生命值");
  expect(new URL(page.url()).searchParams.get("release")).toBe(historical);
  expect(new URL(page.url()).searchParams.get("lang")).toBe("zh-CN");
  for (const pinned of [release!, historical!]) {
    const id = "ability~dawnbreaker_fire_wreath~movespeed_bonus_duration";
    await page.goto(`/attributes/${id}?lang=zh-CN&release=${pinned}`);
    await expect(page.locator("h1")).toHaveText("攻击速度加成持续时间");
    const relation = page.getByRole("list", { name: "属性关联结果" });
    await relation.getByText("字段与条件依据", { exact: true }).click();
    await expect(relation.getByText(/名称依据同版本效果说明/)).toBeVisible();
    await expect(
      relation.getByText(/movespeed_bonus_duration/).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.goto(`/attributes/${id}?lang=en&release=${pinned}`);
    await expect(page.locator("h1")).toHaveText("Attack speed bonus duration");
    const englishRelation = page.getByRole("list", {
      name: "Attribute references",
    });
    await englishRelation
      .getByText("Source fields and conditions", { exact: true })
      .click();
    await expect(
      englishRelation.getByText(
        /Project-reviewed name based on the same-version effect description/,
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page
      .getByRole("list", { name: "Attribute references" })
      .getByRole("link")
      .click();
    await expect(page.locator("h1")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("release")).toBe(pinned);
    expect(new URL(page.url()).searchParams.get("lang")).toBe("en");
  }
  await page.goto(
    `/attributes/ability~antimage_persectur~zero_tooltip?lang=zh-CN&release=${release}`,
  );
  await expect(page.locator("h1")).toHaveText("零值提示参数");
  await page.getByText("字段与条件依据", { exact: true }).click();
  await expect(page.getByText(/GPT-6-Luna.*上下文推定/)).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  for (const pinned of [release!, historical!]) {
    const id = "ability~earthshaker_echo_slam~echo_slam_echo_range";
    await page.goto(`/attributes/${id}?lang=zh-CN&release=${pinned}`);
    await expect(page.locator("h1")).toHaveText("回音伤害范围");
    await expect(
      page
        .getByRole("list", { name: "属性关联结果" })
        .getByText("700", { exact: true }),
    ).toBeVisible();
    await page.getByText("字段与条件依据", { exact: true }).click();
    await expect(page.getByText(/GPT-6-Luna.*上下文推定/)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.goto(`/attributes/${id}?lang=en&release=${pinned}`);
    await expect(page.locator("h1")).toHaveText("Echo damage range");
    await page
      .getByText("Source fields and conditions", { exact: true })
      .click();
    await expect(page.getByText(/Name inferred by GPT-6-Luna/)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  }
  for (const pinned of [release!, historical!]) {
    await page.goto(
      `/attributes?lang=zh-CN&release=${pinned}&scope=all&q=${encodeURIComponent("技能类型")}`,
    );
    await expect(
      page
        .getByRole("list", { name: "属性结果" })
        .getByText("技能类型", { exact: true })
        .first(),
    ).toBeVisible();
    const id = "ability~ability_launchpad~abilitytype";
    await page.goto(`/attributes/${id}?lang=zh-CN&release=${pinned}`);
    await expect(page.locator("h1")).toHaveText("技能类型");
    await page.getByText("字段与条件依据", { exact: true }).click();
    await expect(page.getByText(/中文名称由GPT-6-Luna/)).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "属性关联结果" })
        .getByText(/^scripts\/npc\/npc_abilities\.txt:\d+ · AbilityType$/),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.goto(`/attributes/${id}?lang=en&release=${pinned}`);
    await expect(page.locator("h1")).toHaveText("AbilityType");
    await page
      .getByText("Source fields and conditions", { exact: true })
      .click();
    await expect(
      page.getByText(/Chinese name inferred by GPT-6-Luna/),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.goto(
      `/attributes/ability~ability_launchpad~maxlevel?lang=zh-CN&release=${pinned}`,
    );
    await expect(page.locator("h1")).toHaveText("技能最高等级");
  }
  await page.goto("/attributes/not-a-real-attribute?lang=en");
  await expect(
    page.getByRole("heading", {
      name: "This version or page is not available",
      exact: true,
    }),
  ).toBeVisible();
});

test("attributes: complete damage phrases navigate to pinned enum explanations", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/releases");
  expect(response.ok()).toBe(true);
  const index = (await response.json()) as ReleaseIndex;
  const releases = index.releases.filter(
    (r) => r.catalogId && !r.catalogClient?.startsWith("fixture-"),
  );
  test.skip(
    !releases.length,
    "Complete source descriptions require a real catalog",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  for (const release of releases) {
    for (const locale of ["zh-CN", "en"]) {
      await page.goto(
        `/attributes/item~item_javelin~bonus_chance_damage?lang=${locale}&release=${release.id}`,
      );
      const description = page.locator("section").filter({
        has: page.getByRole("heading", {
          name: locale === "en" ? "Meaning and scope" : "含义与适用范围",
          exact: true,
        }),
      });
      const magical = description.getByRole("link", {
        name: locale === "en" ? "magical damage" : "魔法伤害",
        exact: true,
      });
      await expect(magical).toBeVisible();
      await expect(magical).toHaveAttribute(
        "data-attribute-reference",
        "damage-type",
      );
      await expect(magical).toHaveAttribute(
        "data-attribute-enum-value",
        "DAMAGE_TYPE_MAGICAL",
      );
      await expect(
        description.locator('[data-attribute-reference="damage"]'),
      ).toHaveCount(0);
      await magical.click();
      await expect(page.locator("h1")).toHaveText(
        locale === "en" ? "Damage type" : "伤害类型",
      );
      expect(new URL(page.url()).searchParams.get("release")).toBe(release.id);
      expect(new URL(page.url()).searchParams.get("lang")).toBe(locale);
      expect(new URL(page.url()).hash).toBe("#DAMAGE_TYPE_MAGICAL");
      await expect(page.locator("#DAMAGE_TYPE_MAGICAL")).toBeInViewport();
      for (const [value, name] of [
        ["DAMAGE_TYPE_PHYSICAL", locale === "en" ? "Physical" : "物理"],
        ["DAMAGE_TYPE_PURE", locale === "en" ? "Pure" : "纯粹"],
      ]) {
        await expect(page.locator(`#${value}`).locator("dt")).toHaveText(name);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
      await page.goBack();
      await expect(magical).toBeVisible();
    }
  }
});
