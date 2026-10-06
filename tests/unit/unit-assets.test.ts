import { expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  prepareUnitAssets,
  unitPortraitAliases,
} from "@/importers/valve-assets/unit-assets";
import { parsePortraitModels } from "@/importers/redota/portraits";
import type { UnitDefinition } from "@/domain/units";
const source = vi.hoisted(() => ({
  steam: vi.fn(),
  redota: vi.fn(),
  file: vi.fn(),
}));
vi.mock(
  "@/importers/valve-assets/steam-static-assets",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    readSteamStaticSource: source.steam,
  }),
);
vi.mock("@/importers/redota/portraits", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readRedotaPortrait: source.redota,
  readRedotaFile: source.file,
}));
const unit = (internalName: string, extra = {}): UnitDefinition => ({
  internalName,
  category: "summon",
  abilities: [],
  zhName: "单位",
  enName: "Unit",
  team: "中立",
  variant: "",
  attack: "近战",
  stats: {},
  ...extra,
});
it("distinguishes real portraits, model aliases, related skills and missing artwork without generating images", async () => {
  const bytes = await sharp({
    create: { width: 80, height: 80, channels: 3, background: "#889922" },
  })
    .png()
    .toBuffer();
  const image = {
    bytes,
    mimeType: "image/png",
    width: 80,
    height: 80,
    logicalPath: "units/test.png",
    sourceUrl:
      "https://cdn.steamstatic.com/apps/dota2/images/dota_react/units/test.png",
  };
  source.steam.mockImplementation(async (path: string) =>
    path.endsWith("/npc_dota_real.png") ? image : null,
  );
  source.redota.mockImplementation(async (_commit: string, key: string) =>
    key === "npc_dota_shared" ? image : null,
  );
  source.file.mockResolvedValue(
    Buffer.from("npc_dota_shared.jpg: model=models/shared.vmdl&portrait\n"),
  );
  const { bindings } = await prepareUnitAssets(
    [
      unit("npc_dota_real"),
      unit("npc_dota_alias", { model: "models/shared.vmdl" }),
      unit("npc_dota_skill", { summonAbility: "summon" }),
      unit("npc_dota_missing"),
      unit("npc_dota_sentry_wards", {
        category: "ward",
        model: "models/shared.vmdl",
      }),
    ],
    new Map([
      ["summon", { objectId: "related", path: "abilities/summon.png" }],
    ]),
    "a".repeat(40),
  );
  const byKey = Object.fromEntries(bindings.map((b) => [b.key, b]));
  expect(byKey.npc_dota_real.resolution).toBe("portrait");
  expect(byKey.npc_dota_real.asset?.variants.map((v) => v.lodKey)).toEqual([
    "original",
    "w64",
    "w128",
    "w256",
  ]);
  expect(byKey.npc_dota_alias.resolution).toBe("shared_portrait");
  expect(byKey.npc_dota_alias.asset?.sourceCommit).toBe("a".repeat(40));
  expect(byKey.npc_dota_skill).toMatchObject({
    resolution: "related_icon",
    objectId: "related",
  });
  expect(byKey.npc_dota_missing.resolution).toBe("unavailable");
  expect(byKey.npc_dota_sentry_wards.resolution).toBe("unavailable");
});
it("preserves team identity and excludes material overrides from automatic model matching", () => {
  expect(unitPortraitAliases(unit("npc_dota_badguys_tower3_top"))).toContain(
    "npc_dota_badguys_tower",
  );
  expect(
    unitPortraitAliases(unit("npc_dota_badguys_tower3_top")),
  ).not.toContain("npc_dota_goodguys_tower");
  expect(
    parsePortraitModels(
      "sentry.jpg: model=models/ward.vmdl&portrait&material=sentry.vmat",
    ).size,
  ).toBe(0);
});
