"use client";
import { useLocale } from "@/i18n/provider";
import { mapPointLabel } from "@/presentation/map-labels";
import { translate } from "@/i18n/messages";
import type { Locale } from "@/i18n/locale";
import { formatNumber } from "@/i18n/format";
import { Message, useTranslations } from "@/i18n/provider";

import { HoverTooltip } from "@/components/ui/hover-tooltip";
import { CompactSelect } from "@/components/ui/compact-select";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  VisionController,
  type VisionPlanner,
  drawVision,
  visionHeroIconSize,
  type VisionTexture,
} from "./vision-panel";
import { ShortcutKey } from "./shortcut-key";
import { TerrainLegend } from "./terrain-legend";
import { MapIconLibrary } from "./icon-library";
import { MapEconomyPanel } from "./economy-panel";
import { CampHoverCard } from "./camp-hover-card";
import { RoutePanel, useRoutePlanner } from "./route-planner";
import { createPinchAcceleration, wheelPixels } from "@/domain/map/gestures";
import { paintGrid, prepareGridPaint } from "./grid-painter";
import {
  HEIGHT_PALETTE_KEY,
  recolorHeightPixels,
} from "@/domain/map/height-palette";
import { highGroundRaster } from "@/domain/map/high-ground";
import { currentField } from "@/domain/map/currents";
import {
  heroVisionFootprint,
  type PlacedVisionSource,
  type VisionPreset,
} from "@/domain/map/vision-sources";
import {
  treeCells,
  obstacleCells,
  routeKey,
  routeColor,
  cellAt,
  withTrees,
  type NavGrid,
} from "@/domain/map/routing";
import {
  BARRACKS_LABELS,
  campGold,
  campExperience,
  clockText,
  goldText,
  xpText,
  laneWave,
  type BarracksState,
} from "@/domain/map/economy";
import {
  MAP_LAYERS,
  type MapLayer,
  type MapPoint,
  type MapViewData,
} from "@/domain/map/schema";
import {
  fitScale,
  distanceToPath,
  pointIndex,
  toScreen,
  toWorld,
  zoomAt,
  type Camera,
} from "@/domain/map/geometry";
type Position = {
  x: number;
  y: number;
};
type HeroHover = { source: PlacedVisionSource; preset: VisionPreset };
type MapControls = {
  reset(): void;
  zoom(factor: number): void;
  focus(point: MapPoint): void;
  hover(point: MapPoint | null): void;
};
const layerOrder: MapLayer[] = [
  "tree",
  "camp",
  "tower",
  "barracks",
  "rune",
  "boss",
  "gate",
  "watcher",
  "wisdom",
  "lotus",
  "outpost",
  "shop",
  "fountain",
  "other",
  "ancient",
];
const TERRAIN_KEYS: Record<string, string> = {
  "": "1",
  navigation: "2",
  height: "3",
};
const activeToolStyle =
  "bg-cyan-300/20 !text-cyan-100 ring-1 ring-inset ring-cyan-200/80 font-semibold shadow-[inset_0_-2px_0_#89eaff]";
const buttonStyle =
  "rounded px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-white/5 disabled:opacity-35";
const barracksDestroyed = (point: MapPoint, state: BarracksState) => {
  if (point.kind !== "barracks" || state === "normal") return false;
  if (state === "both" || state === "mega") return true;
  const unit = point.properties.mapunitname ?? point.properties.subType ?? "";
  return state === "melee"
    ? unit.includes("melee") || point.label === "近战兵营"
    : unit.includes("range") || point.label === "远程兵营";
};
const displayTeam = (p: MapPoint) => p.team;
const watcherLabel = (p: MapPoint, locale: Locale) =>
  p.kind === "watcher"
    ? `${mapPointLabel(p, locale)} · ${translate(locale, { neutral: "中立", radiant: "天辉", dire: "夜魇", unknown: "归属未知" }[p.team])}`
    : mapPointLabel(p, locale);
