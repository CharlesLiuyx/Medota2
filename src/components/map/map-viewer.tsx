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
import { TerrainLegend } from "./terrain-legend";
import { MapEconomyPanel } from "./economy-panel";
import { RoutePanel, useRoutePlanner } from "./route-planner";
import { currentField } from "@/domain/map/currents";
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
const activeToolStyle =
  "bg-cyan-300/20 !text-cyan-100 ring-1 ring-inset ring-cyan-200/80 font-semibold shadow-[inset_0_-2px_0_#89eaff]";
const buttonStyle =
  "rounded px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-white/5 disabled:opacity-35";
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
  const [campLayerHover, setCampLayerHover] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const cornerRef = useRef<HTMLDivElement>(null);
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
  const [measure, setMeasure] = useState(false);
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
  const [measurement, setMeasurement] = useState<Position[]>([]);
  const [zoom, setZoom] = useState(1);
  const [time, setTime] = useState(0);
  const [showGold, setShowGold] = useState(true);
  const [showExperience, setShowExperience] = useState(false);
  const [showTimings, setShowTimings] = useState(true);
  const [showLanes, setShowLanes] = useState(true);
  const [showCurrents, setShowCurrents] = useState(false);
  const [barracks, setBarracks] = useState<BarracksState>("normal");
  const [hoveredLanes, setHoveredLanes] = useState<string[]>([]);
  const laneHover = useRef<string[]>([]);
  const [includeChildren, setIncludeChildren] = useState(true);
  const [imageError, setImageError] = useState(false);
  const texture = useRef<HTMLImageElement | null>(null);
  const overlayTextures = useRef(new Map<string, HTMLImageElement>());
  const [terrainLayer, setTerrainLayer] = useState<string>("");
  const [terrainError, setTerrainError] = useState(false);
  const redraw = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    routeFrame.current = planner;
  });
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
      measurement,
      measure,
      layers,
      query,
      terrainLayer,
      showCurrents,
      showGold,
      showLanes,
      campLayerHover,
      showExperience,
      showTimings,
      campLabels,
    }),
    [
      selected,
      range,
      measurement,
      measure,
      layers,
      query,
      terrainLayer,
      showCurrents,
      showGold,
      showLanes,
      campLayerHover,
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
    let disposed = false;
    overlayTextures.current.clear();
    for (const layer of data.rasterLayers ?? []) {
      const img = new Image();
      img.onload = () => {
        if (!disposed) {
          overlayTextures.current.set(layer.id, img);
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
  }, [data.rasterLayers]);
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
    let backgroundImage: HTMLImageElement | null = null;
    let backgroundRaster: HTMLImageElement | undefined;
    let backgroundLabels: typeof live.current.campLabels | null = null;
    let backgroundBuilds = 0;
    let paints = 0;
    let hitTests = 0;
    let pendingHover: Position | null = null;
    let pointerHint: Position | null = null;
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
        measurement,
        layers,
        query,
        terrainLayer,
        showCurrents,
        showGold,
        showLanes,
        campLayerHover,
        showExperience,
        showTimings,
        campLabels,
      } = live.current;
      const zoneLabels: {
        x: number;
        y: number;
        text: string;
      }[] = [];
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
        if (s.x < -40 || s.y < -40 || s.x > width + 40 || s.y > height + 40)
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
          p.kind === "shop" ? 0.4 : p.kind === "camp" ? 0.75 : active ? 2 : 1.5;
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
        if (!point || !labels.gold) return;
        const at = screen(point),
          label = labels.gold;
        if (
          at.x < -160 ||
          at.y < -30 ||
          at.x > width + 160 ||
          at.y > height + 100
        )
          return;
        if (!extra && showGold) {
          ctx.fillStyle = "#091219dc";
          const half = textWidth(label) / 2 + 3;
          ctx.fillRect(at.x - half, at.y - 25, half * 2, 14);
          ctx.fillStyle = "#f0cd86";
          ctx.fillText(label, at.x, at.y - 18);
        }
        let labelOffset = 34;
        if (showTimings) {
          for (const line of labels.timing) {
            if (!extra) {
              const half = textWidth(line) / 2 + 3;
              ctx.fillStyle = "#091219f2";
              ctx.fillRect(at.x - half, at.y - labelOffset - 8, half * 2, 15);
              ctx.fillStyle = "#d7ead5";
              ctx.fillText(line, at.x, at.y - labelOffset);
            }
            labelOffset += 16;
          }
        }
        if (extra || showExperience) {
          const xp = t("经验 {value0}", {
            value0: labels.xp,
          });
          const halfXp = textWidth(xp) / 2 + 3;
          ctx.fillStyle = "#091219f2";
          ctx.fillRect(at.x - halfXp, at.y - labelOffset - 8, halfXp * 2, 15);
          ctx.fillStyle = "#a6daf4";
          ctx.fillText(xp, at.x, at.y - labelOffset);
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
      const key = [
        camera.current.x,
        camera.current.y,
        camera.current.zoom,
        width,
        height,
        dpr,
        terrainLayer,
        showCurrents,
        showLanes,
        showGold,
        showExperience,
        showTimings,
        layers.has("camp"),
        query,
      ].join("|");
      const rasterImage = overlayTextures.current.get(terrainLayer);
      if (
        key !== backgroundKey ||
        texture.current !== backgroundImage ||
        rasterImage !== backgroundRaster ||
        campLabels !== backgroundLabels
      ) {
        backgroundKey = key;
        backgroundLabels = campLabels;
        backgroundImage = texture.current;
        backgroundRaster = rasterImage;
        backgroundBuilds++;
        if (background.width !== canvas.width) background.width = canvas.width;
        if (background.height !== canvas.height)
          background.height = canvas.height;
        ctx = backgroundContext!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#0b131a";
        ctx.fillRect(0, 0, width, height);
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
          ctx.save();
          ctx.beginPath();
          const side = treeGrid.cell * scale * camera.current.zoom;
          const arrows: {
            x: number;
            y: number;
            angle: number;
          }[] = [];
          for (let i = 0; i < currents.bonus.length; i++) {
            if (!currents.bonus[i]) continue;
            const col = i % treeGrid.width,
              row = Math.floor(i / treeGrid.width),
              at = screen({
                x: treeGrid.x + col * treeGrid.cell,
                y: treeGrid.y + (row + 1) * treeGrid.cell,
              });
            if (
              at.x + side < 0 ||
              at.y + side < 0 ||
              at.x > width ||
              at.y > height
            )
              continue;
            ctx.rect(at.x, at.y, side, side);
            if (col % 3 === 0 && row % 3 === 0)
              arrows.push({
                x: at.x + side / 2,
                y: at.y + side / 2,
                angle: Math.atan2(-currents.y[i], currents.x[i]),
              });
          }
          ctx.fillStyle = "#38bfc950";
          ctx.fill();
          ctx.strokeStyle = "#64e5ec22";
          ctx.lineWidth = 0.5;
          ctx.stroke();
          // Preserve the outline while reducing the internal cell divisions.
          ctx.beginPath();
          for (let i = 0; i < currents.bonus.length; i++) {
            if (!currents.bonus[i]) continue;
            const col = i % treeGrid.width,
              row = Math.floor(i / treeGrid.width);
            const at = screen({
              x: treeGrid.x + col * treeGrid.cell,
              y: treeGrid.y + (row + 1) * treeGrid.cell,
            });
            const edge = (x1: number, y1: number, x2: number, y2: number) => {
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
            };
            if (col === 0 || !currents.bonus[i - 1])
              edge(at.x, at.y, at.x, at.y + side);
            if (col === treeGrid.width - 1 || !currents.bonus[i + 1])
              edge(at.x + side, at.y, at.x + side, at.y + side);
            if (!currents.bonus[i + treeGrid.width])
              edge(at.x, at.y, at.x + side, at.y);
            if (!currents.bonus[i - treeGrid.width])
              edge(at.x, at.y + side, at.x + side, at.y + side);
          }
          ctx.strokeStyle = "#64e5ec66";
          ctx.stroke();
          ctx.strokeStyle = "#b7fbff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (const p of arrows) {
            const size = Math.max(3, Math.min(7, side * 0.7));
            ctx.moveTo(
              p.x - Math.cos(p.angle - 0.6) * size,
              p.y - Math.sin(p.angle - 0.6) * size,
            );
            ctx.lineTo(p.x, p.y);
            ctx.lineTo(
              p.x - Math.cos(p.angle + 0.6) * size,
              p.y - Math.sin(p.angle + 0.6) * size,
            );
          }
          ctx.stroke();
          ctx.restore();
        }
        if (layers.has("camp") && !query.trim())
          for (const zone of data.zones ?? []) drawZone(zone, false);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const drawCells = (cells: number[], color: string, border: string) => {
          const occupied = new Set(cells),
            side = treeGrid.cell * scale * camera.current.zoom;
          ctx.beginPath();
          for (const i of cells) {
            const at = screen({
              x: treeGrid.x + (i % treeGrid.width) * treeGrid.cell,
              y:
                treeGrid.y +
                (Math.floor(i / treeGrid.width) + 1) * treeGrid.cell,
            });
            ctx.rect(at.x, at.y, side, side);
          }
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = border;
          ctx.lineWidth = 0.35;
          ctx.globalAlpha = 0.2;
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          for (const i of cells) {
            const x = i % treeGrid.width,
              y = Math.floor(i / treeGrid.width);
            const at = screen({
              x: treeGrid.x + x * treeGrid.cell,
              y: treeGrid.y + (y + 1) * treeGrid.cell,
            });
            const edge = (x1: number, y1: number, x2: number, y2: number) => {
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
            };
            if (x === 0 || !occupied.has(i - 1))
              edge(at.x, at.y, at.x, at.y + side);
            if (x === treeGrid.width - 1 || !occupied.has(i + 1))
              edge(at.x + side, at.y, at.x + side, at.y + side);
            if (!occupied.has(i + treeGrid.width))
              edge(at.x, at.y, at.x + side, at.y);
            if (!occupied.has(i - treeGrid.width))
              edge(at.x, at.y + side, at.x + side, at.y + side);
          }
          ctx.stroke();
        };
        drawCells(treeBlocks, MAP_LAYERS.tree.color, "#183127");
        drawCells(buildingBlocks, "#dfb27180", "#493922");
        for (const p of markers) drawMarker(p, false);
        for (const [id, labels] of campLabels) drawCampLabel(id, labels, false);
      }
      ctx = output!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(background, 0, 0);
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
          if (
            activeCamp &&
            zone.zMin !== undefined &&
            zone.zMax !== undefined
          ) {
            const anchor = screen({
              x:
                zone.vertices.reduce((s, v) => s + v.x, 0) /
                zone.vertices.length,
              y: Math.min(...zone.vertices.map((v) => v.y)),
            });
            zoneLabels.push({
              x: anchor.x,
              y: Math.max(anchor.y + 12, screen(activeCamp).y + 42),
              text: t("Z 轴范围：{value0}～{value1}", {
                value0: Math.round(zone.zMin),
                value1: Math.round(zone.zMax),
              }),
            });
          }
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
        ...(campLayerHover ? markers.filter((p) => p.kind === "camp") : []),
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
      if (!showExperience)
        for (const [id, labels] of campLabels)
          if (
            campLayerHover ||
            (byId.has(id) && activeCamps.has(byId.get(id)!))
          )
            drawCampLabel(id, labels, true);
      for (const label of zoneLabels) {
        ctx.font = "10px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const half = textWidth(label.text) / 2 + 4;
        ctx.fillStyle = "#07151ef2";
        ctx.fillRect(label.x - half, label.y - 8, half * 2, 16);
        ctx.fillStyle = "#b9f4ff";
        ctx.fillText(label.text, label.x, label.y);
      }
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
      if (measurement.length) {
        ctx.strokeStyle = "#efdba5";
        ctx.fillStyle = "#efdba5";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        measurement.forEach((p, i) => {
          const s = screen(p);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();
        for (const p of measurement) {
          const s = screen(p);
          ctx.beginPath();
          ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const imageLeft = screen({ x: data.bounds.minX, y: data.bounds.minY }),
        imageRight = screen({ x: data.bounds.maxX, y: data.bounds.minY }),
        imageTop = screen({ x: data.bounds.minX, y: data.bounds.maxY });
      const cornerWidth = (imageRight.x - imageLeft.x) * 0.28,
        cornerHeight = (imageLeft.y - imageTop.y) * 0.09;
      if (cornerRef.current) {
        Object.assign(cornerRef.current.style, {
          left: `${imageLeft.x + 6}px`,
          top: `${imageLeft.y - cornerHeight}px`,
          width: `${Math.max(0, cornerWidth - 12)}px`,
          height: `${Math.max(0, cornerHeight - 6)}px`,
        });
      }
      // A 1/2/5 ruler in actual world units, clipped to the same empty corner.
      const rawUnits =
          Math.min(80, Math.max(1, cornerWidth - 16)) /
          (scale * camera.current.zoom),
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
      if (Number(canvas.dataset.zoom) !== camera.current.zoom)
        setZoom(camera.current.zoom);
      canvas.dataset.zoom = String(camera.current.zoom);
      canvas.dataset.drawMs = (performance.now() - started).toFixed(2);
    }
    const schedule = (paint = true) => {
      paintNeeded ||= paint;
      if (!frame) frame = requestAnimationFrame(draw);
    };
    redraw.current = schedule;
    const resize = () => {
      width = host.clientWidth;
      height = host.clientHeight;
      if (width <= 0 || height <= 0) return;
      // Resize the backing store only inside the next complete paint. Assigning
      // canvas.width/height, even unchanged, clears it and caused state flashes.
      scale = fitScale(data.bounds, width, height);
      schedule();
    };
    const point = (e: MouseEvent | PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const hit = (p: Position) => {
      hitTests++;
      const w = world(p),
        radius = 14 / (scale * camera.current.zoom);
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
      leave();
      if (e.button !== 0) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(e.pointerId);
      const p = point(e);
      pointers.set(e.pointerId, p);
      last = p;
      if (pointers.size === 1) dragged = false;
      else dragged = true;
    };
    const move = (e: PointerEvent) => {
      const p = point(e);
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
              distance(after) / distance(before),
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
      const target = hit(p);
      const candidates =
        !target &&
        !live.current.measure &&
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
      canvas!.style.cursor =
        live.current.measure ||
        (routeFrame.current.enabled && routeFrame.current.drafting)
          ? "crosshair"
          : target ||
              laneIds.length ||
              (routeFrame.current.enabled && !routeFrame.current.drafting)
            ? "pointer"
            : "grab";
    }
    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (e.type === "pointerup" && !dragged) {
        if (live.current.measure || routeFrame.current.enabled) {
          const w = world(point(e));
          if (
            w.x >= data.bounds.minX &&
            w.x <= data.bounds.maxX &&
            w.y >= data.bounds.minY &&
            w.y <= data.bounds.maxY
          )
            if (routeFrame.current.enabled) {
              const routing = routeFrame.current;
              if (routing.drafting) routing.pick(w);
              else {
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
                  .filter(
                    (c) => (c.d - nearest) * scale * camera.current.zoom < 2,
                  )
                  .sort(
                    (a, b) => a.id - b.id || a.variant.localeCompare(b.variant),
                  );
                const candidate =
                  hits[(hits.findIndex((c) => c.active) + 1) % hits.length];
                if (candidate)
                  routing.selectRoute(candidate.id, candidate.variant);
                else setSelected(hit(point(e)));
              }
              pointerHint = point(e);
              schedule();
            } else
              setMeasurement((previous) =>
                previous.length === 1 ? [...previous, w] : [w],
              );
        } else setSelected(hit(point(e)));
      }
      last = pointers.values().next().value ?? null;
      setZoom(camera.current.zoom);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      leave();
      const p = point(e);
      camera.current = zoomAt(
        camera.current,
        Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.003),
        p.x,
        p.y,
        scale,
        width,
        height,
      );
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
      setZoom(1);
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
      setZoom(camera.current.zoom);
      schedule();
    };
    const key = (e: KeyboardEvent) => {
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
        setSelected(null);
        setMeasurement([]);
        if (routeFrame.current.enabled) routeFrame.current.stop();
        setMeasure(false);
      } else {
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
        setZoom(camera.current.zoom);
        setSelected(p);
        schedule();
      },
    };
    const exitTool = (e: KeyboardEvent | MouseEvent) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (!live.current.measure && !routeFrame.current.enabled) return;
      e.preventDefault();
      setMeasure(false);
      setMeasurement([]);
      routeFrame.current.stop();
      pointers.clear();
      leave();
      canvas!.style.cursor = "grab";
    };
    document.addEventListener("keydown", exitTool, true);
    document.addEventListener("contextmenu", exitTool);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("keydown", key);
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    return () => {
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
  const distance =
    measurement.length === 2
      ? Math.round(
          Math.hypot(
            measurement[1].x - measurement[0].x,
            measurement[1].y - measurement[0].y,
          ),
        )
      : null;
  const hoveredCamp = data.economy?.camps.find(
    (c) => c.pointId === hovered?.id,
  );
  const hoveredCampLabels = campLabels.get(hovered?.id ?? "");
  const lanePreviews =
    showLanes && !measure && !planner.enabled
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
          <div className="map-stage grid grid-cols-[64px_minmax(0,1fr)] grid-rows-[auto_auto] items-stretch gap-x-1 gap-y-1">
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
              <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
                <HoverTooltip
                  className="grid size-5 place-items-center rounded-full border border-white/25 text-[10px] text-[#c9d7e2] hover:bg-white/10"
                  content={
                    <div className="text-xs leading-6">
                      <p>{t("拖拽平移 · 滚轮或双指缩放")}</p>
                      <p>{t("测距：点击地图两点，查看平面直线距离。")}</p>
                      <p>{t("右键或 Esc 退出当前工具。")}</p>
                      <p>
                        {t(
                          "寻路：选择起终点后，点击路径切换方案；重合处再次点击轮换。Delete 删除选中路线。",
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
                      aria-label={t("缩放比例")}
                      title={t("复位地图（0）")}
                      onClick={() => controls.current?.reset()}
                    >
                      {Math.round(zoom * 100)}%
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
                ref={cornerRef}
                className="map-corner-info pointer-events-none absolute flex flex-col justify-end overflow-hidden text-[#b9c7d0]"
                aria-label={t("地图视口提示")}
              >
                <div className="map-compass truncate">
                  {t("北 ↑ · 天辉西南 / 夜魇东北")}
                </div>
                <div ref={pickHintRef} className="truncate text-cyan-100" />
                {(hovered || measure) && (
                  <div className="line-clamp-2 shrink-0" role="status">
                    {measure
                      ? distance === null
                        ? measurement.length
                          ? t("选择第二个点")
                          : t("依次点击两个点测量直线距离")
                        : t("直线距离 {value0} 单位", {
                            value0: formatNumber(locale, distance),
                          })
                      : t(
                          "{value0} · X {value1}, Y {value2}, {value3} {value4}",
                          {
                            value0: watcherLabel(hovered!, locale),
                            value1: Math.round(hovered!.x),
                            value2: Math.round(hovered!.y),
                            value3: hovered!.kind === "camp" ? t("Z 轴") : "Z",
                            value4:
                              hovered!.z === null
                                ? t("未知")
                                : Math.round(hovered!.z),
                          },
                        )}
                    {!measure && hoveredCamp && data.economy && (
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
                  className="flex flex-col items-stretch gap-1 text-[10px]"
                >
                  <h2 className="py-1 text-center text-[10px] font-semibold text-[var(--text-muted)]">
                    {t("地形")}
                  </h2>
                  <div className="flex flex-col gap-0.5">
                    {[{ id: "", label: t("底图") }, ...data.rasterLayers].map(
                      (layer) => (
                        <button
                          key={layer.id}
                          aria-pressed={terrainLayer === layer.id}
                          onClick={() => setTerrainLayer(layer.id)}
                          className={`${buttonStyle} !px-1 !py-1.5 !text-[10px] ${terrainLayer === layer.id ? "bg-white/10" : ""}`}
                        >
                          {t(layer.label)}
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
                  className={`${buttonStyle} !px-1 !py-1.5 !text-[10px] ${measure ? activeToolStyle : ""}`}
                  aria-pressed={measure}
                  onClick={() => {
                    setMeasure(!measure);
                    planner.stop();
                    setMeasurement([]);
                  }}
                >
                  {t("测距")}
                </button>
                <button
                  className={`${buttonStyle} !px-1 !py-1.5 !text-[10px] ${planner.enabled ? activeToolStyle : ""}`}
                  aria-pressed={planner.enabled}
                  onClick={() => {
                    planner.toggle();
                    setMeasure(false);
                    setMeasurement([]);
                  }}
                >
                  {t("寻路")}
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
                id="{value0} 测距为平面直线距离；范围圈不计算通行、碰撞、高低坡和战争迷雾。"
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
        <aside aria-label={t("选中对象属性与操作")} className="min-w-0 text-xs">
          {measurement.length > 0 && (
            <section
              aria-label={t("地图操作")}
              className="mb-3 flex flex-wrap items-center gap-1 rounded bg-white/[0.035] p-2"
            >
              {measurement.length > 0 && (
                <button
                  className={buttonStyle}
                  onClick={() => setMeasurement([])}
                >
                  {t("清除测距")}
                </button>
              )}
            </section>
          )}
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
              {selected.kind === "camp" && campLabels.has(selected.id) && (
                <div className="mt-3 space-y-1 border-t border-white/10 pt-3">
                  <p>
                    <Message
                      id="金币 {value0}"
                      values={{
                        value0:
                          campLabels.get(selected.id)!.gold ?? t("未收录"),
                      }}
                    />
                  </p>
                  <p>
                    <Message
                      id="经验 {value0}"
                      values={{
                        value0: campLabels.get(selected.id)!.xp,
                      }}
                    />
                  </p>
                  {campLabels.get(selected.id)!.timing.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
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
                    if (kind === "camp") setCampLayerHover(true);
                  }}
                  onPointerLeave={() => {
                    if (kind === "camp") setCampLayerHover(false);
                  }}
                  onFocus={() => {
                    if (kind === "camp") setCampLayerHover(true);
                  }}
                  onBlur={() => {
                    if (kind === "camp") setCampLayerHover(false);
                  }}
                  className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-1 text-[11px] hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    checked={layers.has(kind)}
                    onChange={() => {
                      hoverPoint(null);
                      setLayers((previous) => {
                        const next = new Set(previous);
                        if (next.has(kind)) next.delete(kind);
                        else next.add(kind);
                        return next;
                      });
                    }}
                    className="m-0 size-3.5 shrink-0 accent-[#a4c5bc]"
                  />
                  <span
                    className="shrink-0"
                    style={{ color: MAP_LAYERS[kind].color }}
                  >
                    {MAP_LAYERS[kind].symbol}
                  </span>
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
