// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InfiniteAbilityCatalog } from "@/components/infinite-ability-catalog";
import { InfiniteHeroCatalog } from "@/components/infinite-hero-catalog";
import type { AbilityCardRow } from "@/server/repositories/abilities";
import type { HeroCardRow } from "@/server/repositories/heroes";

let observerCallback: IntersectionObserverCallback;

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      root = null;
      rootMargin: string;
      thresholds = [0];
      constructor(
        callback: IntersectionObserverCallback,
        options: IntersectionObserverInit = {},
      ) {
        observerCallback = callback;
        this.rootMargin = options.rootMargin ?? "0px";
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: FrameRequestCallback): number =>
      window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InfiniteHeroCatalog", () => {
  it("uses complete group counts and does not repeat a heading across chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          items: [hero(2, "strength"), hero(3, "agility")],
          previousCursor: "before-2",
          nextCursor: null,
          total: 3,
          datasetVersionId: "catalog-1",
          assetDatasetVersionId: "assets-1",
        }),
      } as Response),
    );
    render(
      <InfiniteHeroCatalog
        initialSlice={{
          items: [hero(1, "strength")],
          previousCursor: null,
          nextCursor: "after-1",
          total: 3,
          groupCounts: { strength: 2, agility: 1 },
          datasetVersionId: "catalog-1",
          assetDatasetVersionId: "assets-1",
        }}
        endpoint="/api/catalog/heroes?lang=zh-CN"
        lang="zh-CN"
      />,
    );

    const strengthHeading = document.querySelector(
      '[data-hero-group-heading="strength"]',
    )!;
    expect(screen.getByRole("group", { name: "英雄结果" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "力量 英雄" })).toBeTruthy();
    expect(strengthHeading.textContent).toContain("力量");
    expect(strengthHeading.textContent).toContain("2");

    const bottom = document.querySelector(
      '[data-infinite-list-sentinel="after"]',
    )!;
    act(() =>
      observerCallback(
        [
          {
            target: bottom,
            isIntersecting: true,
            boundingClientRect: bottom.getBoundingClientRect(),
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );

    expect(await screen.findByText("Hero 3 zh")).toBeTruthy();
    expect(
      document.querySelectorAll('[data-hero-group-heading="strength"]'),
    ).toHaveLength(1);
    const agilityHeadings = document.querySelectorAll(
      '[data-hero-group-heading="agility"]',
    );
    expect(agilityHeadings).toHaveLength(1);
    expect(agilityHeadings[0].textContent).toContain("1");
    expect(document.querySelectorAll("[data-infinite-list-item]")).toHaveLength(
      3,
    );
  });
});

describe("InfiniteAbilityCatalog", () => {
  it("renders server content immediately and appends cards from its canonical endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [ability("ability_two", "Ability Two")],
        previousCursor: "before-2",
        nextCursor: null,
        total: 2,
        datasetVersionId: "catalog-1",
        assetDatasetVersionId: "assets-1",
      }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(
      <InfiniteAbilityCatalog
        initialSlice={{
          items: [ability("ability_one", "Ability One")],
          previousCursor: null,
          nextCursor: "after-1",
          total: 2,
          datasetVersionId: "catalog-1",
          assetDatasetVersionId: "assets-1",
        }}
        endpoint="/api/catalog/abilities?lang=en&status=current"
        lang="en"
      />,
    );

    expect(screen.getByText("Ability One")).toBeTruthy();
    const bottom = document.querySelector(
      '[data-infinite-list-sentinel="after"]',
    )!;
    act(() =>
      observerCallback(
        [
          {
            target: bottom,
            isIntersecting: true,
            boundingClientRect: bottom.getBoundingClientRect(),
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );

    expect(await screen.findByText("Ability Two")).toBeTruthy();
    expect(String(fetchMock.mock.calls[0][0])).toContain("status=current");
    expect(String(fetchMock.mock.calls[0][0])).toContain("after=after-1");
    expect(document.querySelectorAll("[data-infinite-list-item]")).toHaveLength(
      2,
    );
  });
});

function hero(heroId: number, primaryAttribute: string): HeroCardRow {
  return {
    heroId,
    internalName: `npc_dota_hero_${heroId}`,
    slug: `hero-${heroId}`,
    primaryAttribute,
    attackType: "melee",
    faction: "radiant",
    complexity: 1,
    cmEnabled: true,
    baseStrength: "20",
    baseAgility: "20",
    baseIntelligence: "20",
    movementSpeed: "300",
    zhName: `Hero ${heroId} zh`,
    enName: `Hero ${heroId}`,
    roles: [],
  };
}

function ability(internalName: string, displayName: string): AbilityCardRow {
  return {
    internalName,
    displayName,
    fallbackName: null,
    catalogStatus: "current",
    definitionKind: "ability",
    behavior: [],
    damageType: null,
    isInnate: false,
    isUltimate: false,
    isPassive: false,
    hasScepterUpgrade: false,
    hasShardUpgrade: false,
    cooldown: null,
    manaCost: null,
    textureName: internalName,
    owners: [],
  };
}
