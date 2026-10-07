import { expect, test } from "../e2e/test-fixture";
import type { ReleaseIndex } from "@/domain/releases";
import type { ReplicaEntry } from "@/domain/catalog-replica";

test("abilities, units, items names: complete bilingual replicas and researched labels survive search and detail navigation", async ({
  page,
  request,
}) => {
  const indexResponse = await request.get("/api/releases");
  expect(indexResponse.ok()).toBe(true);
  const index = (await indexResponse.json()) as ReleaseIndex;
  const releases = index.releases.filter(
    (release) =>
      release.catalogId &&
      [
        "f4c45719314754567cb4ef4fe343bbc790a311f4",
        "991daaf6fc24b08445209d9ce8767e145bab107e",
      ].includes(release.sourceCommit ?? ""),
  );
  test.skip(!releases.length, "This fixture has no reviewed VPK release.");
  for (const release of releases) {
    const first = await request.get(
      `/api/catalog/abilities?release=${encodeURIComponent(release.id)}&status=all`,
    );
    expect(first.ok()).toBe(true);
    const identity = await first.json();
    for (const locale of ["zh-CN", "en"]) {
      const response = await request.post("/api/catalog/replica", {
        data: {
          entity: "abilities",
          locale,
          datasetVersionId: release.catalogId,
          assetDatasetVersionId: identity.assetDatasetVersionId,
        },
      });
      expect(response.ok()).toBe(true);
      const replica = await response.json();
      const entries = Object.values(replica.blocks).flat() as ReplicaEntry[];
      expect(replica.manifest.schema).toBe(3);
      expect(entries).toHaveLength(2703);
      for (const entry of entries) {
        const row = entry.row as { displayName: string };
        expect(row.displayName).not.toMatch(
          /名称待补充|name (?:unavailable|pending)/iu,
        );
      }
      expect(entries.find((e) => e.id === "dazzle_weave")?.row).toMatchObject({
        displayName: locale === "en" ? "Weave" : "编织",
      });
      expect(entries.find((e) => e.id === "generic_hidden")?.row).toMatchObject(
        {
          displayName:
            locale === "en"
              ? "Hidden Ability Slot (descriptive)"
              : "隐藏技能槽（用途名）",
        },
      );
    }
  }
  const release = encodeURIComponent(releases[0].id);
  await page.goto(`/items?lang=zh-CN&release=${release}`);
  await page
    .getByRole("textbox", { name: "搜索物品" })
    .fill("poor man's shield");
  const shield = page.locator('a[href^="/items/item_poor_mans_shield?"]');
  await expect(shield).toContainText("穷鬼盾");
  await shield.click();
  await expect(page.locator("h1")).toHaveText("穷鬼盾");

  await page.goto(`/units?lang=zh-CN&release=${release}`);
  await page.getByRole("textbox", { name: "搜索单位" }).fill("target dummy");
  const dummy = page.locator('a[href^="/units/npc_dota_target_dummy?"]');
  await expect(dummy).toContainText("测试标靶（用途名）");
  await dummy.click();
  await expect(page.locator("h1")).toHaveText("测试标靶（用途名）");

  await page.goto(
    `/abilities?q=weave&status=all&release=${release}&lang=zh-CN`,
  );
  const weave = page.locator('a[href^="/abilities/dazzle_weave?"]');
  await expect(weave).toContainText("编织");
  await weave.click();
  await expect(page.locator("h1")).toHaveText("编织");

  await page.goto(`/heroes/techies?lang=zh-CN&release=${release}`);
  await expect(page.locator("#facets")).toContainText("斯奎的瞄准镜");
  await expect(page.locator("#facets")).toContainText("斯布恩的藏品");
  await expect(page.locator("#facets")).not.toContainText("名称待补充");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/units/npc_dota_target_dummy?lang=en&release=${release}`);
  await expect(page.locator("h1")).toHaveText("Target Dummy (descriptive)");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
