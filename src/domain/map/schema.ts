import { z } from "zod";

export const MAP_LAYERS = {
  ancient: { label: "遗迹", color: "#f7dc95", symbol: "◆" },
  tower: { label: "防御塔", color: "#d1dce8", symbol: "▣" },
  barracks: { label: "兵营", color: "#a2b8cd", symbol: "▤" },
  camp: { label: "野怪营地", color: "#e8b878", symbol: "●" },
  boss: { label: "肉山与魔方", color: "#ed8a78", symbol: "◆" },
  rune: { label: "神符", color: "#9bcaff", symbol: "♦" },
  shop: { label: "商店", color: "#f1cd72", symbol: "▰" },
  fountain: { label: "泉水", color: "#8ccfe8", symbol: "✦" },
  wisdom: { label: "智慧圣坛", color: "#c7a4eb", symbol: "✦" },
  outpost: { label: "前哨", color: "#bdb4ed", symbol: "◉" },
  watcher: { label: "监视者", color: "#bdb4ed", symbol: "◉" },
  gate: { label: "双生之门", color: "#a9dfec", symbol: "◎" },
  lotus: { label: "莲花池", color: "#e4b7e2", symbol: "✦" },
  tree: { label: "树木", color: "#77a98a", symbol: "·" },
  other: { label: "其他实体", color: "#8494a5", symbol: "·" },
} as const;
export type MapLayer = keyof typeof MAP_LAYERS;
const finite = z.number().finite();
export const boundsSchema = z
  .object({
    minX: finite,
    maxX: finite,
    minY: finite,
    maxY: finite,
  })
  .refine((b) => b.maxX > b.minX && b.maxY > b.minY, "Invalid map bounds");
export type MapBounds = z.infer<typeof boundsSchema>;
export const mapPointSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(Object.keys(MAP_LAYERS) as [MapLayer, ...MapLayer[]]),
  x: finite,
  y: finite,
  z: finite.nullable(),
  team: z.enum(["radiant", "dire", "neutral", "unknown"]),
  sourceClass: z.string(),
  sourcePath: z.string(),
  properties: z.record(z.string(), z.string()),
});
export type MapPoint = z.infer<typeof mapPointSchema>;
export const mapPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    mapName: z.literal("dota"),
    bounds: boundsSchema,
    image: z.object({
      file: z.literal("overview.webp"),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    points: z.array(mapPointSchema),
    zones: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          kind: z.literal("camp"),
          vertices: z.array(z.object({ x: finite, y: finite })).min(3),
        }),
      )
      .default([]),
    provenance: z.object({
      source_repository: z.string().min(1),
      source_commit: z.string().regex(/^[a-f0-9]{40}$/),
      source_path: z.array(z.string()).min(1),
      client_version: z.string().min(1).nullable(),
      public_source: z
        .object({
          patch: z.string().regex(/^\d+\.\d+[a-z]?$/),
          verification: z.literal("source-declared"),
          map_sha1: z.string().regex(/^[a-f0-9]{40}$/),
          steam_depot: z.literal("373301"),
          steam_manifest: z.string().regex(/^\d+$/),
          attribution: z.string(),
        })
        .optional(),
      imported_at: z.iso.datetime(),
      importer_version: z.string().min(1),
      schema_version: z.literal("map-v1"),
      files: z
        .array(
          z.object({
            path: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
        .min(1),
    }),
    coverage: z.object({
      terrain: z.enum(["native-overview", "source-filmmaker"]),
      entities: z.literal("static-point-entities"),
      navigation: z.literal(false),
      elevation: z.literal(false),
      vision: z.literal(false),
      skippedEntities: z.number().int().nonnegative(),
      unknownClasses: z.array(z.string()),
    }),
  })
  .superRefine((map, ctx) => {
    const ids = new Set<string>();
    for (const p of map.points) {
      if (ids.has(p.id))
        ctx.addIssue({ code: "custom", message: `Duplicate map ID: ${p.id}` });
      ids.add(p.id);
      if (
        p.x < map.bounds.minX ||
        p.x > map.bounds.maxX ||
        p.y < map.bounds.minY ||
        p.y > map.bounds.maxY
      )
        ctx.addIssue({
          code: "custom",
          message: `Point outside overview: ${p.id}`,
        });
    }
  });
export type MapPackage = z.infer<typeof mapPackageSchema>;
export type MapViewData = {
  bounds: MapBounds;
  points: MapPoint[];
  imageUrl: string | null;
  clientVersion: string | null;
  zones?: MapPackage["zones"];
  coverage: MapPackage["coverage"] | null;
};
