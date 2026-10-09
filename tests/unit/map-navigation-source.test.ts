import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sha256 } from "@/importers/dota-map/files";
import { readRoutingData } from "@/server/map/navigation";
import type { MapPackage } from "@/domain/map/schema";

it("derives navigation from the selected checksum-bound source, blocks unknown flags and rejects mutations", async () => {
  const root = await mkdtemp(join(tmpdir(), "medota-route-"));
  try {
    const raw = Buffer.alloc(36);
    raw.writeUInt32LE(0xfadebead);
    raw.writeFloatLE(64, 4);
    raw.writeUInt32LE(2, 16);
    raw.writeUInt32LE(2, 20);
    raw.set([1, 17, 0, 25], 32);
    const path = "raw/maps/dota.gnv";
    await mkdir(join(root, "source/raw/maps"), { recursive: true });
    await writeFile(join(root, "source", path), raw);
    const map = {
      provenance: { files: [{ path, sha256: sha256(raw) }] },
    } as MapPackage;
    expect((await readRoutingData(root, map)).grid).toMatchObject({
      walkable: "1100",
      wardable: "1010", // Known non-walkable terrain can still permit wards.
      noWard: "0100", // 17 remains walkable; 25 stays in the unknown (yellow) category.
    });
    expect(
      (
        await readRoutingData(root, {
          provenance: { files: [] },
        } as unknown as MapPackage)
      ).grid,
    ).toBeNull();
    raw[32] = 0;
    await writeFile(join(root, "source", path), raw);
    await expect(readRoutingData(root, map)).rejects.toThrow(
      "checksum mismatch",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("binds daylight and night vision to exact version unit definitions without inventing missing fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "medota-vision-"));
  try {
    const abilities = '"DOTAAbilities" {}',
      units =
        '"DOTAUnits" { "fixture_tower" { "BoundsHullName" "DOTA_HULL_SIZE_TOWER" "VisionDaytimeRange" "1800" "VisionNighttimeRange" "800" } "missing_night" { "VisionDaytimeRange" "500" } }';
    const base = "economy/scripts/npc/";
    await mkdir(join(root, "source", base), { recursive: true });
    await writeFile(join(root, "source", base, "npc_abilities.txt"), abilities);
    await writeFile(join(root, "source", base, "npc_units.txt"), units);
    const map = {
      provenance: {
        files: [
          {
            path: base + "npc_abilities.txt",
            sha256: sha256(Buffer.from(abilities)),
          },
          { path: base + "npc_units.txt", sha256: sha256(Buffer.from(units)) },
        ],
      },
      points: [
        {
          id: "tower",
          kind: "tower",
          properties: { mapunitname: "fixture_tower" },
        },
        {
          id: "missing",
          kind: "tower",
          properties: { mapunitname: "missing_night" },
        },
      ],
    } as unknown as MapPackage;
    const data = await readRoutingData(root, map);
    expect(data.visions).toEqual({
      tower: { day: 1800, night: 800, unitName: "fixture_tower" },
    });
    expect(data.currents).toBeUndefined();
    expect(data.obstacles).toEqual([]);
    const supported = await readRoutingData(root, {
      ...map,
      provenance: {
        ...map.provenance,
        client_version: "6944",
        native_source: { map_sha1: "412137a154d86cd4ba61da98692a5fb15e1cb79a" },
      },
    } as MapPackage);
    expect(supported.obstacles).toMatchObject([
      { id: "tower", radius: 144, estimated: false },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
