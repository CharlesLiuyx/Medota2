import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  patch: vi.fn(),
  units: vi.fn(),
  items: vi.fn(),
  collection: vi.fn(),
  pkg: vi.fn(),
  asset: vi.fn(),
  routing: vi.fn(),
}));
vi.mock("@/config/env", () => ({ loadLocalEnv: vi.fn() }));
vi.mock("@/development/preview", () => ({
  previewEnvironment: () => ({ DOTA_MAP_COLLECTION_PATH: "fixture" }),
}));
vi.mock("@/importers/dota-vpk/gameplay-version", () => ({
  readPinnedGameplayVersion: fixture.patch,
}));
vi.mock("@/importers/dota-vpk/unit-snapshot", () => ({
  readPinnedUnitSnapshot: fixture.units,
}));
vi.mock("@/importers/dota-vpk/item-snapshot", () => ({
  readPinnedItemSnapshot: fixture.items,
}));
vi.mock("@/server/map/packages", () => ({
  readCollection: fixture.collection,
  loadMapPackage: fixture.pkg,
  loadMapAsset: fixture.asset,
}));
vi.mock("@/server/map/navigation", () => ({
  readRoutingData: fixture.routing,
}));
import {
  assertReleaseReady,
  inspectReleaseReadiness,
} from "@/server/release-readiness";
const meta = {
  datasetVersionId: "fixture",
  sourceCommit: "a".repeat(40),
  sourceRepository: "synthetic-fixture",
  clientVersion: "6944",
  steamSha256: "b".repeat(64),
  source_counts: {
    heroes: { accepted: 1 },
    abilities: { accepted: 2, facets: 1, bindings: 2 },
  },
  heroes: 1,
  abilities: 2,
  facets: 1,
  bindings: 2,
  localizations: 6,
  assets: 3,
  unitKeys: ["npc_dota_fixture"],
  itemKeys: ["item_fixture"],
};
const query = vi.fn();
beforeEach(() => {
  vi.stubEnv("MEDOTA2_ENVIRONMENT", "development");
  query.mockResolvedValue({ rows: [{ ...meta }] });
  fixture.patch.mockResolvedValue("7.41f");
  fixture.units.mockResolvedValue({
    units: [{ internalName: "npc_dota_fixture" }],
  });
  fixture.items.mockResolvedValue({
    items: [{ internalName: "item_fixture" }],
  });
  fixture.collection.mockResolvedValue({
    versions: [{ id: "fixture-map", patch: "7.41f" }],
  });
  fixture.pkg.mockResolvedValue({
    root: "fixture",
    revision: "c".repeat(64),
    map: {
      points: [{ id: "fixture-point" }],
      provenance: { client_version: "6944" },
      image: { file: "overview.webp" },
      rasterLayers: [],
    },
  });
  fixture.asset.mockResolvedValue({ bytes: Buffer.from("fixture") });
  fixture.routing.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());
it("requires catalog, localization, pictures, pinned units and matching map before publishing", async () => {
  expect(await assertReleaseReady({ query }, "fixture")).toMatchObject({
    ready: true,
    patch: "7.41f",
    mapId: "fixture-map",
  });
  fixture.collection.mockResolvedValue({ versions: [] });
  await expect(assertReleaseReady({ query }, "fixture")).rejects.toThrow(
    "同补丁唯一地图",
  );
  fixture.collection.mockResolvedValue({
    versions: [{ id: "fixture-map", patch: "7.41f" }],
  });
  query.mockResolvedValue({
    rows: [{ ...meta, unitKeys: null, localizations: 3 }],
  });
  const result = await inspectReleaseReadiness({ query }, "fixture");
  expect(result.ready).toBe(false);
  expect(result.problems.join(" ")).toContain("本地化未完整收录");
  expect(result.problems.join(" ")).toContain("完整单位身份集合");
});
it("rejects mismatched map builds and corrupt resources", async () => {
  fixture.pkg.mockResolvedValue({
    root: "fixture",
    revision: "c".repeat(64),
    map: {
      points: [{}],
      provenance: { client_version: "6918" },
      image: { file: "overview.webp" },
      rasterLayers: [],
    },
  });
  await expect(assertReleaseReady({ query }, "fixture")).rejects.toThrow(
    "构建号不一致",
  );
  fixture.asset.mockRejectedValue(new Error("Map asset checksum mismatch"));
  await expect(assertReleaseReady({ query }, "fixture")).rejects.toThrow(
    "checksum mismatch",
  );
});

it("rejects a release without pinned item definitions", async () => {
  fixture.items.mockResolvedValue(null);
  await expect(assertReleaseReady({ query }, "fixture")).rejects.toThrow(
    "物品定义",
  );
});

it("rejects a release whose item images do not cover its pinned identities", async () => {
  query.mockResolvedValue({ rows: [{ ...meta, itemKeys: ["item_other"] }] });
  await expect(assertReleaseReady({ query }, "fixture")).rejects.toThrow(
    "完整物品身份集合",
  );
});
