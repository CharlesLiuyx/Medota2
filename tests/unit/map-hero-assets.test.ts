import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { sha256 } from "@/lib/hash";
import { getHeroMapAssets } from "@/server/repositories/hero-map-assets";
import type { ActiveDatasetMeta } from "@/server/repositories/heroes";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  root: "",
  rows: [] as { source_path: string; raw_sha256: string }[],
}));
vi.mock("@/server/db/client", () => ({
  getWebDatabase: async () => ({ query: async () => ({ rows: mocks.rows }) }),
}));
vi.mock("@/importers/dota-vpk/source-roots", () => ({
  pinnedVpkRoots: () => [mocks.root],
}));
vi.mock("@/server/map/hero-icons", () => ({
  heroMinimapUrl: (_: unknown, key: string) => `/icons/${key}`,
}));
it("attaches verified inherited hulls to hero assets, isolates builds, and rejects changed input", async () => {
  const root = await mkdtemp(join(tmpdir(), "hero-map-assets-"));
  mocks.root = root;
  const files = {
    "steam.inf": "ClientVersion=6944",
    "scripts/npc/npc_heroes.txt":
      '#base "heroes/npc_dota_hero_base.txt"\n#base "heroes/npc_dota_hero_axe.txt"\n"DOTAHeroes" {}',
    "scripts/npc/heroes/npc_dota_hero_base.txt":
      '"DOTAHeroes" { "npc_dota_hero_base" { "BoundsHullName" "DOTA_HULL_SIZE_HERO" } }',
    "scripts/npc/heroes/npc_dota_hero_axe.txt":
      '"DOTAHeroes" { "npc_dota_hero_axe" { "HeroID" "2" } }',
  };
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    mocks.rows = Object.entries(files).map(([source_path, text]) => ({
      source_path,
      raw_sha256: sha256(text),
    }));
    const meta = {
      datasetVersionId: "fixture-one",
      sourceCommit: "a".repeat(40),
      clientVersion: "6944",
    } as ActiveDatasetMeta;
    expect((await getHeroMapAssets(meta)).get("npc_dota_hero_axe")).toEqual({
      imageUrl: "/icons/npc_dota_hero_axe",
      collisionRadius: 27,
    });
    expect(
      (
        await getHeroMapAssets({
          ...meta,
          datasetVersionId: "fixture-old",
          clientVersion: "6918",
        })
      ).get("npc_dota_hero_axe")?.collisionRadius,
    ).toBeNull();
    await writeFile(
      join(root, "scripts/npc/heroes/npc_dota_hero_axe.txt"),
      files["scripts/npc/heroes/npc_dota_hero_axe.txt"].replace('"2"', '"3"'),
    );
    expect(
      (await getHeroMapAssets({ ...meta, datasetVersionId: "fixture-changed" }))
        .size,
    ).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
