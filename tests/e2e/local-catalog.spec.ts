import { expect, test } from "./test-fixture";
import {
  queryReplica,
  type CatalogReplica,
} from "../../src/domain/catalog-replica";
import { parseHeroFilters } from "../../src/server/services/hero-filters";
import { parseAbilityFilters } from "../../src/server/services/ability-filters";

test("browser replica matches cursor filters and skips unchanged content", async ({
  request,
}) => {
  const first = await request.get("/api/catalog/heroes").then((r) => r.json());
  const identity = {
    datasetVersionId: first.datasetVersionId,
    assetDatasetVersionId: first.assetDatasetVersionId,
  };
  for (const entity of ["heroes", "abilities"] as const)
    for (const locale of ["zh-CN", "en"] as const) {
      const response = await request.post("/api/catalog/replica", {
        data: { ...identity, entity, locale, known: [] },
      });
      expect(response.ok()).toBe(true);
      const replica = (await response.json()) as CatalogReplica;
      const queries =
        entity === "heroes"
          ? [
              "",
              "q=dfs",
              "q=AM",
              "attribute=strength",
              "cm=false",
              "role=carry",
              "lang=en&q=敌法",
            ]
          : [
              "status=all",
              "q=shanshuo",
              "q=am+blink",
              "hero=antimage",
              "relation=talent",
              "upgrade=scepter",
              "upgrade=shard",
              "upgrade=granted",
              "status=template",
              "behavior=DOTA_ABILITY_BEHAVIOR_PASSIVE",
              "damage=DAMAGE_TYPE_MAGICAL",
            ];
      for (const query of queries) {
        const params = new URLSearchParams(query);
        params.set("lang", locale);
        const raw = Object.fromEntries(params);
        const filters =
          entity === "heroes"
            ? parseHeroFilters(raw).filters
            : parseAbilityFilters(raw).filters;
        const local = queryReplica(replica, filters);
        const remote = await request
          .get(`/api/catalog/${entity}?${params}`)
          .then((r) => r.json());
        expect(local.total, `${entity}:${params}`).toBe(remote.total);
        expect(local.items.slice(0, 48), `${entity}:${params}`).toEqual(
          remote.items,
        );
      }
      const unchanged = await request
        .post("/api/catalog/replica", {
          data: { ...identity, entity, locale, known: replica.manifest.hashes },
        })
        .then((r) => r.json());
      expect(unchanged.blocks).toEqual({});
      expect(unchanged.manifest).toEqual(replica.manifest);
    }
  const head = await request.get("/api/catalog/head");
  const unchanged = await request.get("/api/catalog/head", {
    headers: { "If-None-Match": head.headers().etag },
  });
  expect(unchanged.status()).toBe(304);
  expect(await unchanged.body()).toHaveLength(0);
});

test("heroes search and filter offline, then restore from IndexedDB without a download", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1680, height: 1480 });
  await page.goto("/heroes");
  const result = page.locator("[data-live-results]");
  await expect(result).toHaveAttribute("data-browser-cache", "ready");
  await expect(
    page.getByText("已显示全部英雄。", { exact: true }).last(),
  ).toBeVisible();
  const allCount = await page.locator("[data-infinite-list-item]").count();
  await page.waitForLoadState("networkidle");
  const requests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/catalog/"))
      requests.push(r.url());
  });
  await context.setOffline(true);
  const input = page.getByRole("textbox", { name: "搜索英雄" });
  await input.fill("dfs");
  await expect(
    page.getByRole("heading", { name: "敌法师", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-infinite-list-item]")).toHaveCount(1);
  await input.dispatchEvent("compositionstart");
  await input.fill("di");
  await page.waitForTimeout(120);
  await expect(page.locator("[data-infinite-list-item]")).toHaveCount(1);
  await input.fill("敌法");
  await input.dispatchEvent("compositionend", { data: "敌法" });
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("q") === "敌法" &&
      url.searchParams.get("lang") === "zh-CN",
  );
  await page.getByRole("button", { name: /清除/u }).click();
  await expect(page.locator("[data-infinite-list-item]")).toHaveCount(allCount);
  await page.locator("summary").filter({ hasText: "主属性" }).click();
  await page.getByRole("checkbox", { name: "力量", exact: true }).check();
  await expect(
    page.getByRole("heading", { name: "敌法师", exact: true }),
  ).toHaveCount(0);
  expect(requests).toEqual([]);
  await context.setOffline(false);
  const downloads: string[] = [];
  page.on("request", (r) => {
    if (
      new URL(r.url()).pathname === "/api/catalog/replica" &&
      r.postDataJSON()?.entity === "heroes"
    )
      downloads.push(r.url());
  });
  requests.length = 0;
  await page.reload();
  await expect(result).toHaveAttribute("data-browser-cache", "ready");
  await page.waitForLoadState("networkidle");
  expect(downloads).toEqual([]);
  expect(
    requests.filter((url) => new URL(url).pathname === "/api/catalog/heroes"),
  ).toEqual([]);
});

test("abilities use the local bilingual index and recover a corrupted stored snapshot", async ({
  page,
  context,
}) => {
  await page.goto("/abilities");
  const result = page.locator("[data-live-results]");
  await expect(result).toHaveAttribute("data-browser-cache", "ready");
  const input = page.getByRole("textbox", {
    name: /搜索技能|Search abilities/,
  });
  await page.getByRole("combobox", { name: "语言" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(result).toHaveAttribute("data-browser-cache", "ready");
  await page.waitForLoadState("networkidle");
  const requests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/catalog/"))
      requests.push(r.url());
  });
  await context.setOffline(true);
  for (const q of ["shanshuo", "闪烁", "ss", "am blink"]) {
    await input.fill(q);
    await expect(
      page.getByRole("heading", { name: "Blink", exact: true }),
    ).toBeVisible();
  }
  expect(requests).toEqual([]);
  await context.setOffline(false);
  // Change one persisted block without updating its digest. Reload must reject
  // it and repair from the server, never render unverified cached text.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("medota2-catalog");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction("snapshots", "readwrite"),
            store = tx.objectStore("snapshots"),
            all = store.getAll();
          all.onsuccess = () => {
            for (const record of all.result) {
              if (
                record.replica.manifest.entity === "abilities" &&
                record.replica.manifest.locale === "en"
              ) {
                const entries = Object.values(record.replica.blocks) as Array<
                  Array<{ row: { displayName: string } }>
                >;
                entries.find((block) => block.length)![0].row.displayName =
                  "CORRUPTED";
                store.put(record);
              }
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  const repaired = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/catalog/replica" &&
      r.request().postDataJSON()?.entity === "abilities" &&
      r.request().postDataJSON()?.locale === "en",
  );
  await page.reload();
  expect((await repaired).ok()).toBe(true);
  await expect(result).toHaveAttribute("data-browser-cache", "ready");
  await expect(page.getByText("CORRUPTED", { exact: true })).toHaveCount(0);
});

test("a snapshot arriving during a card click preserves the link", async ({
  page,
}) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/catalog/replica", async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.goto("/heroes");
  const card = page.locator("[data-infinite-list-item] a").first();
  const href = await card.getAttribute("href");
  await card.hover();
  await page.mouse.down();
  release();
  await expect(page.locator("[data-live-results]")).toHaveAttribute(
    "data-browser-cache",
    "ready",
  );
  await page.mouse.up();
  await expect(page).toHaveURL(new URL(href!, page.url()).href);
  await expect(page.locator("h1")).toBeVisible();
});
