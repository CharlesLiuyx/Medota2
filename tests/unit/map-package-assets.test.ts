import { describe, expect, it, vi } from "vitest";
import manifest from "@/data/map/package-icons.v1.json";
import { canonicalJsonSha256 } from "@/lib/hash";
import { supplementUnitBindings } from "@/server/assets/map-unit-bindings";
import {
  mapPackageIcons,
  nativeHeroIconUrl,
  readMapPackageIcon,
} from "@/server/map/package-icons";
import type { ActiveDatasetMeta } from "@/server/repositories/heroes";
vi.mock("server-only", () => ({}));
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/server/db/client", () => ({ getWebDatabase: async () => db }));

describe("reviewed v3 map artwork", () => {
  it("covers every package image and 108 mapped points without relabeling missing shrines", () => {
    const { manifestSha256, ...body } = manifest;
    expect(canonicalJsonSha256(body)).toBe(manifestSha256);
    expect(manifest.verifiedFiles).toBe(707);
    expect(new Set(manifest.assets.map((a) => a.key)).size).toBe(350);
    expect(manifest.assets.filter((a) => a.group === "hero")).toHaveLength(182);
    expect(Object.keys(manifest.points)).toHaveLength(108);
    expect(manifest.missing).toHaveLength(2);
    const keys = new Set(manifest.assets.map((a) => a.key));
    for (const key of Object.values(manifest.points))
      expect(keys.has(key)).toBe(true);
    expect(Object.values(manifest.points)).toContain("minimap_tower45");
    expect(Object.values(manifest.points)).toContain("minimap_tower90");
    expect(Object.values(manifest.points)).toContain("hud_fountain");
    expect(Object.values(manifest.points)).not.toContain("minimap_ward_obs");
    expect(
      manifest.assets.find((a) => a.key === "minimap_rune_shield")
        ?.sourceSha256,
    ).toBe("3cdf0b31a0c9f1af9764780b99ce75f6eab57388c9dc3afd8c8937f025abc9df");
    expect(
      manifest.assets.find((a) => a.key === "devilesk_ward_observer")
        ?.clientVersion,
    ).toBeNull();
  });
  it("requires the exact map and Catalog identities and rejects a mismatched HTTP hash before querying", async () => {
    expect(mapPackageIcons("6944", manifest.mapRevision)?.icons).toHaveLength(
      350,
    );
    expect(mapPackageIcons("6918", manifest.mapRevision)).toBeUndefined();
    expect(mapPackageIcons("6944", "0".repeat(64))).toBeUndefined();
    const meta = {
      datasetVersionId: manifest.catalogs[0].id,
      sourceCommit: manifest.sourceCommit,
      clientVersion: "6944",
    } as ActiveDatasetMeta;
    expect(nativeHeroIconUrl(meta, "npc_dota_hero_axe")).toContain(
      "/map/icons/minimap_heroicon_npc_dota_hero_axe?v=",
    );
    expect(
      nativeHeroIconUrl(
        { ...meta, sourceCommit: "0".repeat(40) },
        "npc_dota_hero_axe",
      ),
    ).toBeNull();
    db.query.mockClear();
    expect(
      await readMapPackageIcon("minimap_tower90", "0".repeat(64), null),
    ).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });
  it("supplements only missing unit images and preserves existing portraits and related icons", () => {
    const previous = [
      "portrait",
      "shared_portrait",
      "related_icon",
      "unavailable",
      "unavailable",
    ].map((resolution, i) => ({
      key: `unit${i}`,
      resolution,
      objectId: resolution === "unavailable" ? null : `old${i}`,
      provenance: { evidence: "original" },
    }));
    const icons = Object.fromEntries(
      previous.slice(0, 4).map((b) => [
        b.key,
        {
          objectId: "new",
          key: "minimap_tower90",
          sourceSha256: "a".repeat(64),
        },
      ]),
    );
    const result = supplementUnitBindings(previous, icons);
    expect(result.slice(0, 3)).toEqual(previous.slice(0, 3));
    expect(result[3]).toMatchObject({
      objectId: "new",
      resolution: "related_icon",
      provenance: { relation: "unit_minimap", client_version: "6944" },
    });
    expect(result[4]).toBe(previous[4]);
    expect(supplementUnitBindings(result, icons)).toEqual(result);
  });
});
