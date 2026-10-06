import { z } from "zod";
import { economySchema, lanePathSchema, xyzSchema } from "./economy-schema";
import type { RoutingData } from "./routing";

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
  tree: { label: "树木", color: "#77a98a", symbol: "■" },
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
    economy: economySchema.optional(),
    lanePaths: z.array(lanePathSchema).default([]),
    rasterLayers: z
      .array(
        z.object({
          id: z.enum(["navigation", "height"]),
          label: z.string(),
          file: z.enum(["navigation.webp", "height.webp"]),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          bounds: boundsSchema,
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          note: z.string(),
        }),
      )
      .default([]),
    zones: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            kind: z.literal("camp"),
            vertices: z.array(z.object({ x: finite, y: finite })).min(3),
            zMin: finite.optional(),
            zMax: finite.optional(),
            worldVertices: z.array(xyzSchema).optional(),
          })
          .refine(
            (zone) =>
              (zone.zMin === undefined && zone.zMax === undefined) ||
              (zone.zMin !== undefined &&
                zone.zMax !== undefined &&
                zone.zMin <= zone.zMax &&
                (zone.worldVertices ?? []).every(
                  (v) => v.z >= zone.zMin! && v.z <= zone.zMax!,
                )),
            "Invalid spawn volume Z range",
          ),
      )
      .default([]),
    provenance: z.object({
      source_repository: z.string().min(1),
      source_commit: z
        .string()
        .regex(/^[a-f0-9]{40}$/)
        .nullable(),
      source_path: z.array(z.string()).min(1),
      client_version: z.string().min(1).nullable(),
      native_source: z
        .object({
          map_sha1: z.string().regex(/^[a-f0-9]{40}$/),
          map_sha256: z.string().regex(/^[a-f0-9]{64}$/),
          source_revision: z.string(),
          source2viewer: z.string(),
          verification: z.literal("local-map-hash-matched"),
          active_layers: z.array(z.string()),
          inactive_layers: z.array(z.string()),
        })
        .optional(),
      render_source: z
        .object({
          repository: z.string().url(),
          commit: z.string().regex(/^[a-f0-9]{40}$/),
          package_sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .optional(),
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
      elevation: z.boolean(),
      vision: z.literal(false),
      skippedEntities: z.number().int().nonnegative(),
      unknownClasses: z.array(z.string()),
      omittedNonGameplayEntities: z.number().int().nonnegative().optional(),
    }),
  })
  .superRefine((map, ctx) => {
    if (
      map.economy &&
      (map.economy.clientVersion !== map.provenance.client_version ||
        map.economy.patch !== map.provenance.public_source?.patch)
    )
      ctx.addIssue({
        code: "custom",
        message: "Economy and map versions disagree",
      });
    for (const camp of map.economy?.camps ?? [])
      if (!map.points.some((p) => p.id === camp.pointId && p.kind === "camp"))
        ctx.addIssue({
          code: "custom",
          message: "Economy references missing camp",
        });
    if (
      map.provenance.native_source &&
      (!map.provenance.public_source ||
        map.provenance.native_source.map_sha1 !==
          map.provenance.public_source.map_sha1 ||
        !map.provenance.client_version)
    )
      ctx.addIssue({
        code: "custom",
        message: "Native map and patch reference disagree",
      });
    if (
      new Set(map.rasterLayers.map((l) => l.id)).size !==
        map.rasterLayers.length ||
      new Set(map.rasterLayers.map((l) => l.file)).size !==
        map.rasterLayers.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate raster layer" });
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
  visions?: Record<
    string,
    { day: number; night: number; unitName: string; conditional?: string }
  >;
  watcherRules?: {
    channel: number;
    castRange: number;
    active: number;
    inactive: number;
    dayVision: number;
    nightVision: number;
  };
  routing?: RoutingData;
  bounds: MapBounds;
  points: MapPoint[];
  imageUrl: string | null;
  clientVersion: string | null;
  zones?: MapPackage["zones"];
  rasterLayers?: (MapPackage["rasterLayers"][number] & { url: string })[];
  coverage: MapPackage["coverage"] | null;
  economy?: MapPackage["economy"];
  lanePaths?: MapPackage["lanePaths"];
};