const MemoEconomyPanel = memo(MapEconomyPanel);
export function MapViewer({
  data: initialData,
  versionControls,
}: {
  data: MapViewData;
  versionControls?: ReactNode;
}) {
  // The parent keys this immutable payload by map revision and Catalog. A locale
  // navigation must not rebuild routing inputs or discard the Worker cache.
  const [data] = useState(initialData);
  const t = useTranslations();
  const locale = useLocale();
  const planner = useRoutePlanner(data);
  const routeFrame = useRef(planner);
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [visionAdding, setVisionAdding] = useState(false);
  const sightFrame = useRef<{
    sight: VisionPlanner;
    texture: VisionTexture | null;
  }>({ sight: null!, texture: null });
  const [hoveredLayer, setHoveredLayer] = useState<MapLayer | null>(null);
  const campLayerHover = hoveredLayer === "camp";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const heroHoverCardRef = useRef<HTMLDivElement>(null);
  const hoveredSourceRef = useRef<string | null>(null);
  const hoveredHeroRef = useRef<HeroHover | null>(null);
  const [hoveredHero, setHoveredHero] = useState<HeroHover | null>(null);
  const pickHintRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const rulerLabelRef = useRef<HTMLSpanElement>(null);
  const controls = useRef<MapControls | null>(null);
  const camera = useRef<Camera>({
    x: (data.bounds.minX + data.bounds.maxX) / 2,
    y: (data.bounds.minY + data.bounds.maxY) / 2,
    zoom: 1,
  });
  const [layers, setLayers] = useState<Set<MapLayer>>(
    () =>
      new Set(
        (Object.keys(MAP_LAYERS) as MapLayer[]).filter((k) => k !== "other"),
      ),
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [hovered, setHovered] = useState<MapPoint | null>(null);
  const [customRange, setCustomRange] = useState<{
    id: string;
    value: number;
  } | null>(null);
  const range =
    selected && customRange?.id === selected.id ? customRange.value : 0;
  const setRange = (value: number) =>
    setCustomRange(selected ? { id: selected.id, value } : null);
  const vision = selected ? data.visions?.[selected.id] : undefined;
  const rangeMax = Math.max(3000, vision?.day ?? 0, vision?.night ?? 0);
  const zoomLabelRef = useRef<HTMLButtonElement>(null);
  const [time, setTime] = useState(0);
  const [showGold, setShowGold] = useState(false);
  const [showExperience, setShowExperience] = useState(false);
  const [showTimings, setShowTimings] = useState(false);
  const [showLanes, setShowLanes] = useState(true);
  const [showCurrents, setShowCurrents] = useState(false);
  const [barracks, setBarracks] = useState<BarracksState>("normal");
  const [hoveredLanes, setHoveredLanes] = useState<string[]>([]);
  const laneHover = useRef<string[]>([]);
  const [includeChildren, setIncludeChildren] = useState(true);
  const [imageError, setImageError] = useState(false);
  const texture = useRef<HTMLImageElement | null>(null);
  const overlayTextures = useRef(
    new Map<string, HTMLImageElement | HTMLCanvasElement>(),
  );
  const markerTextures = useRef(new Map<string, HTMLImageElement>());
  const [markerImageError, setMarkerImageError] = useState(false);
  const [terrainLayer, setTerrainLayer] = useState<string>("");
  const [terrainError, setTerrainError] = useState(false);
  const redraw = useRef<() => void>(() => {});
  const updateVisionFrame = useCallback(
    (
      planner: VisionPlanner,
      texture: VisionTexture | null,
      repaint: boolean,
    ) => {
      const changed = sightFrame.current.sight?.enabled !== planner.enabled;
      const toolChanged =
        changed || sightFrame.current.sight?.tool !== planner.tool;
      if (toolChanged && canvasRef.current)
        canvasRef.current.style.cursor = planner.enabled
          ? planner.tool === null
            ? "default"
            : "crosshair"
          : "default";
      const adding = planner.enabled && planner.tool === "add";
      const wasAdding =
        sightFrame.current.sight?.enabled &&
        sightFrame.current.sight?.tool === "add";
      const enteringAdd = adding && !wasAdding;
      if (adding !== !!wasAdding) setVisionAdding(adding);
      sightFrame.current = { sight: planner, texture };
      if (
        !planner.enabled ||
        planner.tool !== null ||
        !planner.visibleSources.some(
          (source) => source.id === hoveredSourceRef.current,
        )
      ) {
        hoveredSourceRef.current = null;
        if (canvasRef.current)
          canvasRef.current.dataset.hoveredVisionSource = "";
      }
      const previousHover = hoveredHeroRef.current;
      if (previousHover) {
        const source = planner.visibleSources.find(
          (s) => s.id === previousHover.source.id,
        );
        const preset = planner.presets.find((p) => p.key === source?.presetKey);
        if (
          !planner.enabled ||
          planner.tool !== null ||
          !source ||
          source.kind !== "hero" ||
          !preset
        ) {
          hoveredHeroRef.current = null;
          setHoveredHero(null);
        } else if (
          source !== previousHover.source ||
          preset !== previousHover.preset
        ) {
          hoveredHeroRef.current = { source, preset };
          setHoveredHero(hoveredHeroRef.current);
        }
      }
      if (canvasRef.current && planner.enabled)
        canvasRef.current.style.cursor = planner.placementError
          ? "not-allowed"
          : planner.tool === null
            ? "default"
            : "crosshair";
      if (changed) setVisionEnabled(planner.enabled);
      if (enteringAdd) {
        controls.current?.hover(null);
        setHoveredLayer(null);
      }
      if (repaint) redraw.current();
    },
    [],
  );
  useLayoutEffect(() => {
    routeFrame.current = planner;
  });
  useLayoutEffect(() => {
    redraw.current();
  }, [hoveredHero]);
  useLayoutEffect(() => {
    redraw.current();
  }, [
    planner.enabled,
    planner.elapsed,
    planner.result,
    planner.shown,
    planner.overlays,
    planner.activeId,
    planner.drafting,
    planner.points,
    planner.playing,
  ]);
  const focusPoint = useCallback(
    (p: MapPoint) => controls.current?.focus(p),
    [],
  );
  const hoverPoint = useCallback(
    (p: MapPoint | null) => controls.current?.hover(p),
    [],
  );
  const counts = useMemo(() => {
    const result = new Map<MapLayer, number>();
    for (const p of data.points)
      result.set(p.kind, (result.get(p.kind) ?? 0) + 1);
    return result;
  }, [data.points]);
  const layerIcons = useMemo(() => {
    const result = new Map<
      MapLayer,
      NonNullable<MapViewData["mapIcons"]>["icons"][number]
    >();
    const assets = new Map(
      data.mapIcons?.icons.map((icon) => [icon.key, icon]),
    );
    for (const point of data.points) {
      const key = data.mapIcons?.points[point.id];
      const icon = key ? assets.get(key) : undefined;
      if (icon && !result.has(point.kind)) result.set(point.kind, icon);
    }
    return result;
  }, [data]);
  const visible = useMemo(
    () =>
      data.points.filter(
        (p) =>
          layers.has(p.kind) &&
          [
            p.label,
            mapPointLabel(p, "en"),
            MAP_LAYERS[p.kind].label,
            translate("en", MAP_LAYERS[p.kind].label),
            p.properties.targetname ?? "",
            p.sourceClass,
            p.team,
            {
              radiant: "天辉",
              dire: "夜魇",
              neutral: "中立",
              unknown: "阵营未提供",
            }[p.team],
          ]
            .join(" ")
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [data.points, layers, query],
  );
  const treeGrid = useMemo<NavGrid>(
    () =>
      data.routing?.grid ?? {
        cell: 64,
        x: Math.floor(data.bounds.minX / 64) * 64,
        y: Math.floor(data.bounds.minY / 64) * 64,
        width:
          Math.ceil(data.bounds.maxX / 64) - Math.floor(data.bounds.minX / 64),
        height:
          Math.ceil(data.bounds.maxY / 64) - Math.floor(data.bounds.minY / 64),
        walkable: "",
      },
    [data.routing, data.bounds],
  );
  const currents = useMemo(
    () =>
      data.routing?.currents?.length && data.routing.grid
        ? currentField(
            withTrees(
              data.routing.grid,
              data.points.filter((p) => p.kind === "tree"),
              data.routing.obstacles,
            ),
            data.routing.currents,
          )
        : null,
    [data.routing, data.points],
  );
  const treeBlocks = useMemo(
    () =>
      treeCells(
        treeGrid,
        visible.filter((p) => p.kind === "tree"),
      ),
    [treeGrid, visible],
  );
  const buildingBlocks = useMemo(
    () =>
      obstacleCells(
        treeGrid,
        (data.routing?.obstacles ?? []).filter((o) =>
          visible.some((p) => p.id === o.id),
        ),
      ),
    [treeGrid, visible, data.routing],
  );
  // Economic rules and labels depend on game time, never on pointer position.
  const campLabels = useMemo(
    () =>
      new Map(
        (data.economy?.camps ?? []).map((camp) => {
          const gold = campGold(data.economy!, camp, time, includeChildren);
          return [
            camp.pointId,
            {
              gold: gold ? goldText(gold) : null,
              xp: t(
                xpText(
                  campExperience(data.economy!, camp, time, includeChildren),
                ),
              ),
              timing: [
                camp.stack
                  ? t("叠 {value0}秒", {
                      value0: camp.stack.join("–"),
                    })
                  : "",
                ...camp.pulls.map((p) =>
                  t("{value0}拉 {value1}秒", {
                    value0: p.team === "radiant" ? t("天") : t("夜"),
                    value1: p.windows.map((w) => w.join("–")).join("/"),
                  }),
                ),
              ].filter(Boolean),
            },
          ];
        }),
      ),
    [data.economy, time, includeChildren, t],
  );
  const drawState = useMemo(
    () => ({
      selected,
      range,
      layers,
      query,
      terrainLayer,
      barracks,
      showCurrents,
      showGold,
      showLanes,
      campLayerHover,
      hoveredLayer,
      showExperience,
      showTimings,
      campLabels,
    }),
    [
      selected,
      range,
      layers,
      query,
      terrainLayer,
      barracks,
      showCurrents,
      showGold,
      showLanes,
      campLayerHover,
      hoveredLayer,
      showExperience,
      showTimings,
      campLabels,
    ],
  );
  const live = useRef(drawState);
  const hoverPointRef = useRef<MapPoint | null>(null);
  useLayoutEffect(() => {
    live.current = drawState;
    redraw.current();
  }, [drawState]);
  useEffect(() => {
    texture.current = null;
    if (!data.imageUrl) return;
    let disposed = false;
    const img = new Image();
    img.onload = () => {
      if (!disposed) {
        texture.current = img;
        setImageError(false);
        redraw.current();
      }
    };
    img.onerror = () => {
      if (!disposed) setImageError(true);
    };
    img.src = data.imageUrl;
    return () => {
      disposed = true;
    };
  }, [data.imageUrl]);
  useEffect(() => {
    const assets = data.mapIcons;
    if (!assets) return;
    let disposed = false;
    const images: HTMLImageElement[] = [];
    for (const key of new Set(Object.values(assets.points))) {
      const icon = assets.icons.find((i) => i.key === key);
      if (!icon) continue;
      const image = new Image();
      images.push(image);
      image.onload = () => {
        if (disposed) return;
        markerTextures.current.set(key, image);
        redraw.current();
      };
      image.onerror = () => {
        if (!disposed) setMarkerImageError(true);
      };
      image.src = icon.url;
    }
    return () => {
      disposed = true;
      images.forEach((image) => {
        image.onload = null;
        image.onerror = null;
      });
    };
  }, [data.mapIcons]);
  const heightPaletteKey = HEIGHT_PALETTE_KEY;
  useEffect(() => {
    let disposed = false;
    overlayTextures.current.clear();
    for (const layer of data.rasterLayers ?? []) {
      const img = new Image();
      img.onload = () => {
        if (!disposed) {
          let rendered: HTMLImageElement | HTMLCanvasElement = img;
          if (layer.id === "height") {
            const tile = document.createElement("canvas");
            tile.width = img.naturalWidth;
            tile.height = img.naturalHeight;
            const context = tile.getContext("2d");
            if (context) {
              context.drawImage(img, 0, 0);
              const pixels = context.getImageData(
                0,
                0,
                tile.width,
                tile.height,
              );
              const changed = recolorHeightPixels(pixels.data);
              if (canvasRef.current) {
                canvasRef.current.dataset.heightPalettePixels = String(changed);
                canvasRef.current.dataset.heightPalette = heightPaletteKey;
              }
              context.putImageData(pixels, 0, 0);
              rendered = tile;
            }
          }
          overlayTextures.current.set(layer.id, rendered);
          redraw.current();
        }
      };
      img.onerror = () => {
        if (!disposed) setTerrainError(true);
      };
      img.src = layer.url;
    }
    return () => {
      disposed = true;
    };
  }, [heightPaletteKey, data.rasterLayers]);
  useEffect(() => {
    const canvas = canvasRef.current,
      host = surfaceRef.current;
    if (!canvas || !host) return;
    const output = canvas.getContext("2d", { alpha: false });
    const background = document.createElement("canvas");
    const backgroundContext = background.getContext("2d", { alpha: false });
    if (!output || !backgroundContext) return;
    let ctx = output!;
    let backgroundKey = "";
    let backgroundCamera = { ...camera.current };
    let backgroundPadding = 0;
    let controlHeld = false;
    const modifiers = (e: KeyboardEvent) => {
      controlHeld = e.ctrlKey;
    };
    const clearModifiers = () => {
      controlHeld = false;
    };
    let backgroundImage: HTMLImageElement | null = null;
    let backgroundRaster: HTMLImageElement | HTMLCanvasElement | undefined;
    let backgroundLabels: typeof live.current.campLabels | null = null;
    let highGround:
      | {
          canvas: HTMLCanvasElement;
          raster: NonNullable<ReturnType<typeof highGroundRaster>>;
        }
      | null
      | undefined;
    let backgroundBuilds = 0;
    let paints = 0;
    let hitTests = 0;
    let pendingHover: Position | null = null;
    let pointerHint: Position | null = null;
    let eventRect: DOMRect | null = null;
    const invalidateRect = () => {
      eventRect = null;
    };
    let paintNeeded = true;
    const byId = new Map(visible.map((p) => [p.id, p]));
    const markers = visible.filter((p) => p.kind !== "tree");
    const treeTiles = new Map<string, number[]>();
    const treesAtCell = new Map<number, MapPoint[]>();
    for (const p of visible)
      if (p.kind === "tree") {
        const cells = treeCells(treeGrid, [p]);
        treeTiles.set(p.id, cells);
        for (const cell of cells) {
          const bin = treesAtCell.get(cell) ?? [];
          bin.push(p);
          treesAtCell.set(cell, bin);
        }
      }
    const noWardCells = Array.from(treeGrid.noWard ?? "").flatMap(
      (flag, index) => (flag === "1" ? [index] : []),
    );
    const noWardPaint = prepareGridPaint(treeGrid, noWardCells);
    const treePaint = prepareGridPaint(treeGrid, treeBlocks);
    const buildingPaint = prepareGridPaint(treeGrid, buildingBlocks);
    const currentCells = currents
      ? Array.from(currents.bonus.keys()).filter((i) => currents.bonus[i] > 0)
      : [];
    const currentPaint = prepareGridPaint(treeGrid, currentCells);
    const currentArrows = currentCells
      .filter(
        (i) =>
          (i % treeGrid.width) % 3 === 0 &&
          Math.floor(i / treeGrid.width) % 3 === 0,
      )
      .map((i) => ({
        x: treeGrid.x + ((i % treeGrid.width) + 0.5) * treeGrid.cell,
        y: treeGrid.y + (Math.floor(i / treeGrid.width) + 0.5) * treeGrid.cell,
        angle: Math.atan2(-currents!.y[i], currents!.x[i]),
      }));
    const pinchAcceleration = createPinchAcceleration();
    const touchAcceleration = createPinchAcceleration();
    // Cache glyph metrics rather than measure identical labels on every frame.
    const textWidths = new Map<string, number>();
    const textWidth = (text: string) => {
      const key = `${ctx.font}:${text}`;
      let value = textWidths.get(key);
      if (value === undefined) {
        value = ctx.measureText(text).width;
        textWidths.set(key, value);
      }
      return value;
    };
    let width = 1,
      height = 1,
      scale = 1,
      frame = 0;
    let hoverId: string | null = byId.has(hoverPointRef.current?.id ?? "")
        ? hoverPointRef.current!.id
        : null,
      dragged = false;
    let last: Position | null = null;
    const pointers = new Map<number, Position>();
    let visionDrag: {
      id: string;
      pointerId: number;
      start: Position;
      original: Position;
      position: Position;
      moving: boolean;
      selectionOnly: boolean;
    } | null = null;
    let previewTimer: ReturnType<typeof setTimeout> | null = null;
    let queuedPreview: { id: string; position: Position } | null = null;
    const queuePreview = (value: typeof queuedPreview) => {
      queuedPreview = value;
      if (!value) {
        if (previewTimer) clearTimeout(previewTimer);
        previewTimer = null;
        sightFrame.current.sight.setPreview(null);
      } else if (!previewTimer) {
        previewTimer = setTimeout(() => {
          previewTimer = null;
          sightFrame.current.sight.setPreview(queuedPreview);
        }, 0);
      }
    };
    const sourceAt = (position: Position) => {
      const sight = sightFrame.current.sight;
      if (!sight.enabled || sight.tool !== null || routeFrame.current.enabled)
        return null;
      return (
        [...sight.visibleSources]
          .reverse()
          .map((source) => ({
            source,
            distance: Math.hypot(
              screen(source).x - position.x,
              screen(source).y - position.y,
            ),
          }))
          .filter((hit) => {
            const preset = sight.presets.find(
              (p) => p.key === hit.source.presetKey,
            );
            if (hit.source.kind !== "hero" && preset?.imageAnchor) {
              const size = visionHeroIconSize(
                Math.max(20, 64 * scale * camera.current.zoom),
                hoveredSourceRef.current === hit.source.id,
              );
              const at = screen(hit.source);
              const left = at.x - size * preset.imageAnchor[0];
              const top = at.y - size * preset.imageAnchor[1];
              return (
                hit.distance <= 14 ||
                (position.x >= left &&
                  position.x <= left + size &&
                  position.y >= top &&
                  position.y <= top + size)
              );
            }
            const footprint =
              hit.source.kind === "hero"
                ? heroVisionFootprint(
                    hit.source,
                    preset?.collisionRadius,
                    sight.gridBounds,
                  )
                : null;
            if (footprint) {
              const a = screen({
                x: footprint.bounds.minX,
                y: footprint.bounds.maxY,
              });
              const b = screen({
                x: footprint.bounds.maxX,
                y: footprint.bounds.minY,
              });
              const hovered =
                hoveredHeroRef.current?.source.id === hit.source.id;
              const iconSize = visionHeroIconSize(
                Math.min(b.x - a.x, b.y - a.y),
                hovered,
              );
              const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              return (
                hit.distance <= 14 ||
                (Math.abs(position.x - center.x) <= iconSize / 2 &&
                  Math.abs(position.y - center.y) <= iconSize / 2)
              );
            }
            if (hoveredSourceRef.current === hit.source.id) {
              const half =
                visionHeroIconSize(
                  Math.max(20, 64 * scale * camera.current.zoom),
                  true,
                ) / 2;
              const at = screen(hit.source);
              return (
                Math.abs(position.x - at.x) <= half &&
                Math.abs(position.y - at.y) <= half
              );
            }
            return (
              hit.distance <= Math.max(14, 32 * scale * camera.current.zoom)
            );
          })
          .sort((a, b) => a.distance - b.distance)[0]?.source ?? null
      );
    };
    const cancelVisionDrag = () => {
      if (!visionDrag) return;
      queuePreview(null);
      if (visionDrag.moving) sightFrame.current.sight.endDrag(visionDrag.id);
      pointers.delete(visionDrag.pointerId);
      visionDrag = null;
      last = null;
      schedule();
    };
    const lookup = pointIndex(markers);
    const screen = (p: Position) =>
      toScreen(p.x, p.y, camera.current, scale, width, height);
    const world = (p: Position) =>
      toWorld(p.x, p.y, camera.current, scale, width, height);
    const constrain = () => {
      camera.current.x = Math.max(
        data.bounds.minX,
        Math.min(data.bounds.maxX, camera.current.x),
      );
      camera.current.y = Math.max(
        data.bounds.minY,
        Math.min(data.bounds.maxY, camera.current.y),
      );
    };
    function draw() {
      frame = 0;
      // App Router can retain a page in a hidden Activity during navigation.
      // A queued paint must not resize its backing canvas to zero while hidden.
      if (!canvas || width <= 0 || height <= 0) return;
      const started = performance.now();
      if (pendingHover) {
        const p = pendingHover;
        pendingHover = null;
        updateHover(p);
      }
      if (!paintNeeded) return;
      paintNeeded = false;
      const {
        selected,
        range,
        layers,
        query,
        terrainLayer,
        barracks,
        showCurrents,
        showGold,
        showLanes,
        campLayerHover,
        hoveredLayer,
        showExperience,
        showTimings,
        campLabels,
      } = live.current;
      const hoverPoint = byId.get(hoverId ?? "");
      const activeCamps = new Set(
        [byId.get(selected?.id ?? ""), hoverPoint].filter(
          (p): p is MapPoint => p?.kind === "camp",
        ),
      );
      const activeCampVolumes = new Map<string, MapPoint>();
      for (const camp of activeCamps) {
        const volume =
          camp.properties.volumename ?? camp.properties.triggerName;
        if (volume) activeCampVolumes.set(volume.replace(/^\[PR#\]/, ""), camp);
      }
      const activeZones: NonNullable<MapViewData["zones"]> = [];
      const drawZone = (
        zone: NonNullable<MapViewData["zones"]>[number],
        active: boolean,
      ) => {
        ctx.save();
        ctx.lineJoin = "round";
        ctx.beginPath();
        zone.vertices.forEach((vertex, i) => {
          const p = screen(vertex);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.fillStyle = active ? "#73e5f238" : "#73e5f209";
        ctx.fill();
        ctx.strokeStyle = active ? "#07151e" : "#07151e99";
        ctx.lineWidth = active ? 5 : 2;
        ctx.stroke();
        ctx.strokeStyle = active ? "#dbfaff" : "#a0efff99";
        ctx.lineWidth = active ? 2 : 1;
        ctx.stroke();
        ctx.restore();
      };
      const drawMarker = (p: MapPoint, active: boolean) => {
        const s = screen(p);
        const padding = ctx === backgroundContext ? backgroundPadding : 0;
        if (
          s.x < -40 - padding ||
          s.y < -40 - padding ||
          s.x > width + 40 + padding ||
          s.y > height + 40 + padding
        )
          return;
        if (p.kind === "tree") {
          if (active)
            for (const i of treeTiles.get(p.id) ?? []) {
              const at = screen({
                x: treeGrid.x + (i % treeGrid.width) * treeGrid.cell,
                y:
                  treeGrid.y +
                  (Math.floor(i / treeGrid.width) + 1) * treeGrid.cell,
              });
              const side = treeGrid.cell * scale * camera.current.zoom;
              ctx.fillStyle = "#f3e6bd";
              ctx.fillRect(at.x, at.y, side, side);
            }
          return;
        }
        const radius =
          p.kind === "camp"
            ? 4
            : p.kind === "shop"
              ? 3.2
              : p.kind === "other"
                ? active
                  ? 4
                  : 2
                : active
                  ? 11
                  : 8;
        const destroyed = barracksDestroyed(p, barracks);
        ctx.save();
        if (destroyed) ctx.globalAlpha = 0.3;
        const nativeKey = data.mapIcons?.points[p.id];
        const nativeImage = nativeKey
          ? markerTextures.current.get(nativeKey)
          : null;
        if (nativeImage) {
          const size =
            (p.kind === "camp" || p.kind === "other" ? 16 : 24) *
            Math.min(1, Math.max(0.6, width / 500)) *
            Math.min(2, Math.sqrt(camera.current.zoom)) *
            (active ? 1.2 : 1);
          const ratio =
            size /
            Math.max(nativeImage.naturalWidth, nativeImage.naturalHeight);
          const w = nativeImage.naturalWidth * ratio,
            h = nativeImage.naturalHeight * ratio;
          ctx.save();
          ctx.shadowColor = "#000";
          ctx.shadowBlur = 3;
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(nativeImage, s.x - w / 2, s.y - h / 2, w, h);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = active ? "#f3e6bd" : "#10191fe8";
          ctx.fill();
          ctx.strokeStyle =
            displayTeam(p) === "radiant"
              ? "#7fcca1"
              : displayTeam(p) === "dire"
                ? "#e18b80"
                : p.kind === "watcher"
                  ? "#adb6be"
                  : MAP_LAYERS[p.kind].color;
          ctx.lineWidth =
            p.kind === "shop"
              ? 0.4
              : p.kind === "camp"
                ? 0.75
                : active
                  ? 2
                  : 1.5;
          ctx.stroke();
          if (p.kind === "camp") {
            ctx.beginPath();
            ctx.arc(s.x, s.y, 1.25, 0, Math.PI * 2);
            ctx.fillStyle = active ? "#10191f" : MAP_LAYERS.camp.color;
            ctx.fill();
          }
          if (radius > 4) {
            ctx.font = "11px system-ui";
            ctx.fillStyle = active
              ? "#10191f"
              : p.kind === "watcher"
                ? displayTeam(p) === "radiant"
                  ? "#7fcca1"
                  : displayTeam(p) === "dire"
                    ? "#e18b80"
                    : "#adb6be"
                : MAP_LAYERS[p.kind].color;
            ctx.fillText(
              p.kind === "watcher"
                ? {
                    radiant: t("天"),
                    dire: t("夜"),
                    neutral: t("中"),
                    unknown: "?",
                  }[displayTeam(p)]
                : MAP_LAYERS[p.kind].symbol,
              s.x,
              s.y,
            );
          }
        }
        ctx.restore();
        if (destroyed) {
          const half = 8 * Math.min(2, Math.sqrt(camera.current.zoom));
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(s.x - half, s.y - half);
          ctx.lineTo(s.x + half, s.y + half);
          ctx.moveTo(s.x + half, s.y - half);
          ctx.lineTo(s.x - half, s.y + half);
          ctx.strokeStyle = "#10191f";
          ctx.lineWidth = 4;
          ctx.stroke();
          ctx.strokeStyle = "#ef8a83";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
        if (!active && camera.current.zoom >= 3 && p.kind !== "other") {
          ctx.font = "11px system-ui";
          ctx.lineWidth = 3;
          ctx.strokeStyle = "#091219";
          ctx.strokeText(mapPointLabel(p, locale), s.x, s.y + 21);
          ctx.fillStyle = "#e3eaf0";
          ctx.fillText(mapPointLabel(p, locale), s.x, s.y + 21);
        }
      };
      const drawCampLabel = (
        pointId: string,
        labels: NonNullable<ReturnType<typeof campLabels.get>>,
        extra: boolean,
      ) => {
        ctx.font = "10px system-ui";
        ctx.textAlign = "center";
        const point = byId.get(pointId);
        if (!point) return;
        const volume =
          point.properties.volumename ?? point.properties.triggerName;
        const zones = (data.zones ?? []).filter(
          (zone) =>
            zone.label.replace(/^\[PR#\]/, "") ===
            volume?.replace(/^\[PR#\]/, ""),
        );
        const vertices = zones.flatMap((zone) => zone.vertices);
        const at = vertices.length
          ? screen({
              x:
                (Math.min(...vertices.map((v) => v.x)) +
                  Math.max(...vertices.map((v) => v.x))) /
                2,
              y: Math.max(...vertices.map((v) => v.y)),
            })
          : screen(point);
        const padding = ctx === backgroundContext ? backgroundPadding : 0;
        if (
          at.x < -160 - padding ||
          at.y < -30 - padding ||
          at.x > width + 160 + padding ||
          at.y > height + 100 + padding
        )
          return;
        const bottom = vertices.length
          ? screen({ x: point.x, y: Math.min(...vertices.map((v) => v.y)) }).y
          : screen(point).y;
        const groups = [
          {
            rows: labels.timing.map((text) => ({
              text,
              color: "#d7ead5",
              visible: showTimings,
            })),
            y: at.y - (vertices.length ? 10 : 18),
            step: -16,
          },
          {
            rows: [
              {
                text: labels.gold ?? t("未收录"),
                color: "#f0cd86",
                visible: showGold,
              },
              {
                text: t("经验 {value0}", { value0: labels.xp }),
                color: "#a6daf4",
                visible: showExperience,
              },
            ],
            y: Math.max(bottom + 10, screen(point).y + 39),
            step: 16,
          },
        ];
        for (const group of groups) {
          // Keep enabled rows fixed; hover fills the rest within the same side.
          const rows = group.rows.filter((row) => row.visible);
          if (extra) rows.push(...group.rows.filter((row) => !row.visible));
          let y = group.y;
          for (const row of rows) {
            const half = textWidth(row.text) / 2 + 3;
            ctx.fillStyle = "#091219f2";
            ctx.fillRect(at.x - half, y - 8, half * 2, 15);
            ctx.fillStyle = row.color;
            ctx.fillText(row.text, at.x, y);
            y += group.step;
          }
        }
      };
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // DPR can change when moving between displays without a CSS resize.
      if (
        canvas.width !== Math.round(width * dpr) ||
        canvas.height !== Math.round(height * dpr)
      ) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      // Keep a bounded border around the viewport so panning only composites pixels.
      const padding = Math.min(192, Math.ceil(Math.min(width, height) / 4));
      const shift = () => ({
        x:
          (backgroundCamera.x - camera.current.x) * scale * camera.current.zoom,
        y:
          (camera.current.y - backgroundCamera.y) * scale * camera.current.zoom,
      });
      const offset = shift();
      const key = [
        camera.current.zoom,
        width,
        height,
        dpr,
        terrainLayer,
        barracks,
        showCurrents,
        showLanes,
        showGold,
        showExperience,
        showTimings,
        layers.has("camp"),
        query,
        markerTextures.current.size,
        sightFrame.current.sight.enabled,
      ].join("|");
      const rasterImage = overlayTextures.current.get(terrainLayer);
      if (
        key !== backgroundKey ||
        Math.abs(offset.x) > backgroundPadding ||
        Math.abs(offset.y) > backgroundPadding ||
        texture.current !== backgroundImage ||
        rasterImage !== backgroundRaster ||
        campLabels !== backgroundLabels
      ) {
        backgroundKey = key;
        backgroundLabels = campLabels;
        backgroundImage = texture.current;
        backgroundRaster = rasterImage;
        backgroundBuilds++;
        backgroundCamera = { ...camera.current };
        backgroundPadding = padding;
        const backingWidth = Math.round((width + padding * 2) * dpr);
        const backingHeight = Math.round((height + padding * 2) * dpr);
        if (background.width !== backingWidth) background.width = backingWidth;
        if (background.height !== backingHeight)
          background.height = backingHeight;
        ctx = backgroundContext!;
        ctx.setTransform(dpr, 0, 0, dpr, padding * dpr, padding * dpr);
        ctx.fillStyle = "#0b131a";
        ctx.fillRect(
          -padding,
          -padding,
          width + padding * 2,
          height + padding * 2,
        );
        const topLeft = screen({ x: data.bounds.minX, y: data.bounds.maxY });
        const bottomRight = screen({
          x: data.bounds.maxX,
          y: data.bounds.minY,
        });
        if (texture.current) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(
            texture.current,
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y,
          );
        } else {
          ctx.fillStyle = "#121e27";
          ctx.fillRect(
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y,
          );
          // Coordinate axes express only the verified overview transform, never terrain.
          const zero = screen({ x: 0, y: 0 });
          ctx.strokeStyle = "#25313b";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(topLeft.x, zero.y);
          ctx.lineTo(bottomRight.x, zero.y);
          ctx.moveTo(zero.x, topLeft.y);
          ctx.lineTo(zero.x, bottomRight.y);
          ctx.stroke();
        }
        const overlay = data.rasterLayers?.find((l) => l.id === terrainLayer);
        const raster = overlay && overlayTextures.current.get(overlay.id);
        if (overlay && raster) {
          const a = screen({ x: overlay.bounds.minX, y: overlay.bounds.maxY });
          const b = screen({ x: overlay.bounds.maxX, y: overlay.bounds.minY });
          ctx.save();
          ctx.beginPath();
          ctx.rect(
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y,
          );
          ctx.clip();
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(raster, a.x, a.y, b.x - a.x, b.y - a.y);
          ctx.restore();
        }
        if (showLanes) {
          ctx.save();
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = 1.5;
          for (const route of data.lanePaths ?? []) {
            ctx.strokeStyle =
              route.team === "radiant" ? "#8fddb580" : "#ef9e9380";
            ctx.beginPath();
            route.vertices.forEach((v, i) => {
              const p = screen(v);
              if (i === 0) ctx.moveTo(p.x, p.y);
              else ctx.lineTo(p.x, p.y);
            });
            ctx.stroke();
          }
          ctx.restore();
        }
        if (showCurrents && currents) {
          paintGrid(
            ctx,
            currentPaint,
            treeGrid,
            camera.current,
            {
              width: width + padding * 2,
              height: height + padding * 2,
              scale,
              dpr,
            },
            {
              fill: "#38bfc950",
              border: "#64e5ec66",
              inner: "#64e5ec22",
              innerAlpha: 1,
              width: 0.5,
            },
          );
          ctx.save();
          ctx.strokeStyle = "#b7fbff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const size = Math.max(
            3,
            Math.min(7, treeGrid.cell * scale * camera.current.zoom * 0.7),
          );
          for (const arrow of currentArrows) {
            const p = screen(arrow);
            if (
              p.x < -size - padding ||
              p.x > width + size + padding ||
              p.y < -size - padding ||
              p.y > height + size + padding
            )
              continue;
            ctx.moveTo(
              p.x - Math.cos(arrow.angle - 0.6) * size,
              p.y - Math.sin(arrow.angle - 0.6) * size,
            );
            ctx.lineTo(p.x, p.y);
            ctx.lineTo(
              p.x - Math.cos(arrow.angle + 0.6) * size,
              p.y - Math.sin(arrow.angle + 0.6) * size,
            );
          }
          ctx.stroke();
          ctx.restore();
        }
        const showHighGround = sightFrame.current.sight.enabled;
        if (showHighGround && highGround === undefined) {
          const raster = highGroundRaster(
            data.visionScene?.scene.terrain ?? null,
          );
          highGround = null;
          if (raster) {
            const tile = document.createElement("canvas");
            tile.width = raster.width;
            tile.height = raster.height;
            const tileContext = tile.getContext("2d");
            if (tileContext) {
              const pixels = tileContext.createImageData(
                raster.width,
                raster.height,
              );
              pixels.data.set(raster.pixels);
              tileContext.putImageData(pixels, 0, 0);
              highGround = { canvas: tile, raster };
            }
          }
        }
        canvas.dataset.highGround =
          showHighGround && highGround ? "visible" : "hidden";
        if (showHighGround && highGround) {
          const { raster, canvas: tile } = highGround;
          const a = screen({
            x: raster.origin.x,
            y: raster.origin.y + raster.height * raster.cell,
          });
          const b = screen({
            x: raster.origin.x + raster.width * raster.cell,
            y: raster.origin.y,
          });
          ctx.save();
          ctx.beginPath();
          ctx.rect(
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y,
          );
          ctx.clip();
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(tile, a.x, a.y, b.x - a.x, b.y - a.y);
          ctx.restore();
        }
        if (layers.has("camp") && !query.trim())
          for (const zone of data.zones ?? []) drawZone(zone, false);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const viewport = {
          width: width + padding * 2,
          height: height + padding * 2,
          scale,
          dpr,
        };
        canvas.dataset.noWard =
          showHighGround && noWardCells.length ? "visible" : "hidden";
        const noWardTilesDrawn = showHighGround
          ? paintGrid(ctx, noWardPaint, treeGrid, camera.current, viewport, {
              fill: "#e25bb780",
              border: "#fca5e1",
              width: 0.65,
              innerAlpha: 0.1,
            })
          : 0;
        const treeTilesDrawn = paintGrid(
          ctx,
          treePaint,
          treeGrid,
          camera.current,
          viewport,
          { fill: MAP_LAYERS.tree.color, border: "#183127" },
        );
        const buildingTilesDrawn = paintGrid(
          ctx,
          buildingPaint,
          treeGrid,
          camera.current,
          viewport,
          { fill: "#dfb27180", border: "#493922" },
        );
        canvas.dataset.gridTilesDrawn = String(
          treeTilesDrawn + buildingTilesDrawn + noWardTilesDrawn,
        );
        for (const p of markers) drawMarker(p, false);
        for (const [id, labels] of campLabels) drawCampLabel(id, labels, false);
      }
      ctx = output!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const translated = shift();
      ctx.drawImage(
        background,
        (translated.x - backgroundPadding) * dpr,
        (translated.y - backgroundPadding) * dpr,
      );
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawVision(
        ctx,
        sightFrame.current.sight,
        sightFrame.current.texture,
        screen,
        data,
        visionDrag ?? undefined,
        hoveredSourceRef.current,
      );
      const heroHover = hoveredHeroRef.current;
      if (heroHover && heroHoverCardRef.current) {
        const at = screen(heroHover.source);
        const footprint = heroVisionFootprint(
          heroHover.source,
          heroHover.preset.collisionRadius,
          sightFrame.current.sight.gridBounds,
        );
        const baseSize = footprint
          ? Math.min(
              footprint.bounds.maxX - footprint.bounds.minX,
              footprint.bounds.maxY - footprint.bounds.minY,
            ) *
            scale *
            camera.current.zoom
          : Math.max(20, 64 * scale * camera.current.zoom);
        const iconSize = visionHeroIconSize(baseSize, true);
        const card = heroHoverCardRef.current;
        const cardWidth = card.offsetWidth || 176;
        const cardHeight = card.offsetHeight || 112;
        const right = at.x + iconSize / 2 + 12;
        const left = at.x - iconSize / 2 - 12 - cardWidth;
        const fitsRight = right + cardWidth <= width - 8;
        const fitsLeft = left >= 8;
        const x = fitsRight ? right : fitsLeft ? left : at.x - cardWidth / 2;
        let y =
          fitsRight || fitsLeft
            ? at.y - cardHeight / 2
            : at.y - iconSize / 2 - 12 - cardHeight;
        if (y < 8) y = at.y + iconSize / 2 + 12;
        card.style.left = `${Math.max(8, Math.min(width - cardWidth - 8, x))}px`;
        card.style.top = `${Math.max(8, Math.min(height - cardHeight - 8, y))}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (layers.has("camp")) {
        for (const zone of data.zones ?? []) {
          const activeCamp = activeCampVolumes.get(
            zone.label.replace(/^\[PR#\]/, ""),
          );
          const active = campLayerHover || !!activeCamp;
          if (query.trim() && !active) continue;
          if (active) activeZones.push(zone);
        }
      }
      const vision = selected ? data.visions?.[selected.id] : undefined;
      if (selected && vision && visible.some((p) => p.id === selected.id)) {
        const at = screen(selected);
        ctx.save();
        for (const [value, color, dash] of [
          [vision.day, "#ffd478", []],
          [vision.night, "#b8b0ff", [5, 4]],
        ] as [number, string, number[]][]) {
          if (value <= 0) continue;
          ctx.beginPath();
          ctx.arc(
            at.x,
            at.y,
            value * scale * camera.current.zoom,
            0,
            Math.PI * 2,
          );
          ctx.strokeStyle = "#07131f";
          ctx.lineWidth = 4;
          ctx.setLineDash(dash);
          ctx.stroke();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        ctx.restore();
      }
      if (selected && range > 0 && visible.some((p) => p.id === selected.id)) {
        const s = screen(selected),
          radius = range * scale * camera.current.zoom;
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = "#c5def015";
        ctx.fill();
        ctx.strokeStyle = "#c5def099";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      const activePoints = new Set([
        byId.get(selected?.id ?? ""),
        byId.get(hoverId ?? ""),
        ...(hoveredLayer ? visible.filter((p) => p.kind === hoveredLayer) : []),
      ]);
      for (const p of activePoints) if (p) drawMarker(p, true);
      // Selected and hovered camps share the same foreground emphasis.
      if (showLanes) {
        ctx.save();
        ctx.setLineDash([]);
        ctx.lineJoin = "round";
        for (const route of data.lanePaths ?? []) {
          if (!laneHover.current.includes(route.id)) continue;
          ctx.beginPath();
          route.vertices.forEach((v, i) => {
            const p = screen(v);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.strokeStyle = "#07151eee";
          ctx.lineWidth = 6;
          ctx.stroke();
          ctx.strokeStyle = route.team === "radiant" ? "#b3ffcf" : "#ffc3b3";
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
        ctx.restore();
      }
      for (const zone of activeZones) drawZone(zone, true);
      for (const [id, labels] of campLabels)
        if (campLayerHover || (byId.has(id) && activeCamps.has(byId.get(id)!)))
          drawCampLabel(id, labels, true);
      const routing = routeFrame.current;
      if (routing.enabled) {
        ctx.save();
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        for (const { route, active } of routing.overlays) {
          ctx.globalAlpha = active ? 1 : 0.48;
          const color = routeColor(route);
          ctx.setLineDash(route.kind === "gate" ? [7, 4] : []);
          for (const leg of route.legs) {
            ctx.beginPath();
            leg.forEach((p, i) => {
              const at = screen(p);
              if (i) ctx.lineTo(at.x, at.y);
              else ctx.moveTo(at.x, at.y);
            });
            ctx.strokeStyle = "#07131f";
            ctx.lineWidth = active ? 5 : 3;
            ctx.stroke();
            ctx.strokeStyle = color;
            ctx.lineWidth = active ? 2.5 : 1.5;
            ctx.stroke();
          }
          if (route.legs.length === 2) {
            const a = screen(route.legs[0].at(-1)!),
              b = screen(route.legs[1][0]);
            ctx.setLineDash([5, 8]);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        routing.points.forEach((p, i) => {
          const at = screen(p);
          ctx.fillStyle = "#f4eed7";
          ctx.beginPath();
          ctx.arc(at.x, at.y, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#111b25";
          ctx.font = "bold 12px system-ui";
          ctx.fillText(i ? "B" : "A", at.x, at.y);
        });
        for (const m of routing.markers) {
          const at = screen(m.position);
          ctx.fillStyle = routeColor(m.route);
          ctx.beginPath();
          ctx.arc(at.x, at.y, m.channeling ? 9 : 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.restore();
      }
      // A 1/2/5 ruler in actual world units within the fixed viewport hint.
      const rawUnits = 80 / (scale * camera.current.zoom),
        power = 10 ** Math.floor(Math.log10(rawUnits));
      const units =
        [5, 2, 1].map((n) => n * power).find((n) => n <= rawUnits) ?? power;
      if (rulerLabelRef.current)
        rulerLabelRef.current.textContent = t("{value0} 单位", {
          value0: units,
        });
      if (rulerRef.current)
        rulerRef.current.style.width = `${units * scale * camera.current.zoom}px`;
      // Active labels are the final canvas pass: no later marker or overlay may cover them.
      for (const p of new Set([
        byId.get(selected?.id ?? ""),
        byId.get(hoverId ?? ""),
      ])) {
        if (!p) continue;
        const at = screen(p);
        ctx.font = "12px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const half = textWidth(mapPointLabel(p, locale)) / 2 + 6;
        const x = Math.max(half + 2, Math.min(width - half - 2, at.x));
        const y = Math.max(12, Math.min(height - 12, at.y + 23));
        ctx.fillStyle = "#091219f2";
        ctx.fillRect(x - half, y - 10, half * 2, 20);
        ctx.fillStyle = "#fff1c8";
        ctx.fillText(mapPointLabel(p, locale), x, y);
      }
      if (pointerHint && routing.enabled && routing.drafting) {
        ctx.save();
        ctx.font = "11px system-ui";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const worldPoint = world(pointerHint),
          allowed = routing.canPick(worldPoint),
          cell = cellAt(treeGrid, worldPoint);
        const hint = allowed
          ? routing.points.length === 0
            ? t("点击设置起点 A")
            : t("点击设置终点 B")
          : t("不可通行，请换个位置");
        const color = allowed ? "#b9f4ff" : "#ffc0ae";
        if (cell >= 0) {
          const at = screen({
            x: treeGrid.x + (cell % treeGrid.width) * treeGrid.cell,
            y:
              treeGrid.y +
              (Math.floor(cell / treeGrid.width) + 1) * treeGrid.cell,
          });
          const side = treeGrid.cell * scale * camera.current.zoom;
          ctx.fillStyle = allowed ? "#b9f4ff18" : "#ffac9425";
          ctx.fillRect(at.x, at.y, side, side);
          ctx.strokeStyle = "#091822";
          ctx.lineWidth = 2;
          ctx.strokeRect(at.x, at.y, side, side);
          ctx.strokeStyle = color;
          ctx.lineWidth = 0.75;
          ctx.strokeRect(at.x, at.y, side, side);
          canvas.dataset.pickCell = String(cell);
        } else delete canvas.dataset.pickCell;
        // Keep the exact click visible; the cell outline is guidance, not snapping.
        ctx.beginPath();
        ctx.arc(pointerHint.x, pointerHint.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        const label = allowed
          ? t("{value0} · {value1}, {value2}", {
              value0: routing.points.length ? t("B 终点") : t("A 起点"),
              value1: Math.round(worldPoint.x),
              value2: Math.round(worldPoint.y),
            })
          : t("不可通行");
        if (pickHintRef.current) {
          pickHintRef.current.textContent = label;
          pickHintRef.current.style.color = color;
        }
        ctx.restore();
        canvas.dataset.pickHint = hint;
      } else {
        if (pickHintRef.current) pickHintRef.current.textContent = "";
        delete canvas.dataset.pickHint;
        delete canvas.dataset.pickCell;
      }
      canvas.dataset.paints = String(++paints);
      canvas.dataset.backgroundBuilds = String(backgroundBuilds);
      canvas.dataset.hitTests = String(hitTests);
      const zoomText = `${Math.round(camera.current.zoom * 100)}%`;
      if (zoomLabelRef.current && zoomLabelRef.current.textContent !== zoomText)
        zoomLabelRef.current.textContent = zoomText;
      canvas.dataset.zoom = String(camera.current.zoom);
      canvas.dataset.cameraX = String(camera.current.x);
      canvas.dataset.cameraY = String(camera.current.y);
      invalidateRect();
      canvas.dataset.drawMs = (performance.now() - started).toFixed(2);
    }
    const schedule = (paint = true) => {
      paintNeeded ||= paint;
      if (!frame) frame = requestAnimationFrame(draw);
    };
    redraw.current = schedule;
    const resize = () => {
      invalidateRect();
      width = host.clientWidth;
      height = host.clientHeight;
      if (width <= 0 || height <= 0) return;
      // Resize the backing store only inside the next complete paint. Assigning
      // canvas.width/height, even unchanged, clears it and caused state flashes.
      scale = fitScale(data.bounds, width, height);
      schedule();
    };
    const point = (e: MouseEvent | PointerEvent) => {
      const rect = eventRect ?? (eventRect = canvas.getBoundingClientRect());
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const hit = (p: Position) => {
      hitTests++;
      const w = world(p),
        radius =
          (data.mapIcons
            ? Math.max(14, 14 * Math.min(2, Math.sqrt(camera.current.zoom)))
            : 14) /
          (scale * camera.current.zoom);
      let closest: MapPoint | null = null,
        best = Infinity;
      for (const item of [
        ...lookup(w.x, w.y, radius),
        ...(treesAtCell.get(cellAt(treeGrid, w)) ?? []),
      ]) {
        const distance = (item.x - w.x) ** 2 + (item.y - w.y) ** 2;
        if (distance < best) {
          closest = item;
          best = distance;
        }
      }
      return closest;
    };
    const down = (e: PointerEvent) => {
      const hitSource = sourceAt(point(e));
      leave();
      if (e.button !== 0) return;
      if (
        visionDrag &&
        e.pointerType === "touch" &&
        e.pointerId !== visionDrag.pointerId
      ) {
        const firstId = visionDrag.pointerId,
          first = pointers.get(firstId);
        cancelVisionDrag();
        if (first) pointers.set(firstId, first);
      }
      if (visionDrag) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(e.pointerId);
      const p = point(e);
      pointers.set(e.pointerId, p);
      last = p;
      if (pointers.size === 1) dragged = false;
      else {
        dragged = true;
        touchAcceleration.reset();
      }
      const source = pointers.size === 1 ? hitSource : null;
      if (source) {
        visionDrag = {
          id: source.id,
          pointerId: e.pointerId,
          start: p,
          original: { x: source.x, y: source.y },
          position: { x: source.x, y: source.y },
          moving: false,
          selectionOnly: e.shiftKey,
        };
        sightFrame.current.sight.selectSource(source.id, e.shiftKey);
        setSelected(null);
        schedule();
      }
    };
    const move = (e: PointerEvent) => {
      const p = point(e);
      if (visionDrag && visionDrag.pointerId === e.pointerId) {
        if (visionDrag.selectionOnly) return;
        if (
          !visionDrag.moving &&
          Math.hypot(p.x - visionDrag.start.x, p.y - visionDrag.start.y) <= 3
        )
          return;
        if (!visionDrag.moving) sightFrame.current.sight.beginDrag();
        visionDrag.moving = true;
        const start = world(visionDrag.start),
          current = world(p);
        visionDrag.position = {
          x: visionDrag.original.x + current.x - start.x,
          y: visionDrag.original.y + current.y - start.y,
        };
        queuePreview({ id: visionDrag.id, position: visionDrag.position });
        canvas.style.cursor = sightFrame.current.sight.placementIssue(
          visionDrag.position,
          sightFrame.current.sight.sources.find((s) => s.id === visionDrag!.id)
            ?.kind,
        )
          ? "not-allowed"
          : "default";
        schedule();
        return;
      }
      const planner = sightFrame.current.sight;
      if (
        !pointers.size &&
        planner.enabled &&
        (planner.tool === "add" ||
          planner.sources.some((source) => source.id === planner.tool)) &&
        !sourceAt(p)
      ) {
        const at = world(p);
        queuePreview(
          at.x >= data.bounds.minX &&
            at.x < data.bounds.maxX &&
            at.y >= data.bounds.minY &&
            at.y < data.bounds.maxY
            ? {
                id: planner.tool === "add" ? "cursor" : planner.tool!,
                position: { x: Math.round(at.x), y: Math.round(at.y) },
              }
            : null,
        );
      } else if (!pointers.size) queuePreview(null);
      if (pointers.has(e.pointerId)) {
        const before = [...pointers.values()];
        pointers.set(e.pointerId, p);
        const after = [...pointers.values()];
        if (after.length === 2) {
          const distance = (a: Position[]) =>
            Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
          const center = {
            x: (after[0].x + after[1].x) / 2,
            y: (after[0].y + after[1].y) / 2,
          };
          if (distance(before) > 0) {
            const previousCenter = {
              x: (before[0].x + before[1].x) / 2,
              y: (before[0].y + before[1].y) / 2,
            };
            const anchor = world(previousCenter);
            camera.current = zoomAt(
              camera.current,
              Math.exp(
                Math.log(distance(after) / distance(before)) *
                  touchAcceleration.gain(
                    Math.log(distance(after) / distance(before)),
                    e.timeStamp,
                  ),
              ),
              center.x,
              center.y,
              scale,
              width,
              height,
            );
            const moved = world(center);
            camera.current.x += anchor.x - moved.x;
            camera.current.y += anchor.y - moved.y;
          }
          dragged = true;
        } else if (last) {
          const dx = p.x - last.x,
            dy = p.y - last.y;
          if (Math.hypot(dx, dy) > 1) dragged = true;
          camera.current.x -= dx / (scale * camera.current.zoom);
          camera.current.y += dy / (scale * camera.current.zoom);
        }
        last = p;
        constrain();
        schedule();
        return;
      }
      pendingHover = p;
      pointerHint = p;
      schedule(routeFrame.current.enabled && routeFrame.current.drafting);
    };
    function updateHover(p: Position) {
      const adding =
        sightFrame.current.sight.enabled &&
        sightFrame.current.sight.tool === "add";
      const source = sourceAt(p);
      if (hoveredSourceRef.current !== (source?.id ?? null)) {
        hoveredSourceRef.current = source?.id ?? null;
        canvas!.dataset.hoveredVisionSource = source?.id ?? "";
        paintNeeded = true;
      }
      const hero = source?.kind === "hero" ? source : null;
      const preset = hero
        ? sightFrame.current.sight.presets.find((p) => p.key === hero.presetKey)
        : null;
      if ((hoveredHeroRef.current?.source.id ?? null) !== (hero?.id ?? null)) {
        hoveredHeroRef.current =
          hero && preset ? { source: hero, preset } : null;
        setHoveredHero(hoveredHeroRef.current);
        paintNeeded = true;
      }
      const target = adding || source ? null : hit(p);
      const candidates =
        !adding &&
        !source &&
        !target &&
        !routeFrame.current.enabled &&
        live.current.showLanes
          ? (data.lanePaths ?? [])
              .map((route) => ({
                id: route.id,
                distance:
                  distanceToPath(world(p), route.vertices) *
                  scale *
                  camera.current.zoom,
              }))
              .filter((r) => r.distance <= 7)
              .sort((a, b) => a.distance - b.distance)
          : [];
      // At overlapping paths retain both armies, rather than arbitrarily hiding one.
      const laneIds = candidates
        .filter((r) => r.distance <= candidates[0].distance + 1)
        .map((r) => r.id);
      if (laneIds.join() !== laneHover.current.join()) {
        laneHover.current = laneIds;
        setHoveredLanes(laneIds);
        paintNeeded = true;
      }
      if ((target?.id ?? null) !== hoverId) {
        hoverId = target?.id ?? null;
        hoverPointRef.current = target;
        setHovered(target);
        paintNeeded = true;
      }
      const planner = sightFrame.current.sight;
      const movingSource = planner.sources.find((s) => s.id === planner.tool);
      const placing =
        planner.enabled && (planner.tool === "add" || !!movingSource);
      canvas!.style.cursor =
        placing && planner.placementIssue(world(p), movingSource?.kind)
          ? "not-allowed"
          : (planner.enabled && planner.tool !== null) ||
              (routeFrame.current.enabled && routeFrame.current.drafting)
            ? "crosshair"
            : "default";
    }
    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      if (visionDrag && visionDrag.pointerId === e.pointerId) {
        queuePreview(null);
        const drag = visionDrag;
        visionDrag = null;
        pointers.delete(e.pointerId);
        if (drag.moving)
          sightFrame.current.sight.endDrag(
            drag.id,
            e.type === "pointercancel" ? undefined : drag.position,
          );
        last = null;
        canvas.style.cursor = "default";
        schedule();
        return;
      }
      pointers.delete(e.pointerId);
      if (e.type === "pointerup" && !dragged) {
        const position = world(point(e));
        const rounded = {
          x: Math.round(position.x),
          y: Math.round(position.y),
        };
        if (
          rounded.x >= data.bounds.minX &&
          rounded.x < data.bounds.maxX &&
          rounded.y >= data.bounds.minY &&
          rounded.y < data.bounds.maxY &&
          sightFrame.current.sight.pick(rounded, hit(point(e)))
        ) {
          schedule();
        } else if (routeFrame.current.enabled) {
          const w = world(point(e));
          const routing = routeFrame.current;
          const inside =
            w.x >= data.bounds.minX &&
            w.x <= data.bounds.maxX &&
            w.y >= data.bounds.minY &&
            w.y <= data.bounds.maxY;
          if (routing.drafting && routing.points.length === 1) {
            if (inside) routing.pick(w);
          } else {
            const candidates = routing.overlays
              .map((o) => ({
                id: o.id,
                variant: routeKey(o.route),
                active: o.active,
                d: Math.min(
                  ...o.route.legs.map((leg) => distanceToPath(w, leg)),
                  ...(o.route.legs.length === 2
                    ? [
                        distanceToPath(w, [
                          o.route.legs[0].at(-1)!,
                          o.route.legs[1][0],
                        ]),
                      ]
                    : []),
                ),
              }))
              .filter((o) => o.d * scale * camera.current.zoom <= 8)
              .sort((a, b) => a.d - b.d);
            const nearest = candidates[0]?.d ?? Infinity;
            const hits = candidates
              .filter((c) => (c.d - nearest) * scale * camera.current.zoom < 2)
              .sort(
                (a, b) => a.id - b.id || a.variant.localeCompare(b.variant),
              );
            const candidate =
              hits[(hits.findIndex((c) => c.active) + 1) % hits.length];
            if (candidate) routing.selectRoute(candidate.id, candidate.variant);
            else if (!routing.drafting) routing.clear();
            else if (inside) routing.pick(w);
          }
          setSelected(null);
          pointerHint = point(e);
          schedule();
        } else {
          const sight = sightFrame.current.sight;
          if (sight.enabled && sight.tool === null && !e.shiftKey)
            sight.selectSource(null);
          setSelected(hit(point(e)));
        }
      }
      last = pointers.values().next().value ?? null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (visionDrag || width <= 0 || height <= 0) return;
      leave();
      const delta = wheelPixels(e, { width, height });
      if (e.ctrlKey || e.metaKey) {
        const p = point(e);
        const amount = Math.max(-80, Math.min(80, delta.y));
        const gain = pinchAcceleration.gain(amount, e.timeStamp);
        camera.current = zoomAt(
          camera.current,
          Math.exp(-amount * (e.metaKey || controlHeld ? 0.016 : 0.008) * gain),
          p.x,
          p.y,
          scale,
          width,
          height,
        );
      } else {
        pinchAcceleration.reset();
        // Native trackpad scrolling already supplies momentum; do not add a second spring.
        camera.current.x += delta.x / (scale * camera.current.zoom);
        camera.current.y -= delta.y / (scale * camera.current.zoom);
      }
      constrain();
      schedule();
    };
    const reset = () => {
      leave();
      camera.current = {
        x: (data.bounds.minX + data.bounds.maxX) / 2,
        y: (data.bounds.minY + data.bounds.maxY) / 2,
        zoom: 1,
      };
      schedule();
    };
    const zoomBy = (factor: number) => {
      leave();
      camera.current = zoomAt(
        camera.current,
        factor,
        width / 2,
        height / 2,
        scale,
        width,
        height,
      );
      schedule();
    };
    const key = (e: KeyboardEvent) => {
      if (visionDrag) {
        e.preventDefault();
        return;
      }
      if (
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "+",
          "=",
          "-",
          "0",
          "Escape",
        ].includes(e.key)
      )
        e.preventDefault();
      if (e.key === "0") reset();
      else if (e.key === "+" || e.key === "=") zoomBy(1.5);
      else if (e.key === "-") zoomBy(1 / 1.5);
      else if (e.key === "Escape") {
        sightFrame.current.sight.stop();
        setSelected(null);
        if (routeFrame.current.enabled) routeFrame.current.stop();
      } else {
        leave();
        const step = 70 / (scale * camera.current.zoom);
        if (e.key === "ArrowLeft") camera.current.x -= step;
        if (e.key === "ArrowRight") camera.current.x += step;
        if (e.key === "ArrowUp") camera.current.y += step;
        if (e.key === "ArrowDown") camera.current.y -= step;
        constrain();
        schedule();
      }
    };
    const leave = () => {
      if (hoveredSourceRef.current) {
        hoveredSourceRef.current = null;
        canvas.dataset.hoveredVisionSource = "";
        schedule();
      }
      if (hoveredHeroRef.current) {
        hoveredHeroRef.current = null;
        setHoveredHero(null);
        schedule();
      }
      if (!visionDrag) queuePreview(null);
      if (pointerHint) {
        pointerHint = null;
        schedule();
      }
      pendingHover = null;
      if (hoverId !== null || laneHover.current.length) {
        hoverId = null;
        hoverPointRef.current = null;
        setHovered(null);
        laneHover.current = [];
        setHoveredLanes([]);
        schedule();
      }
    };
    controls.current = {
      reset,
      zoom: zoomBy,
      hover: (p) => {
        if (
          sightFrame.current.sight.enabled &&
          sightFrame.current.sight.tool === "add"
        )
          p = null;
        pendingHover = null;
        if (hoverId === (p?.id ?? null) && !laneHover.current.length) return;
        hoverId = p?.id ?? null;
        hoverPointRef.current = p;
        setHovered(p);
        laneHover.current = [];
        setHoveredLanes([]);
        schedule();
      },
      focus: (p) => {
        camera.current = {
          x: p.x,
          y: p.y,
          zoom: Math.max(3, camera.current.zoom),
        };
        setSelected(p);
        schedule();
      },
    };
    const exitTool = (e: KeyboardEvent | MouseEvent) => {
      const escape = e.type === "keydown";
      if (escape && (e as KeyboardEvent).key !== "Escape") return;
      if (visionDrag) {
        e.preventDefault();
        e.stopPropagation();
        cancelVisionDrag();
        return;
      }
      const sight = sightFrame.current.sight;
      const interaction = routeFrame.current.enabled || sight.tool;
      if (
        !interaction &&
        !(escape && (sight.enabled || live.current.terrainLayer))
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      if (interaction) {
        sight.stop();
        routeFrame.current.stop();
      } else if (sight.enabled) {
        sight.toggle();
      } else {
        setTerrainLayer("");
      }
      pointers.clear();
      leave();
      canvas!.style.cursor = "default";
    };
    const shortcut = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.repeat ||
        e.isComposing ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        visionDrag ||
        pointers.size ||
        (e.target instanceof Element &&
          e.target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="listbox"]',
          ))
      )
        return;
      const key = e.key.toLowerCase();
      if (key === "delete" || key === "backspace") {
        const sight = sightFrame.current.sight;
        if (
          !sight.enabled ||
          sight.tool !== null ||
          routeFrame.current.enabled ||
          !sight.visibleSources.some((source) =>
            sight.selectedSources.includes(source.id),
          )
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        sight.removeSelected();
        leave();
        return;
      }
      const terrain = (
        { "1": "", "2": "navigation", "3": "height" } as Record<string, string>
      )[key];
      if (terrain !== undefined && sightFrame.current.sight.enabled) {
        const kind = ({ "1": "observer", "2": "sentry", "3": "hero" } as const)[
          key as "1" | "2" | "3"
        ];
        routeFrame.current.stop();
        sightFrame.current.sight.togglePlacement(kind);
      } else if (terrain !== undefined) {
        if (
          terrain &&
          !data.rasterLayers?.some((layer) => layer.id === terrain)
        )
          return;
        setTerrainLayer(terrain);
      } else if (key === "q" && data.visionScene) {
        if (!sightFrame.current.sight.enabled)
          sightFrame.current.sight.toggle();
        routeFrame.current.stop();
      } else if (key === "w") {
        sightFrame.current.sight.stop();
        if (!routeFrame.current.enabled) routeFrame.current.toggle();
      } else return;
      e.preventDefault();
      e.stopPropagation();
      leave();
    };
    document.addEventListener("keydown", modifiers, true);
    document.addEventListener("keyup", modifiers, true);
    window.addEventListener("blur", clearModifiers);
    document.addEventListener("keydown", shortcut);
    document.addEventListener("keydown", exitTool, true);
    document.addEventListener("contextmenu", exitTool);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("scroll", invalidateRect, {
      capture: true,
      passive: true,
    });
    canvas.addEventListener("keydown", key);
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    return () => {
      if (previewTimer) clearTimeout(previewTimer);
      document.removeEventListener("keydown", modifiers, true);
      document.removeEventListener("keyup", modifiers, true);
      window.removeEventListener("blur", clearModifiers);
      document.removeEventListener("keydown", shortcut);
      document.removeEventListener("keydown", exitTool, true);
      document.removeEventListener("contextmenu", exitTool);
      observer.disconnect();
      cancelAnimationFrame(frame);
      redraw.current = () => {};
      controls.current = null;
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
      window.removeEventListener("scroll", invalidateRect, true);
      canvas.removeEventListener("keydown", key);
    };
  }, [
    data,
    visible,
    buildingBlocks,
    treeBlocks,
    treeGrid,
    currents,
    t,
    locale,
  ]);
  const pointRows = useMemo(
    () =>
      visible.slice(0, 80).map((p) => (
        <li key={p.id}>
          <button
            className="w-full truncate rounded px-2 py-1 text-left text-[11px] hover:bg-white/5"
            onClick={() => focusPoint(p)}
            onPointerEnter={() => hoverPoint(p)}
            onPointerLeave={() => hoverPoint(null)}
            onFocus={() => hoverPoint(p)}
            onBlur={() => hoverPoint(null)}
          >
            {mapPointLabel(p, locale)}{" "}
            <span className="text-[10px] text-[var(--text-muted)]">
              {Math.round(p.x)}, {Math.round(p.y)}
            </span>
          </button>
        </li>
      )),
    [visible, focusPoint, hoverPoint, locale],
  );
  const hoveredCamp = data.economy?.camps.find(
    (c) => c.pointId === hovered?.id,
  );
  const hoveredCampLabels = campLabels.get(hovered?.id ?? "");
  const lanePreviews =
    showLanes && !planner.enabled
      ? (data.lanePaths ?? [])
          .filter((r) => hoveredLanes.includes(r.id))
          .map((route) => ({
            route,
            wave: data.economy
              ? laneWave(data.economy, time, barracks, route.team)
              : null,
          }))
      : [];
  return (
    <div>
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_200px]">
        <div className="min-w-0">
          <div
            className={`map-stage grid ${locale === "en" ? "grid-cols-[104px_minmax(0,1fr)]" : "grid-cols-[64px_minmax(0,1fr)]"} grid-rows-[auto_auto] items-stretch gap-x-1 gap-y-1`}
          >
            <div className="map-time-controls col-start-2 row-start-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded bg-white/[0.025] px-2 py-0.5 text-[11px]">
              {data.economy && (
                <>
                  <div className="flex min-w-0 flex-[1_1_320px] flex-wrap items-center gap-x-3 gap-y-1">
                    <CompactSelect
                      hideLabel
                      label={t("地图兵营情景")}
                      className="map-select"
                      value={barracks}
                      onValueChange={(value) =>
                        setBarracks(value as BarracksState)
                      }
                    >
                      {Object.entries(BARRACKS_LABELS).map(([v, label]) => (
                        <option key={v} value={v}>
                          {t(label)}
                        </option>
                      ))}
                    </CompactSelect>
                    <label className="flex min-w-0 flex-[1_1_160px] items-center gap-2">
                      <Message
                        id="游戏时间 {value0}{value1}"
                        values={{
                          value0: (
                            <strong className="w-12 tabular-nums">
                              {clockText(time)}
                            </strong>
                          ),
                          value1: (
                            <input
                              className="min-w-20 flex-1 accent-[#a4c5bc]"
                              type="range"
                              aria-label={t("游戏时间")}
                              min={0}
                              max={7200}
                              step={30}
                              value={time}
                              onChange={(e) => setTime(Number(e.target.value))}
                            />
                          ),
                        }}
                      />
                    </label>
                    <CompactSelect
                      hideLabel
                      label={t("跳转游戏时间")}
                      className="map-select"
                      value={time}
                      onValueChange={(value) => setTime(Number(value))}
                    >
                      {![
                        0, 120, 300, 450, 900, 1800, 2400, 2700, 3600, 7200,
                      ].includes(time) && (
                        <option value={time}>{clockText(time)}</option>
                      )}
                      {[
                        0, 120, 300, 450, 900, 1800, 2400, 2700, 3600, 7200,
                      ].map((t) => (
                        <option key={t} value={t}>
                          {clockText(t)}
                        </option>
                      ))}
                    </CompactSelect>
                  </div>
                  <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 border-l border-white/15 pl-3">
                    <label className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-none">
                      <Message
                        id="{value0}野区金币"
                        values={{
                          value0: (
                            <input
                              type="checkbox"
                              className="m-0 size-3.5 shrink-0"
                              checked={showGold}
                              onChange={(e) => setShowGold(e.target.checked)}
                            />
                          ),
                        }}
                      />
                    </label>
                    <label className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-none">
                      <Message
                        id="{value0}野区经验"
                        values={{
                          value0: (
                            <input
                              type="checkbox"
                              className="m-0 size-3.5 shrink-0"
                              checked={showExperience}
                              onChange={(e) =>
                                setShowExperience(e.target.checked)
                              }
                            />
                          ),
                        }}
                      />
                    </label>
                    <label className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-none">
                      <Message
                        id="{value0}拉野/叠野秒数"
                        values={{
                          value0: (
                            <input
                              type="checkbox"
                              className="m-0 size-3.5 shrink-0"
                              checked={showTimings}
                              onChange={(e) => setShowTimings(e.target.checked)}
                            />
                          ),
                        }}
                      />
                    </label>
                  </div>
                  <div className="flex items-center border-l border-white/15 pl-3">
                    <label className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-none">
                      <Message
                        id="{value0}兵线路径"
                        values={{
                          value0: (
                            <input
                              type="checkbox"
                              className="m-0 size-3.5 shrink-0"
                              checked={showLanes}
                              onChange={(e) => setShowLanes(e.target.checked)}
                            />
                          ),
                        }}
                      />
                    </label>
                  </div>
                </>
              )}
              {!!data.routing?.currents?.length && (
                <label className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-l border-white/15 pl-3 leading-none">
                  <input
                    type="checkbox"
                    role="switch"
                    className="m-0 size-3.5 shrink-0"
                    checked={showCurrents}
                    onChange={(e) => setShowCurrents(e.target.checked)}
                  />
                  {t("湍流")}
                </label>
              )}
              {versionControls}
            </div>

            <div
              ref={surfaceRef}
              className="map-viewport col-start-2 row-start-2 relative h-[70vh] min-h-[400px] overflow-hidden rounded bg-[#0b131a] sm:h-[calc(100dvh-96px)]"
              aria-label={t("地图视口")}
            >
              <canvas
                ref={canvasRef}
                tabIndex={0}
                aria-label={t(
                  "交互地图；方向键平移，加减号缩放，0复位，Escape清除选择",
                )}
                className="block h-full w-full touch-none"
              />
              {hoveredHero && (
                <div
                  ref={heroHoverCardRef}
                  role="tooltip"
                  aria-label={t("英雄视野信息")}
                  className="pointer-events-none absolute z-20 w-44 max-w-[calc(100%-16px)] rounded bg-[#101d28f2] p-2 text-[11px] leading-5 shadow-lg"
                >
                  <strong className="block text-[12px]">
                    {locale === "en"
                      ? hoveredHero.preset.enName
                      : hoveredHero.preset.zhName}
                  </strong>
                  <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 tabular-nums">
                    <dt className="text-[var(--text-muted)]">
                      {t("白天视野")}
                    </dt>
                    <dd>{formatNumber(locale, hoveredHero.source.day)}</dd>
                    <dt className="text-[var(--text-muted)]">
                      {t("夜晚视野")}
                    </dt>
                    <dd>{formatNumber(locale, hoveredHero.source.night)}</dd>
                    <dt className="text-[var(--text-muted)]">
                      {t("初始移速")}
                    </dt>
                    <dd>
                      {hoveredHero.preset.baseMovementSpeed == null
                        ? t("未知")
                        : formatNumber(
                            locale,
                            hoveredHero.preset.baseMovementSpeed,
                          )}
                    </dd>
                  </dl>
                </div>
              )}
              <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
                <HoverTooltip
                  className="grid size-5 place-items-center rounded-full border border-white/25 text-[10px] text-[#c9d7e2] hover:bg-white/10"
                  content={
                    <div className="text-xs leading-6">
                      <p>
                        {t(
                          "双指滑动平移，捏合缩放；按住 Ctrl／⌘ 滑动可快速缩放，持续同向缩放会加速。",
                        )}
                      </p>
                      <p>
                        {t(
                          "1 / 2 / 3：底图 / 导航栅格 / 地面高度；视野开启时改为侦查守卫 / 岗哨守卫 / 英雄。Q / W：视野 / 寻路。",
                        )}
                      </p>
                      <p>{t("右键或 Esc 退出当前工具。")}</p>
                      <p>
                        {t(
                          "寻路：点击路径或路线按钮选中，点击空白回到新建路线；Delete / Backspace 删除所选路线。",
                        )}
                      </p>
                    </div>
                  }
                >
                  <span aria-hidden="true">?</span>
                  <span className="sr-only">{t("地图操作说明")}</span>
                </HoverTooltip>
                <div
                  className="map-zoom-controls w-20 rounded bg-[#0b131acc]"
                  aria-label={t("地图缩放")}
                >
                  <div className="grid h-6 w-full grid-cols-[20px_minmax(0,1fr)_20px] items-center">
                    <button
                      className="grid h-6 place-items-center rounded text-xs leading-none hover:bg-white/5"
                      onClick={() => controls.current?.zoom(1 / 1.5)}
                      aria-label={t("缩小地图")}
                    >
                      −
                    </button>
                    <button
                      className="h-6 min-w-0 rounded text-center text-[10px] leading-none tracking-tight tabular-nums hover:bg-white/5"
                      ref={zoomLabelRef}
                      aria-label={t("缩放比例")}
                      title={t("复位地图（0）")}
                      onClick={() => controls.current?.reset()}
                    >
                      100%
                    </button>
                    <button
                      className="grid h-6 place-items-center rounded text-xs leading-none hover:bg-white/5"
                      onClick={() => controls.current?.zoom(1.5)}
                      aria-label={t("放大地图")}
                    >
                      ＋
                    </button>
                  </div>
                </div>
              </div>
              {(!data.imageUrl || imageError) && (
                <div className="pointer-events-none absolute inset-0 grid place-content-center px-8 text-center">
                  <div className="max-w-sm rounded bg-[#101a22ee] p-6">
                    <h2 className="text-sm font-medium">
                      {imageError
                        ? t("地图底图加载失败")
                        : t("等待原生地图资源")}
                    </h2>
                    <p
                      role="status"
                      className="mt-2 text-xs leading-6 text-[var(--text-muted)]"
                    >
                      {imageError
                        ? t("请检查地图资源是否完整，再重新加载页面。")
                        : t(
                            "已读取当前版本的坐标配置。地形底图、建筑、野区和神符点位需要从完整游戏资源中提取。",
                          )}
                    </p>
                  </div>
                </div>
              )}
              <div
                className="map-corner-info pointer-events-none absolute bottom-3 left-3 flex max-h-[25%] w-max max-w-[min(360px,calc(100%-24px))] flex-col justify-end overflow-hidden rounded bg-[#0b131acc] p-1.5 text-[#b9c7d0]"
                aria-label={t("地图视口提示")}
              >
                <div className="map-compass truncate">
                  {t("北 ↑ · 天辉西南 / 夜魇东北")}
                </div>
                <div ref={pickHintRef} className="truncate text-cyan-100" />
                {hovered && (
                  <div className="line-clamp-2 shrink-0" role="status">
                    {t("{value0} · X {value1}, Y {value2}, {value3} {value4}", {
                      value0: watcherLabel(hovered!, locale),
                      value1: Math.round(hovered!.x),
                      value2: Math.round(hovered!.y),
                      value3: hovered!.kind === "camp" ? t("Z 轴") : "Z",
                      value4:
                        hovered!.z === null
                          ? t("未知")
                          : Math.round(hovered!.z),
                    })}
                    {hoveredCamp && data.economy && (
                      <p className="truncate">
                        <span className="text-[#e8c781]">
                          <Message
                            id="金币 {value0}"
                            values={{
                              value0: hoveredCampLabels?.gold ?? t("未收录"),
                            }}
                          />
                        </span>
                        <span className="ml-3 text-[#a6daf4]">
                          <Message
                            id="经验 {value0}"
                            values={{
                              value0: hoveredCampLabels?.xp ?? t("未收录"),
                            }}
                          />
                        </span>
                        <span className="sr-only">
                          <Message
                            id="{value0} · 单人清野，经验独享{value1}"
                            values={{
                              value0: clockText(time),
                              value1: includeChildren ? t(" · 含分裂体") : "",
                            }}
                          />
                        </span>
                      </p>
                    )}
                  </div>
                )}
                {!hovered && lanePreviews.length > 0 && (
                  <div
                    role="status"
                    aria-label={t("兵线路径收益")}
                    className="line-clamp-2"
                  >
                    {lanePreviews.map(({ route, wave }) => (
                      <p key={route.id} className="truncate">
                        {route.team === "radiant" ? t("天辉") : t("夜魇")} ·{" "}
                        {
                          {
                            top: t("上路"),
                            mid: t("中路"),
                            bot: t("下路"),
                          }[route.lane]
                        }{" "}
                        · {clockText(time)}
                        {wave
                          ? t(" · 金币 {value0} / 经验 {value1}", {
                              value0: goldText(wave.total),
                              value1: wave.xp ?? t("未收录"),
                            })
                          : t(" · 收益未收录")}
                      </p>
                    ))}
                  </div>
                )}
                <div className="map-ruler mt-1 shrink-0">
                  <span ref={rulerLabelRef} />
                  <div ref={rulerRef} className="mt-0.5 h-px bg-[#b9c7d0]" />
                </div>
              </div>
            </div>
            <div
              className="map-view-tools col-start-1 row-start-1 row-span-2 flex min-w-0 flex-col items-stretch gap-1 rounded bg-white/[0.025] p-1"
              aria-label={t("地图视图工具栏")}
            >
              {!!data.rasterLayers?.length && (
                <section
                  aria-label={t("地形数据")}
                  className="flex flex-col items-stretch gap-1 text-[14px]"
                >
                  <h2 className="py-1 text-center text-[14px] font-semibold text-[var(--text-muted)]">
                    {t("地形")}
                  </h2>
                  <div className="flex flex-col gap-0.5">
                    {[{ id: "", label: t("底图") }, ...data.rasterLayers].map(
                      (layer) => (
                        <button
                          key={layer.id}
                          aria-keyshortcuts={
                            visionEnabled ? undefined : TERRAIN_KEYS[layer.id]
                          }
                          title={`${t(layer.label)}${!visionEnabled && TERRAIN_KEYS[layer.id] ? ` (${TERRAIN_KEYS[layer.id]})` : ""}`}
                          aria-pressed={terrainLayer === layer.id}
                          onClick={() => setTerrainLayer(layer.id)}
                          className={`${buttonStyle} flex h-14 items-center justify-center gap-1 !px-0.5 !py-1 !text-[14px] ${terrainLayer === layer.id ? "bg-white/10" : ""}`}
                        >
                          <span
                            className={`block min-w-0 flex-1 break-words ${locale === "zh-CN" ? "leading-5" : "text-xs leading-4"}`}
                          >
                            {t(layer.label)}
                          </span>
                          {TERRAIN_KEYS[layer.id] && (
                            <ShortcutKey
                              value={TERRAIN_KEYS[layer.id]}
                              hidden={visionEnabled}
                            />
                          )}
                        </button>
                      ),
                    )}
                  </div>
                </section>
              )}
              {!!data.rasterLayers?.length && (
                <div
                  role="separator"
                  className="mx-1 my-1 h-px shrink-0 bg-white/15"
                />
              )}
              <div className="flex flex-col items-stretch gap-1">
                <button
                  className={`${buttonStyle} flex h-14 items-center justify-center gap-1 !px-0.5 !py-1 !text-[14px] ${visionEnabled ? activeToolStyle : ""}`}
                  disabled={!data.visionScene}
                  aria-keyshortcuts="Q"
                  title={`${t("视野")} (Q)`}
                  aria-pressed={visionEnabled}
                  onClick={() => {
                    sightFrame.current.sight.toggle();
                    planner.stop();
                  }}
                >
                  <span className="min-w-0 flex-1 leading-5">{t("视野")}</span>
                  <ShortcutKey value="Q" />
                </button>
                <button
                  className={`${buttonStyle} flex h-14 items-center justify-center gap-1 !px-0.5 !py-1 !text-[14px] ${planner.enabled ? activeToolStyle : ""}`}
                  aria-keyshortcuts="W"
                  title={`${t("寻路")} (W)`}
                  aria-pressed={planner.enabled}
                  onClick={() => {
                    sightFrame.current.sight.stop();
                    planner.toggle();
                  }}
                >
                  <span className="min-w-0 flex-1 leading-5">{t("寻路")}</span>
                  <ShortcutKey value="W" />
                </button>
              </div>
            </div>
          </div>
          {terrainError && (
            <p role="alert" className="mt-2">
              {t("地形图层加载失败，请刷新重试。")}
            </p>
          )}
          <section
            aria-label={t("地图点位")}
            className="mt-3 rounded bg-white/[0.025] p-3 text-xs"
          >
            <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
              <div className="mr-1 flex items-center gap-2">
                <h2 className="shrink-0 font-semibold">{t("地图点位")}</h2>
                <input
                  aria-label={t("搜索地图点位")}
                  value={query}
                  onChange={(e) => {
                    hoverPoint(null);
                    setQuery(e.target.value);
                  }}
                  placeholder={t("搜索点位…")}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-40 min-w-0 rounded bg-white/5 px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-[#a4c5bc]"
                />
              </div>
            </div>
            {data.points.length > 0 && (
              <section className="mt-4">
                <h2 className="mb-2 font-semibold">
                  <Message
                    id="点位 · {value0}"
                    values={{
                      value0: visible.length,
                    }}
                  />
                </h2>
                <ul
                  aria-label={t("地图点位")}
                  className="grid max-h-48 grid-cols-[repeat(auto-fill,minmax(155px,1fr))] gap-x-2 gap-y-0.5 overflow-auto"
                >
                  {pointRows}
                </ul>
                {visible.length > 80 && (
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                    {t("列出前80项；搜索可定位其他点位。")}
                  </p>
                )}
              </section>
            )}
            <p className="mt-4 text-[10px] leading-5 text-[var(--text-muted)]">
              <Message
                id="{value0} 范围圈不计算通行、碰撞、高低坡和战争迷雾。"
                values={{
                  value0: data.coverage
                    ? t(
                        "树木及建筑填满对齐的64单位网格，与陆地寻路共用阻挡近似（树木半径32＋英雄体积24）。悬停坐标仍为原始树木位置；隐藏图层不会移除寻路阻挡。",
                      )
                    : t("当前仅有坐标配置，点位尚未导入。"),
                }}
              />
            </p>
          </section>
        </div>
        <aside
          aria-label={t("选中对象属性与操作")}
          className="relative min-w-0 text-xs"
        >
          {!planner.enabled &&
            !visionAdding &&
            hovered?.kind === "camp" &&
            hovered.id !== selected?.id && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
                <CampHoverCard
                  data={data}
                  point={hovered}
                  time={time}
                  includeChildren={includeChildren}
                  gold={hoveredCampLabels?.gold ?? null}
                  xp={hoveredCampLabels?.xp ?? t("未收录")}
                />
              </div>
            )}
          <VisionController
            onFrame={updateVisionFrame}
            selected={selected}
            data={data}
            activate={() => {
              planner.stop();
            }}
          />
          <RoutePanel planner={planner} data={data} />
          <TerrainLegend layer={terrainLayer} />
          <TerrainLegend layer={showCurrents ? "currents" : ""} />
          <h2 className="my-2 font-semibold">{t("对象属性与操作")}</h2>
          {!selected && (
            <p className="rounded bg-white/[0.035] p-2 text-[11px] leading-5 text-[var(--text-muted)]">
              {t(
                "点击地图上的对象，查看属性、收益及范围；可从地图下方搜索定位。",
              )}
            </p>
          )}
          {selected && (
            <section
              className="rounded bg-white/[0.035] p-2"
              aria-label={t("点位详情")}
            >
              <div className="flex justify-between gap-2">
                <h2 className="font-semibold">
                  {watcherLabel(selected, locale)}
                </h2>
                <button
                  aria-label={t("关闭点位详情")}
                  onClick={() => setSelected(null)}
                >
                  ×
                </button>
              </div>
              {data.routing?.obstacles?.some((o) => o.id === selected.id) && (
                <p className="mt-2 text-[10px] text-[var(--text-muted)]">
                  <Message
                    id="金色网格：初始碰撞阻挡近似，含24单位英雄体积。{value0}"
                    values={{
                      value0: data.routing.obstacles.find(
                        (o) => o.id === selected.id,
                      )?.estimated
                        ? t("遗迹按本版本模型边界估算，尚未通过引擎验证。")
                        : t("来自本版本单位碰撞体积定义。"),
                    }}
                  />
                </p>
              )}
              {selected.kind === "watcher" && (
                <div className="mt-2">
                  <label>{t("中立视野目标 · 可被双方英雄激活")}</label>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                    {t(
                      "初始中立，归属由对局中的占领决定，不按地图方位分配。当前为静态初始状态，不含对局占领数据。",
                    )}
                  </p>
                  {data.watcherRules ? (
                    <div className="mt-2 space-y-2 leading-5">
                      <p>
                        <Message
                          id="英雄在{value0}范围内右键，持续施法{value1}秒激活，为己方提供{value2}分钟视野，到期回归中立。"
                          values={{
                            value0: data.watcherRules.castRange,
                            value1: data.watcherRules.channel,
                            value2: data.watcherRules.active / 60,
                          }}
                        />
                      </p>
                      <p>
                        <Message
                          id="视野半径：白天{value0}，夜晚{value1}。敌方可持续施法关闭，停用{value2}分钟后可重新激活。"
                          values={{
                            value0: data.watcherRules.dayVision,
                            value1: data.watcherRules.nightVision,
                            value2: data.watcherRules.inactive / 60,
                          }}
                        />
                      </p>
                      <p>
                        {t(
                          "击杀肉山不会获得监视者控制权。归属与停用是对局状态，不能从静态地图推断。",
                        )}
                      </p>
                      <p className="text-[10px] text-[var(--text-muted)]">
                        <Message
                          id="参数来自本版本游戏文件；机制参考Valve {value0}、{value1}、{value2}。"
                          values={{
                            value0: (
                              <a
                                className="underline"
                                href="https://www.dota2.com/newfrontiers"
                                target="_blank"
                                rel="noreferrer"
                              >
                                7.33
                              </a>
                            ),
                            value1: (
                              <a
                                className="underline"
                                href="https://www.dota2.com/patches/7.34"
                                target="_blank"
                                rel="noreferrer"
                              >
                                7.34
                              </a>
                            ),
                            value2: (
                              <a
                                className="underline"
                                href="https://www.dota2.com/patches/7.40"
                                target="_blank"
                                rel="noreferrer"
                              >
                                7.40
                              </a>
                            ),
                          }}
                        />
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2">
                      {t("此版本的具体运行参数尚未收录。")}
                    </p>
                  )}
                </div>
              )}
              <p className="mt-2 text-[var(--text-muted)]">
                {selected.team === "radiant"
                  ? t("天辉")
                  : selected.team === "dire"
                    ? t("夜魇")
                    : selected.team === "neutral"
                      ? t("中立")
                      : t("阵营未提供")}{" "}
                ·{" "}
                {selected.z === null
                  ? t("高度未提供")
                  : t("高度 {value0}", {
                      value0: Math.round(selected.z),
                    })}
              </p>
              <p className="mt-1 font-mono text-[10px]">
                {Math.round(selected.x)}, {Math.round(selected.y)}
              </p>
              {selected.kind === "barracks" && (
                <p
                  className={`mt-2 ${barracksDestroyed(selected, barracks) ? "text-[#ef8a83]" : "text-[var(--text-muted)]"}`}
                >
                  {barracksDestroyed(selected, barracks)
                    ? t("兵营已毁（情景）")
                    : t("兵营完整（情景）")}
                </p>
              )}
              {selected.kind === "camp" && (
                <div
                  className="mt-3"
                  aria-hidden={
                    hovered?.kind === "camp" && hovered.id !== selected.id
                      ? true
                      : undefined
                  }
                >
                  <CampHoverCard
                    data={data}
                    point={selected}
                    time={time}
                    includeChildren={includeChildren}
                    gold={campLabels.get(selected.id)?.gold ?? null}
                    xp={campLabels.get(selected.id)?.xp ?? t("未收录")}
                  />
                </div>
              )}
              <button
                className={`${buttonStyle} mt-3 bg-white/5`}
                onClick={() => focusPoint(selected)}
              >
                {t("定位到对象")}
              </button>
              <label className="mt-3 block">
                <Message
                  id="自定义范围圈 {value0} 单位{value1}"
                  values={{
                    value0: <span className="tabular-nums">{range}</span>,
                    value1: (
                      <input
                        aria-label={t("范围圈半径")}
                        type="range"
                        min="0"
                        max={rangeMax}
                        step="1"
                        value={range}
                        onChange={(e) => setRange(Number(e.target.value))}
                        className="map-range mt-2 block w-full"
                      />
                    ),
                  }}
                />
              </label>
              {vision && (
                <div aria-label={t("视野范围")} className="mt-1 text-[10px]">
                  <div
                    className="pointer-events-none relative mx-[7px] h-9"
                    aria-label={t("视野刻度")}
                  >
                    {[...new Set([vision.day, vision.night])]
                      .sort((a, b) => a - b)
                      .map((value, index) => (
                        <span
                          key={value}
                          className="absolute -top-[11px] border-l"
                          style={{
                            left: `${(value / rangeMax) * 100}%`,
                            height: 16 + index * 14,
                            color: value === vision.day ? "#ffd478" : "#b8b0ff",
                            borderColor: "currentColor",
                          }}
                        >
                          <span
                            className={`absolute bottom-0 whitespace-nowrap text-[9px] leading-none ${value / rangeMax > 0.8 ? "-translate-x-full" : value / rangeMax < 0.1 ? "" : "-translate-x-1/2"}`}
                            style={{
                              transform: `${value / rangeMax > 0.8 ? "translateX(-100%)" : value / rangeMax < 0.1 ? "" : "translateX(-50%)"} translateY(100%)`,
                            }}
                          >
                            {vision.day === vision.night
                              ? t("昼夜")
                              : value === vision.day
                                ? t("昼")
                                : t("夜")}{" "}
                            {value}
                          </span>
                        </span>
                      ))}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <button
                      className="cursor-pointer rounded border border-transparent px-1.5 py-1 text-[#ffd478] transition-colors hover:border-[#ffd478]/60 hover:bg-[#ffd478]/15 focus-visible:outline focus-visible:outline-[#ffd478] aria-pressed:border-[#ffd478]/50 aria-pressed:bg-[#ffd478]/10"
                      aria-pressed={range === vision.day}
                      onClick={() => setRange(vision.day)}
                    >
                      <Message
                        id="☀ 白天 {value0}"
                        values={{
                          value0: vision.day,
                        }}
                      />
                    </button>
                    <button
                      className="cursor-pointer rounded border border-transparent px-1.5 py-1 text-[#b8b0ff] transition-colors hover:border-[#b8b0ff]/60 hover:bg-[#b8b0ff]/15 focus-visible:outline focus-visible:outline-[#b8b0ff] aria-pressed:border-[#b8b0ff]/50 aria-pressed:bg-[#b8b0ff]/10"
                      aria-pressed={range === vision.night}
                      onClick={() => setRange(vision.night)}
                    >
                      <Message
                        id="☾ 夜晚 {value0}"
                        values={{
                          value0: vision.night,
                        }}
                      />
                    </button>
                  </div>
                  <p className="mt-2 text-[var(--text-muted)]">
                    <Message
                      id="{value0}实线为白天，虚线为夜晚。显示基础半径，不计算树木、高地和战争迷雾遮挡。"
                      values={{
                        value0: vision.conditional
                          ? t("{value0}视野。", {
                              value0: vision.conditional,
                            })
                          : "",
                      }}
                    />
                  </p>
                </div>
              )}
            </section>
          )}
          <section
            aria-label={t("图层")}
            className="map-layer-filters mt-3 rounded bg-white/[0.025] p-2"
          >
            <h2 className="mb-1 font-semibold">{t("图层")}</h2>
            <div className="flex flex-col">
              {layerOrder.map((kind) => (
                <label
                  key={kind}
                  onPointerEnter={() => {
                    if (
                      layers.has(kind) &&
                      !(
                        sightFrame.current.sight.enabled &&
                        sightFrame.current.sight.tool === "add"
                      )
                    )
                      setHoveredLayer(kind);
                  }}
                  onPointerLeave={() => {
                    setHoveredLayer(null);
                  }}
                  onFocus={() => {
                    if (
                      layers.has(kind) &&
                      !(
                        sightFrame.current.sight.enabled &&
                        sightFrame.current.sight.tool === "add"
                      )
                    )
                      setHoveredLayer(kind);
                  }}
                  onBlur={() => {
                    setHoveredLayer(null);
                  }}
                  className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-1 text-[11px] hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    checked={layers.has(kind)}
                    onChange={() => {
                      hoverPoint(null);
                      setHoveredLayer(null);
                      setLayers((previous) => {
                        const next = new Set(previous);
                        if (next.has(kind)) next.delete(kind);
                        else next.add(kind);
                        return next;
                      });
                    }}
                    className="m-0 size-3.5 shrink-0 accent-[#a4c5bc]"
                  />
                  {layerIcons.has(kind) ? (
                    // Native minimap pixels are shared with the Canvas markers.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={layerIcons.get(kind)!.url}
                      alt=""
                      width={18}
                      height={18}
                      className="size-[18px] shrink-0 object-contain"
                    />
                  ) : (
                    <span
                      className="inline-grid size-[18px] shrink-0 place-items-center"
                      style={{ color: MAP_LAYERS[kind].color }}
                    >
                      {MAP_LAYERS[kind].symbol}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    {t(MAP_LAYERS[kind].label)}
                  </span>
                  <span className="ml-1 shrink-0 text-[10px] tabular-nums text-[var(--text-muted)]">
                    {counts.get(kind) ?? (data.coverage ? 0 : t("待接入"))}
                  </span>
                </label>
              ))}
            </div>
          </section>
        </aside>
      </div>
      <MemoEconomyPanel
        data={data}
        time={time}
        onTime={setTime}
        selected={selected}
        onFocus={focusPoint}
        onHover={hoverPoint}
        state={barracks}
        onState={setBarracks}
        includeChildren={includeChildren}
        onIncludeChildren={setIncludeChildren}
      />
      {markerImageError && (
        <p role="status" className="mt-2 text-xs text-amber-200">
          {t("部分地图图标加载失败，请刷新重试。")}
        </p>
      )}
      {data.mapIcons && <MapIconLibrary assets={data.mapIcons} />}
      <p className="mt-2 text-[10px] text-[var(--text-muted)]">
        <Message
          id="键盘：方向键平移，＋ / − 缩放，0 复位，Esc 清除选择。{value0}"
          values={{
            value0: data.coverage
              ? t(
                  "已导入 {value0} 个静态点位；{value1} 个无坐标或依赖父级变换的实体未显示。{value2}",
                  {
                    value0: formatNumber(locale, data.points.length),
                    value1: data.coverage.skippedEntities,
                    value2: data.coverage.omittedNonGameplayEntities
                      ? t(
                          " {value0} 个装饰、辅助或重复生成记录保留在来源中。",
                          {
                            value0: data.coverage.omittedNonGameplayEntities,
                          },
                        )
                      : "",
                  },
                )
              : t("地形与点位接入后，图层和搜索将自动启用。"),
          }}
        />
      </p>
    </div>
  );
}
