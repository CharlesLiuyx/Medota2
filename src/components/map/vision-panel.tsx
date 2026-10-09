"use client";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale, useTranslations } from "@/i18n/provider";
import type { MapPoint, MapViewData } from "@/domain/map/schema";
import {
  createVisionSolver,
  visionGroundZ,
  type VisionPosition,
  type VisionRequest,
  type VisionSamples,
} from "@/domain/map/vision";
import {
  Move,
  Trash2,
  Sun,
  Moon,
  AlertTriangle,
  Eye,
  CircleCheck,
  LoaderCircle,
  Circle,
  CirclePause,
  MousePointer2,
  SquarePlus,
  ScanEye,
  Axe,
  RotateCcw,
} from "lucide-react";
import { HoverTooltip } from "@/components/ui/hover-tooltip";
import { ShortcutKey } from "./shortcut-key";
import { VisionClient } from "./vision-client";

import {
  visionPlacementIssue,
  detectedObservers,
  observersInSentryRange,
  heroVisionFootprint,
  snapVisionPosition,
  VISION_SOURCE_CELL,
  type PlacedVisionSource,
  type VisionPreset,
} from "@/domain/map/vision-sources";
import { VisionHeroPicker, VisionSourceIcon } from "./vision-hero-picker";
type Team = "radiant" | "dire";
type Source = PlacedVisionSource;
type Tool = "add" | "query" | "tree" | string | null;
type Preview = { id: string; position: VisionPosition } | null;
const teams: Team[] = ["radiant", "dire"];
export function useVisionPlanner(data: MapViewData) {
  const [enabled, setEnabled] = useState(false);
  const presets = data.visionPresets?.presets ?? [];
  const [placementKind, setPlacementKind] =
    useState<VisionPreset["kind"]>("observer");
  const [heroKey, setHeroKey] = useState("npc_dota_hero_axe");
  const presetKey =
    placementKind === "hero" ? heroKey : `item_ward_${placementKind}`;
  const draft = presets.find((p) => p.key === presetKey);
  const canPlace =
    !!draft &&
    draft.day !== null &&
    draft.night !== null &&
    draft.detection !== null;
  const draftValues = {
    kind: placementKind,
    presetKey,
    day: draft?.day ?? 0,
    night: draft?.night ?? 0,
    detection: draft?.detection ?? 0,
  };
  const gridBounds = data.visionScene?.scene.bounds ?? data.bounds;
  const snap = (position: VisionPosition) =>
    snapVisionPosition(position, data.bounds, gridBounds);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const singleSelectedSource =
    selectedSources.length === 1 ? selectedSources[0] : null;
  const [dragging, setDragging] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [mode, setMode] = useState<Team | "both">("radiant");
  const [placementTeam, setPlacementTeam] = useState<Team>("radiant");
  const team = mode === "both" ? placementTeam : mode;
  const [preview, setPreviewState] = useState<Preview>(null);
  const [rejectedPlacement, setRejectedPlacement] =
    useState<ReturnType<typeof visionPlacementIssue>>(null);
  const setPreview: typeof setPreviewState = (value) => {
    setRejectedPlacement(null);
    setPreviewState(value);
  };
  const placementIssue = (
    position: VisionPosition,
    kind: Source["kind"] = placementKind,
  ) =>
    visionPlacementIssue(position, data.bounds, data.routing?.grid, kind) ??
    visionPlacementIssue(snap(position), data.bounds, data.routing?.grid, kind);
  const previewIssue = preview
    ? placementIssue(
        preview.position,
        sources.find((source) => source.id === preview.id)?.kind ??
          placementKind,
      )
    : null;

  const [night, setNight] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  const [tool, setToolState] = useState<Tool>(null);
  const [target, setTarget] = useState<VisionPosition | null>(null);
  const [generation, setGeneration] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const [job, setJob] = useState<{
    base: string;
    status: string;
    progress: number;
    grids?: Partial<Record<Team, VisionSamples>>;
    elapsedMs?: number;
  } | null>(null);
  const sourceSequence = useRef(0);
  const clientsRef = useRef<Record<Team, VisionClient> | null>(null);
  const payload = data.visionScene;
  const visibleSources = sources.filter(
    (s) => mode === "both" || s.team === mode,
  );
  const effectivePreview =
    enabled &&
    !cancelled &&
    !previewIssue &&
    preview &&
    (preview.id !== "cursor" ||
      (tool === "add" && canPlace && sources.length < 8))
      ? preview
      : null;
  const effectiveSources: Source[] = effectivePreview
    ? effectivePreview.id === "cursor"
      ? [
          ...sources,
          { ...effectivePreview.position, id: "cursor", ...draftValues, team },
        ]
      : sources.map((s) =>
          s.id === effectivePreview.id
            ? { ...s, ...effectivePreview.position }
            : s,
        )
    : sources;
  const detectionIds = detectedObservers(
    effectiveSources,
    mode === "both" ? teams : [mode],
  );
  const sentryRangeIds = observersInSentryRange(effectiveSources, teams);
  const effectiveSourcesKey = JSON.stringify(effectiveSources);
  const requests = useMemo(() => {
    const active = JSON.parse(effectiveSourcesKey) as Source[];
    return Object.fromEntries(
      teams
        .filter((t) => mode === "both" || mode === t)
        .map((t) => [
          t,
          {
            sources: active
              .filter(
                (s) =>
                  s.team === t &&
                  s.kind !== "sentry" &&
                  (night ? s.night : s.day) > 0,
              )
              .map((s) => ({
                id: s.id,
                x: s.x,
                y: s.y,
                radius: night ? s.night : s.day,
              })),
            options: {
              treeRadius: 64,
              heightBand: 128,
              treeHeight: 128,
              removedTreeIds: removed,
            },
          },
        ]),
    ) as Partial<Record<Team, VisionRequest>>;
  }, [effectiveSourcesKey, mode, night, removed]);
  // A change of committed scenario invalidates coverage immediately. Pointer motion
  // retains only completed previews from that same scenario while a newer one runs.
  const base = JSON.stringify([
    payload?.datasetRevision,
    sources,
    mode,
    team,
    night,
    removed,
    generation,
    effectivePreview?.id,
    presetKey,
  ]);
  const key = JSON.stringify(requests);
  const desired = useRef({ requests, key });
  const pump = useRef<(() => void) | null>(null);
  useEffect(() => {
    desired.current = { requests, key };
    pump.current?.();
  }, [requests, key]);
  useEffect(() => {
    if (!payload) return;
    const clients = Object.fromEntries(
      teams.map((t) => [
        t,
        new VisionClient(payload.scene, payload.datasetRevision),
      ]),
    ) as Record<Team, VisionClient>;
    clientsRef.current = clients;
    return () => {
      teams.forEach((t) => clients[t].dispose());
      clientsRef.current = null;
    };
  }, [payload]);
  useEffect(() => {
    if (!enabled || cancelled || !clientsRef.current) return;
    const clients = clientsRef.current;
    let disposed = false,
      busy = false,
      completed = "";
    const run = () => {
      const next = desired.current;
      if (disposed || busy || completed === next.key) return;
      busy = true;
      setJob((previous) =>
        previous?.base === base && previous.grids
          ? previous
          : {
              base,
              status: "running",
              progress: 0,
              grids: previous?.base === base ? previous.grids : undefined,
            },
      );
      const started = performance.now();
      let lastProgress = 0;
      const progressByTeam = { radiant: 0, dire: 0 };
      void Promise.all(
        teams.map(async (t) => {
          const request = next.requests[t];
          if (!request?.sources.length) return [t, undefined] as const;
          const response = await clients[t].run(request, (progress) => {
            progressByTeam[t] = progress;
            const now = performance.now();
            if (disposed || progress === 1 || now - lastProgress < 80) return;
            lastProgress = now;
            const activeTeams = teams.filter(
              (team) => next.requests[team]?.sources.length,
            );
            setJob((previous) => ({
              base,
              status: "running",
              progress:
                activeTeams.reduce(
                  (total, team) => total + progressByTeam[team],
                  0,
                ) / activeTeams.length,
              grids: previous?.base === base ? previous.grids : undefined,
            }));
          });
          return [t, response.result] as const;
        }),
      )
        .then((entries) => {
          if (disposed) return;
          completed = next.key;
          setJob({
            base,
            status: "done",
            progress: 1,
            grids: Object.fromEntries(entries),
            elapsedMs: performance.now() - started,
          });
        })
        .catch((error) => {
          if (!disposed && error.name !== "AbortError") {
            completed = next.key;
            setJob({ base, status: "error", progress: 0 });
          }
        })
        .finally(() => {
          busy = false;
          if (!disposed) run();
        });
    };
    pump.current = run;
    run();
    return () => {
      disposed = true;
      pump.current = null;
      teams.forEach((t) => clients[t].cancel());
    };
  }, [enabled, base, cancelled]);
  const active = enabled && !cancelled && job?.base === base ? job : null;
  const results = useMemo(
    () =>
      Object.fromEntries(
        teams.map((t) => [
          t,
          payload && enabled && target && requests[t]
            ? createVisionSolver(
                payload.scene,
                requests[t]!.sources,
                requests[t]!.options,
              )(target)
            : null,
        ]),
      ),
    [payload, enabled, target, requests],
  );
  const syncSelectedHero = (id: string | null) => {
    const source = visibleSources.find((s) => s.id === id && s.kind === "hero");
    if (source) {
      setPlacementKind("hero");
      setHeroKey(source.presetKey);
    }
  };
  const setTool = (value: Tool) => {
    setToolState(value);
    setPreview(null);
    if (value === null) syncSelectedHero(singleSelectedSource);
  };
  const add = (position: VisionPosition, point?: MapPoint | null) => {
    if (
      sources.length >= 8 ||
      position.x < data.bounds.minX ||
      position.x >= data.bounds.maxX ||
      position.y < data.bounds.minY ||
      position.y >= data.bounds.maxY
    )
      return;
    const issue = placementIssue(position, point ? "custom" : placementKind);
    if (!point && issue) {
      setPreviewState({ id: "cursor", position });
      setRejectedPlacement(issue);
      return;
    }
    const preset = point ? data.visions?.[point.id] : undefined;
    if (!point && !canPlace) return;
    const id = `source-${++sourceSequence.current}`;
    setSelectedSources([id]);
    setSources((previous) => [
      ...previous,
      {
        ...snap(position),
        id,
        ...draftValues,
        ...(point
          ? {
              kind: "custom" as const,
              presetKey: "",
              day: preset?.day ?? 1800,
              night: preset?.night ?? 800,
              detection: 0,
            }
          : {}),
        team,
      },
    ]);
    setPreview(null);
    setCancelled(false);
    setToolState("add");
  };
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  const imageKey = JSON.stringify(
    [...new Set([presetKey, ...sources.map((s) => s.presetKey)])]
      .map((key) => presets.find((p) => p.key === key)?.imageUrl)
      .filter(Boolean),
  );
  useEffect(() => {
    let disposed = false;
    for (const url of JSON.parse(imageKey) as string[]) {
      const image = new window.Image();
      image.onload = () => {
        if (!disposed) setImages((previous) => ({ ...previous, [url]: image }));
      };
      image.src = url;
    }
    return () => {
      disposed = true;
    };
  }, [imageKey]);
  return {
    enabled,
    placementIssue,
    placementError: enabled ? (previewIssue ?? rejectedPlacement) : null,
    invalidPreview: enabled && preview && previewIssue ? preview : null,
    presets,
    draft,
    canPlace,
    placementKind,
    heroKey,
    images,
    effectiveSources,
    detectionIds,
    sentryRangeIds,
    setPlacementKind(value: VisionPreset["kind"]) {
      setPlacementKind(value);
      setCancelled(false);
      setPreview(null);
      setToolState("add");
    },
    togglePlacement(value: VisionPreset["kind"]) {
      if (tool === "add" && placementKind === value) setTool(null);
      else {
        setPlacementKind(value);
        setCancelled(false);
        setPreview(null);
        setToolState("add");
      }
    },
    setHeroKey(value: string) {
      const hero = presets.find((p) => p.kind === "hero" && p.key === value);
      if (
        !hero ||
        hero.day === null ||
        hero.night === null ||
        hero.detection === null
      )
        return;
      setHeroKey(value);
      setCancelled(false);
      setPreview(null);
      if (
        enabled &&
        tool === null &&
        visibleSources.some(
          (s) => s.id === singleSelectedSource && s.kind === "hero",
        )
      )
        setSources((previous) =>
          previous.map((source) =>
            source.id === singleSelectedSource &&
            source.kind === "hero" &&
            source.presetKey !== hero.key
              ? {
                  ...source,
                  presetKey: hero.key,
                  day: hero.day!,
                  night: hero.night!,
                  detection: hero.detection!,
                }
              : source,
          ),
        );
    },
    snap,
    gridBounds,
    selectedSource: singleSelectedSource,
    selectedSources,
    dragging,
    mode,
    team,
    placementTeam,
    setMode(value: Team | "both") {
      setMode(value);
      setPreview(null);
      setCancelled(false);
    },
    setPlacementTeam,
    visibleSources: sources.filter(
      (s) => visibleSources.includes(s) || detectionIds.has(s.id),
    ),
    preview: effectivePreview,
    setPreview(value: Preview) {
      const next = value
        ? {
            ...value,
            position:
              placementIssue(value.position) === "outside"
                ? value.position
                : snap(value.position),
          }
        : null;
      setPreview((previous) =>
        previous?.id === next?.id &&
        previous?.position.x === next?.position.x &&
        previous?.position.y === next?.position.y
          ? previous
          : next,
      );
    },
    selectSource(id: string | null, additive = false) {
      const next =
        id === null
          ? []
          : additive
            ? selectedSources.includes(id)
              ? selectedSources.filter((selected) => selected !== id)
              : [...selectedSources, id]
            : [id];
      setSelectedSources(next);
      if (next.length === 1) syncSelectedHero(next[0]);
      setToolState(null);
      setPreview(null);
    },
    beginDrag() {
      setDragging(true);
      setCancelled(false);
    },
    endDrag(id: string, position?: VisionPosition) {
      const source = sources.find((s) => s.id === id);
      const issue =
        position && source ? placementIssue(position, source.kind) : null;
      if (position && !issue)
        setSources((ss) =>
          ss.map((s) => (s.id === id ? { ...s, ...snap(position) } : s)),
        );
      setDragging(false);
      setPreview(null);
      setRejectedPlacement(issue);
    },
    heightAt(position: VisionPosition) {
      return payload ? visionGroundZ(payload.scene, position) : null;
    },
    available: !!payload,
    sources,
    night,
    setNight(value: boolean) {
      setNight(value);
      setCancelled(false);
    },
    removed,
    tool,
    setTool,
    target,
    results,
    result: results[mode === "both" ? team : mode],
    grids: active?.grids,
    samples: active?.grids?.radiant ?? active?.grids?.dire,
    elapsedMs: active?.elapsedMs,
    status: cancelled
      ? "cancelled"
      : (active?.status ??
        (enabled && (sources.length || effectivePreview) ? "pending" : "idle")),
    progress: active?.progress ?? 0,
    missingHeight: !!payload && !payload.scene.terrain,
    toggle() {
      setEnabled(!enabled);
      setTool(!enabled ? "add" : null);
    },
    stop() {
      setTool(null);
    },
    cancel() {
      setCancelled(true);
      setPreview(null);
    },
    retry() {
      setCancelled(false);
      setGeneration((n) => n + 1);
    },
    restore() {
      setCancelled(false);
      setRemoved([]);
    },
    update(id: string, values: Partial<Source>) {
      setCancelled(false);
      setSources((ss) =>
        ss.map((s) => (s.id === id ? { ...s, ...values } : s)),
      );
    },
    remove(id: string) {
      setSelectedSources(selectedSources.filter((selected) => selected !== id));
      setSources((ss) => ss.filter((s) => s.id !== id));
      setPreview(null);
    },
    removeSelected() {
      const ids = new Set(
        sources
          .filter(
            (s) =>
              selectedSources.includes(s.id) &&
              (visibleSources.includes(s) || detectionIds.has(s.id)),
          )
          .map((s) => s.id),
      );
      setSources((ss) => ss.filter((s) => !ids.has(s.id)));
      setSelectedSources(selectedSources.filter((id) => !ids.has(id)));
      setPreview(null);
    },
    add,
    pick(position: VisionPosition, point: MapPoint | null) {
      if (!enabled || !tool) return false;
      if (tool === "add") add(position);
      else if (tool === "query") {
        setPreview(null);
        setTarget(snap(position));
      } else if (tool === "tree") {
        if (point?.kind === "tree")
          setRemoved((ids) =>
            ids.includes(point.id)
              ? ids.filter((id) => id !== point.id)
              : [...ids, point.id],
          );
      } else {
        const source = sources.find((s) => s.id === tool);
        const issue = placementIssue(position, source?.kind);
        if (issue) {
          setPreviewState({ id: tool, position });
          setRejectedPlacement(issue);
          return true;
        }
        setSources((ss) =>
          ss.map((s) => (s.id === tool ? { ...s, ...snap(position) } : s)),
        );
        setTool(null);
      }
      return true;
    },
  };
}
export type VisionPlanner = ReturnType<typeof useVisionPlanner>;
/** Keep high-frequency worker and pointer state out of the full map component. */
export function VisionController({
  data,
  selected,
  activate,
  onFrame,
}: {
  data: MapViewData;
  selected: MapPoint | null;
  activate(): void;
  onFrame(
    planner: VisionPlanner,
    texture: VisionTexture | null,
    repaint: boolean,
  ): void;
}) {
  const planner = useVisionPlanner(data);
  const texture = useMemo(() => visionTexture(planner.grids), [planner.grids]);
  const previous = useRef<unknown[]>([]);
  useLayoutEffect(() => {
    const inputs = [
      planner.enabled,
      planner.grids,
      planner.preview,
      planner.invalidPreview,
      planner.mode,
      planner.sources,
      planner.removed,
      planner.target,
      planner.tool,
      planner.selectedSources,
      planner.dragging,
      planner.images,
      planner.draft,
    ];
    const repaint = inputs.some(
      (value, index) => value !== previous.current[index],
    );
    previous.current = inputs;
    onFrame(planner, texture, repaint);
  });
  return (
    <VisionPanel
      planner={planner}
      data={data}
      selected={selected}
      activate={activate}
    />
  );
}
const button =
  "rounded bg-white/5 px-2 py-1 hover:bg-white/10 aria-pressed:bg-cyan-300/20 aria-pressed:text-cyan-100 disabled:opacity-40";
/** Stable event delegates let the controls retain their rendered snapshot while
 * pointer-only state advances. The current planner is installed after commit. */
class PanelActions {
  readonly methods: Record<string, (...args: unknown[]) => unknown>;
  constructor(private planner: VisionPlanner) {
    this.methods = Object.fromEntries(
      Object.entries(planner)
        .filter(([, value]) => typeof value === "function")
        .map(([key]) => [
          key,
          (...args: unknown[]) =>
            (
              this.planner[key as keyof VisionPlanner] as (
                ...args: unknown[]
              ) => unknown
            )(...args),
        ]),
    );
  }
  update(planner: VisionPlanner) {
    this.planner = planner;
  }
}
export function VisionPanel(props: {
  planner: VisionPlanner;
  selected: MapPoint | null;
  data: MapViewData;
  activate(): void;
}) {
  const { planner: p } = props;
  const t = useTranslations();
  const [actions] = useState(() => new PanelActions(p));
  useLayoutEffect(() => {
    actions.update(p);
  });
  // Only fields actually shown by the sidebar. Pointer coverage and images stay
  // in the Canvas controller; callbacks always address the current planner.
  const panelKey = JSON.stringify([
    p.enabled,
    p.canPlace,
    p.placementKind,
    p.heroKey,
    p.selectedSources,
    p.mode,
    p.team,
    p.placementTeam,
    p.visibleSources,
    [...p.detectionIds],
    [...p.sentryRangeIds],
    p.sources,
    p.night,
    p.removed,
    p.tool,
    p.target,
    p.results,
    p.status,
    p.progress,
    p.missingHeight,
    p.placementError,
  ]);
  if (!p.enabled) return null;
  return (
    <section
      aria-label={t("视野模拟")}
      data-placement-error={p.placementError ?? ""}
      data-vision-preview={
        p.preview
          ? `${p.preview.id}:${p.preview.position.x},${p.preview.position.y}`
          : ""
      }
    >
      <MemoVisionPanel
        {...props}
        planner={{ ...p, ...actions.methods }}
        panelKey={panelKey}
      />
    </section>
  );
}
const MemoVisionPanel = memo(
  VisionPanelContents,
  (a, b) =>
    a.panelKey === b.panelKey &&
    a.data === b.data &&
    a.selected === b.selected &&
    a.activate === b.activate,
);
function VisionPanelContents({
  planner: p,
  selected,
  data,
  activate,
}: {
  planner: VisionPlanner;
  selected: MapPoint | null;
  data: MapViewData;
  activate(): void;
  panelKey: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  if (!p.enabled) return null;
  const choose = (tool: Tool) => {
    activate();
    p.setTool(p.tool === tool ? null : tool);
  };
  const result = p.result;
  const info = (text: string) => (
    <HoverTooltip
      content={t(text)}
      className="rounded-full px-1 text-[var(--text-muted)]"
    >
      <span aria-hidden="true">ⓘ</span>
      <span className="sr-only">{t(text)}</span>
    </HoverTooltip>
  );
  const reason =
    result?.status === "visible"
      ? t("可见")
      : result?.status === "out-of-range"
        ? t("范围外")
        : result?.status === "blocked"
          ? result.reason === "tree"
            ? t("树木遮挡")
            : t("高地遮挡")
          : result?.status === "unknown"
            ? result.reason === "missing-height"
              ? t("缺少高度，结果未知")
              : t("地图范围外，结果未知")
            : "";
  const statusText = t(
    (
      {
        idle: "等待来源",
        pending: "等待计算",
        running: "正在计算视野",
        done: "视野计算完成",
        cancelled: "视野计算已取消",
        error: "视野计算失败",
      } as Record<string, string>
    )[p.status],
  );
  const statusLabel =
    statusText +
    (p.status === "running" ? ` ${Math.round(p.progress * 100)}%` : "");
  const StatusIcon =
    p.status === "done"
      ? CircleCheck
      : p.status === "pending" || p.status === "running"
        ? LoaderCircle
        : p.status === "error"
          ? AlertTriangle
          : p.status === "cancelled"
            ? CirclePause
            : Circle;
  return (
    <div className="mb-3 space-y-2 rounded bg-white/[0.035] p-2 text-[11px]">
      <div className="flex items-center justify-between gap-1">
        <h2 className="min-w-0 flex-1 font-semibold">
          {t("视野模拟")} · {t("近似估算")}
        </h2>
        <span role="status" data-vision-status={p.status} className="shrink-0">
          <HoverTooltip
            className={`grid size-5 place-items-center rounded ${p.status === "done" ? "text-emerald-300" : p.status === "error" ? "text-red-300" : p.status === "running" || p.status === "pending" ? "text-cyan-200" : "text-[var(--text-muted)]"}`}
            buttonProps={{ "aria-label": statusLabel }}
            content={
              <div>
                <p>{statusLabel}</p>
                {p.removed.length > 0 && (
                  <p>{t("已移除 {count} 棵树", { count: p.removed.length })}</p>
                )}
              </div>
            }
          >
            <StatusIcon
              aria-hidden="true"
              className={`size-3.5 ${p.status === "running" || p.status === "pending" ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
          </HoverTooltip>
          <span className="sr-only">{statusLabel}</span>
          {p.removed.length > 0 && (
            <span className="sr-only">
              {t("已移除 {count} 棵树", { count: p.removed.length })}
            </span>
          )}
        </span>
        <HoverTooltip
          width={360}
          className="shrink-0 rounded-full px-1 text-[var(--text-muted)]"
          content={
            <div className="max-h-[min(480px,60dvh)] space-y-3 overflow-y-auto text-xs leading-5">
              <section>
                <h3 className="mb-1 font-semibold text-white">
                  {t("操作方式")}
                </h3>
                <ul className="space-y-1">
                  <li>
                    {t(
                      "放置：按1/2/3或点击选择守卫、英雄；再次选择当前项回到选中模式。移动预览，点击连续添加，最多8个来源。",
                    )}
                  </li>
                  <li>
                    {t(
                      "移动：Esc进入选中模式，点击来源后拖动；拖动中Esc撤销，选中模式再按Esc关闭工具。",
                    )}
                  </li>
                  <li>
                    {t("昼夜：切换当前使用的半径；各来源数值可单独编辑。")}
                  </li>
                  <li>
                    {t(
                      "查询：点击地图查看可见性与遮挡原因。砍树只改变视野情景，可随时恢复。",
                    )}
                  </li>
                </ul>
              </section>
              <section className="border-t border-white/10 pt-2">
                <h3 className="mb-1 font-semibold text-white">
                  {t("视野颜色")}
                </h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {[
                    ["#2eff88", "天辉"],
                    ["#f472b6", "夜魇"],
                    ["#dcf5ff", "双方可见"],
                    ["#73808e", "遮挡"],
                    ["#eab308", "未知"],
                  ].map(([color, label]) => (
                    <span key={label} className="flex items-center gap-2">
                      <i
                        className="size-2.5 rounded-sm"
                        style={{ background: color }}
                      />
                      {t(label)}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-[var(--text-muted)]">
                  {t("范围外透明；双方视野独立计算，同队来源合并。")}
                </p>
              </section>
              <section className="border-t border-white/10 pt-2">
                <h3 className="mb-1 font-semibold text-white">
                  {t("高地与岗哨标记")}
                </h3>
                <p className="text-blue-300">
                  {t("蓝色轮廓：高地（Z≥192）；紫色填充：更高地面（Z≥320）。")}
                </p>
                <p>
                  {t(
                    "进入工具自动显示高地，缺少高度处不标注；高地颜色不代表视野。",
                  )}
                </p>
                <p className="text-[#fca5e1]">
                  {t(
                    "粉紫网格禁止放置视野点；非法落点显示红叉，点击无效，拖动松手恢复原位。英雄还需可通行格。",
                  )}
                </p>
                <p>
                  {t(
                    "选中模式下，点击空白取消选择，Shift 点击增选或取消该点；普通点击单选并可拖动，Delete / Backspace 删除所选视野点。",
                  )}
                </p>
                <p className="text-cyan-200">
                  {t(
                    "蓝色眼睛：侦查守卫位于岗哨范围内。金色警示：位于敌方岗哨范围内。",
                  )}
                </p>
                <p className="text-[var(--text-muted)]">
                  {t("岗哨范围只表示距离关系，不等于已经获得地面视野。")}
                </p>
              </section>
              <details className="border-t border-white/10 pt-2">
                <summary className="cursor-pointer font-semibold text-white">
                  {t("计算范围与限制")}
                </summary>
                <p className="mt-1">
                  {t(
                    "守卫和英雄参数来自当前图鉴版本；位置按64单位格对齐，高地按128单位高度分层。树木与地形共同参与近似遮挡。",
                  )}
                </p>
                <p>
                  {t(
                    "模型未校准游戏引擎，不包含专用战争迷雾、飞行视野、通用隐身规则或视野延迟。查询原因不保证是唯一阻挡。",
                  )}
                </p>
              </details>
            </div>
          }
        >
          <span aria-hidden="true">ⓘ</span>
          <span className="sr-only">{t("视野模拟说明")}</span>
        </HoverTooltip>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {(["radiant", "dire", "both"] as const).map((mode) => (
          <button
            key={mode}
            className={`${button} min-w-0 whitespace-nowrap !px-0.5 text-[10px] tracking-tight`}
            aria-label={t(
              mode === "radiant"
                ? "天辉视野"
                : mode === "dire"
                  ? "夜魇视野"
                  : "双方视野",
            )}
            aria-pressed={p.mode === mode}
            onClick={() => p.setMode(mode)}
          >
            {t(
              locale === "en" && mode !== "both"
                ? mode === "radiant"
                  ? "天辉"
                  : "夜魇"
                : mode === "radiant"
                  ? "天辉视野"
                  : mode === "dire"
                    ? "夜魇视野"
                    : "双方视野",
            )}
          </button>
        ))}
      </div>
      {p.mode === "both" && (
        <div className="flex items-center gap-1">
          <span>{t("新增来源阵营")}</span>
          {teams.map((team) => (
            <button
              key={team}
              className={button}
              aria-pressed={p.placementTeam === team}
              onClick={() => p.setPlacementTeam(team)}
            >
              {t(team === "radiant" ? "天辉" : "夜魇")}
            </button>
          ))}
        </div>
      )}
      {p.missingHeight && (
        <p role="status">
          {t("此版本缺少高度；范围内无法确认可见的区域保留未知。")}
        </p>
      )}
      <div className="grid grid-cols-3 gap-1" aria-label={t("来源类型")}>
        {(["observer", "sentry", "hero"] as const).map((kind, index) => (
          <button
            key={kind}
            className={`${button} relative flex flex-col items-center !px-0.5`}
            aria-keyshortcuts={String(index + 1)}
            aria-pressed={p.tool === "add" && p.placementKind === kind}
            aria-label={t(
              kind === "observer"
                ? "侦查守卫"
                : kind === "sentry"
                  ? "岗哨守卫"
                  : "英雄",
            )}
            onClick={() => {
              activate();
              p.togglePlacement(kind);
            }}
          >
            <span className="absolute right-0.5 top-0.5">
              <ShortcutKey value={String(index + 1)} />
            </span>
            <VisionSourceIcon
              preset={p.presets.find(
                (v) =>
                  v.key === (kind === "hero" ? p.heroKey : `item_ward_${kind}`),
              )}
            />
            <span>
              {t(
                kind === "observer"
                  ? "侦查守卫"
                  : kind === "sentry"
                    ? "岗哨守卫"
                    : "英雄",
              )}
            </span>
          </button>
        ))}
      </div>
      {p.placementKind === "hero" && (
        <VisionHeroPicker
          heroes={p.presets.filter((v) => v.kind === "hero")}
          value={p.heroKey}
          onChange={p.setHeroKey}
        />
      )}
      {!p.canPlace && (
        <p role="status">{t("此版本缺少来源参数，暂不能放置。")}</p>
      )}
      {p.draft && (
        <p className="text-[var(--text-muted)]">
          {p.placementKind === "sentry"
            ? t("反隐范围：{radius}；不提供视野", {
                radius: p.draft.detection ?? "—",
              })
            : t("白天 {day}／夜晚 {night}", {
                day: p.draft.day ?? "—",
                night: p.draft.night ?? "—",
              })}
        </p>
      )}
      <div
        role="group"
        aria-label={t("视野操作")}
        className="grid grid-cols-7 gap-0.5"
      >
        {[
          {
            label: "选中模式",
            Icon: MousePointer2,
            pressed: p.tool === null,
            action: () => p.setTool(null),
            hint: "点击单选，Shift 点击多选，点击空白取消选择",
          },
          {
            label: "白天",
            Icon: Sun,
            pressed: !p.night,
            action: () => p.setNight(false),
          },
          {
            label: "夜晚",
            Icon: Moon,
            pressed: p.night,
            action: () => p.setNight(true),
          },
          {
            label: "添加所选对象",
            Icon: SquarePlus,
            disabled: !selected || p.sources.length >= 8,
            action: () => selected && p.add(selected, selected),
          },
          {
            label: "查询选点",
            Icon: ScanEye,
            pressed: p.tool === "query",
            action: () => choose("query"),
          },
          {
            label: "砍树／恢复",
            Icon: Axe,
            pressed: p.tool === "tree",
            action: () => choose("tree"),
          },
          {
            label: "恢复全部树木",
            Icon: RotateCcw,
            disabled: !p.removed.length,
            action: p.restore,
          },
        ].map(({ label, Icon, pressed, disabled, action, hint }) => (
          <HoverTooltip
            key={label}
            width={220}
            className={`${button} grid h-7 min-w-0 place-items-center !p-0`}
            buttonProps={{
              "aria-label": t(label),
              "aria-pressed": pressed,
              disabled,
              onClick: action,
            }}
            content={
              <div>
                <p className="font-semibold">{t(label)}</p>
                {hint && (
                  <p className="mt-1 text-[var(--text-muted)]">{t(hint)}</p>
                )}
              </div>
            }
          >
            <Icon aria-hidden="true" className="size-4" />
          </HoverTooltip>
        ))}
      </div>
      <ol className="space-y-1.5">
        {p.visibleSources.map((s) => {
          const preset = p.presets.find((v) => v.key === s.presetKey);
          const number = p.sources.indexOf(s) + 1;
          const name =
            s.kind === "custom"
              ? t("自定义来源")
              : preset
                ? locale === "en"
                  ? preset.enName
                  : preset.zhName
                : "—";
          const sourceLabel = `${t("来源 {number}", { number })} · ${t(s.team === "radiant" ? "天辉" : "夜魇")} · ${Math.round(s.x)}, ${Math.round(s.y)}`;
          const detected = p.detectionIds.has(s.id);
          const inSentryRange = p.sentryRangeIds.has(s.id);
          return (
            <li
              key={s.id}
              data-detected={detected || undefined}
              data-sentry-range={inSentryRange || undefined}
              data-selected={p.selectedSources.includes(s.id)}
              className={`flex min-w-0 items-center gap-0.5 rounded border px-0.5 py-1 ${p.selectedSources.includes(s.id) ? "border-cyan-200/80 bg-cyan-300/15 ring-1 ring-cyan-300/20" : detected ? "border-amber-300/70 bg-amber-300/10" : inSentryRange ? "border-cyan-300/40 bg-cyan-300/5" : "border-transparent bg-white/[0.025]"}`}
            >
              <HoverTooltip
                className={`relative flex h-6 w-7 shrink-0 items-center justify-center gap-0.5 rounded text-left ${p.selectedSources.includes(s.id) ? "text-cyan-100" : "hover:bg-white/5"}`}
                buttonProps={{
                  "aria-label": sourceLabel,
                  "aria-pressed": p.selectedSources.includes(s.id),
                  onClick: (event) => p.selectSource(s.id, event.shiftKey),
                }}
                content={
                  <div className="space-y-1">
                    <p className="font-semibold">{name}</p>
                    <p>{sourceLabel}</p>
                    <p>
                      {t("地面 Z：{height}", {
                        height:
                          p.heightAt(s) === null
                            ? t("未知")
                            : Math.round(p.heightAt(s)! * 10) / 10,
                      })}
                    </p>
                    {s.kind === "hero" && (
                      <p>
                        {t("碰撞半径：{radius}", {
                          radius: preset?.collisionRadius ?? t("未知"),
                        })}
                      </p>
                    )}
                    {s.kind === "sentry" && (
                      <p>
                        {t("反隐范围：{radius}；不提供视野", {
                          radius: s.detection,
                        })}
                      </p>
                    )}
                    {inSentryRange && !detected && (
                      <p className="text-cyan-200">{t("位于岗哨反隐范围内")}</p>
                    )}
                    {detected && (
                      <p className="text-amber-200">
                        {t("位于敌方岗哨反隐范围内")}
                      </p>
                    )}
                  </div>
                }
              >
                <VisionSourceIcon preset={preset} size={16} />
                <span className="sr-only">{name}</span>
                <span className="shrink-0 text-[9px] text-[var(--text-muted)]">
                  {number}
                </span>
                <span className="sr-only">{sourceLabel}</span>
                {inSentryRange && !detected && (
                  <Eye
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-1 h-2.5 w-2.5 text-cyan-200"
                  />
                )}
                {detected && (
                  <AlertTriangle
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-1 h-2.5 w-2.5 text-amber-200"
                  />
                )}
              </HoverTooltip>
              {s.kind !== "sentry" && (
                <div className="flex min-w-0 flex-1 gap-0.5">
                  {(["day", "night"] as const).map((period) => {
                    const Icon = period === "day" ? Sun : Moon;
                    return (
                      <label
                        key={period}
                        className="flex min-w-0 flex-1 items-center gap-0.5 rounded bg-white/5 px-0.5"
                      >
                        <HoverTooltip
                          content={
                            period === "day" ? t("白天半径") : t("夜晚半径")
                          }
                          className="shrink-0 text-[var(--text-muted)]"
                        >
                          <Icon aria-hidden="true" className="h-2.5 w-2.5" />
                          <span className="sr-only">
                            {period === "day" ? t("白天半径") : t("夜晚半径")}
                          </span>
                        </HoverTooltip>
                        <input
                          className="h-6 w-0 min-w-0 flex-1 bg-transparent text-[10px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          type="number"
                          min={0}
                          max={32768}
                          aria-label={t(
                            period === "day"
                              ? "来源 {number} 白天半径"
                              : "来源 {number} 夜晚半径",
                            { number },
                          )}
                          value={s[period]}
                          onChange={(e) => {
                            const value = e.target.valueAsNumber;
                            if (
                              Number.isFinite(value) &&
                              value >= 0 &&
                              value <= 32768
                            )
                              p.update(s.id, { [period]: value });
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              )}
              {s.kind === "sentry" && (
                <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-muted)]">
                  {name}
                </span>
              )}
              <HoverTooltip
                content={t("移动来源")}
                className={`grid h-6 w-[18px] shrink-0 place-items-center rounded hover:bg-white/10 ${p.tool === s.id ? "bg-cyan-300/20 text-cyan-100" : "text-[var(--text-secondary)]"}`}
                buttonProps={{
                  "aria-label": t("移动来源"),
                  "aria-pressed": p.tool === s.id,
                  onClick: () => choose(s.id),
                }}
              >
                <Move aria-hidden="true" className="h-3.5 w-3.5" />
              </HoverTooltip>
              <HoverTooltip
                content={`${t("移除来源")} · Delete`}
                className="grid h-6 w-[18px] shrink-0 place-items-center rounded text-[var(--text-secondary)] hover:bg-red-400/15 hover:text-red-200"
                buttonProps={{
                  "aria-label": t("移除来源"),
                  onClick: () => p.remove(s.id),
                }}
              >
                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
              </HoverTooltip>
            </li>
          );
        })}
      </ol>
      {p.placementError && (
        <p role="status" className="text-[11px] text-red-300">
          {t(
            {
              outside: "地图范围外，不能放置。",
              "no-ward": "禁放区域，不能放置视野点。",
              unknown: "此格导航标记未知，不能放置。",
              blocked: "此处不可通行，不能放置英雄。",
            }[p.placementError],
          )}
        </p>
      )}
      {(p.status === "running" || p.status === "pending") && (
        <button className={button} onClick={p.cancel}>
          {t("取消视野计算")}
        </button>
      )}
      {(p.status === "cancelled" || p.status === "error") && (
        <button className={button} onClick={p.retry}>
          {t("重新计算")}
        </button>
      )}
      {p.target && (
        <div aria-label={t("选点视野原因")} className="space-y-1">
          <p>
            {Math.round(p.target.x)}, {Math.round(p.target.y)} ·{" "}
            {t("地面 Z：{height}", {
              height:
                p.heightAt(p.target) === null
                  ? t("未知")
                  : Math.round(p.heightAt(p.target)! * 10) / 10,
            })}{" "}
            · {reason}
          </p>
          {result && "sourceId" in result && (
            <p>
              {t("来源 {number}", {
                number:
                  p.sources.findIndex((s) => s.id === result.sourceId) + 1,
              })}
            </p>
          )}
          {result?.status === "blocked" && result.obstacleId && (
            <p>
              {t("遮挡树坐标：{position}", {
                position: (() => {
                  const tree = data.points.find(
                    (v) => v.id === result.obstacleId,
                  );
                  return tree ? `${tree.x}, ${tree.y}` : "—";
                })(),
              })}
            </p>
          )}
          {p.mode === "both" && (
            <p>
              {teams
                .map(
                  (team) =>
                    `${t(team === "radiant" ? "天辉" : "夜魇")}: ${t(p.results[team]?.status === "visible" ? "可见" : p.results[team]?.status === "blocked" ? "遮挡" : p.results[team]?.status === "unknown" ? "未知" : "范围外")}`,
                )
                .join(" · ")}
            </p>
          )}
          {info(
            "原因是一个解释线索，不保证最近或唯一阻挡体；查询与色块使用同一格中心。",
          )}
        </div>
      )}
    </div>
  );
}

export type VisionTexture = {
  canvas: HTMLCanvasElement;
  col: number;
  row: number;
};
const visionPalette = [
  [0, 0, 0, 0],
  [220, 245, 255, 130],
  [46, 255, 136, 160],
  [244, 114, 182, 110],
  [251, 191, 36, 102],
  [148, 163, 184, 70],
];
/** Crop coverage to its occupied rectangle. Pan/zoom only composites this raster. */
export function visionTexture(
  grids: VisionPlanner["grids"],
): VisionTexture | null {
  const samples = grids?.radiant ?? grids?.dire;
  if (!samples) return null;
  let left = samples.width,
    right = -1,
    bottom = samples.height,
    top = -1;
  const radiant = grids?.radiant?.cells,
    dire = grids?.dire?.cells;
  const active = [grids?.radiant, grids?.dire].filter(
    (grid): grid is VisionSamples => !!grid,
  );
  if (active.every((grid) => grid.extent !== undefined)) {
    for (const grid of active) {
      if (!grid.extent) continue;
      left = Math.min(left, grid.extent.col);
      right = Math.max(right, grid.extent.endCol);
      bottom = Math.min(bottom, grid.extent.row);
      top = Math.max(top, grid.extent.endRow);
    }
  } else {
    for (let i = 0; i < samples.cells.length; i++) {
      if (!(radiant?.[i] || dire?.[i])) continue;
      const col = i % samples.width,
        row = Math.floor(i / samples.width);
      left = Math.min(left, col);
      right = Math.max(right, col);
      bottom = Math.min(bottom, row);
      top = Math.max(top, row);
    }
  }
  if (right < left) return null;
  const canvas = document.createElement("canvas");
  canvas.width = right - left + 1;
  canvas.height = top - bottom + 1;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let y = bottom; y <= top; y++)
    for (let x = left; x <= right; x++) {
      const i = y * samples.width + x,
        r = radiant?.[i] ?? 0,
        d = dire?.[i] ?? 0;
      const color =
        visionPalette[
          r === 1 && d === 1
            ? 1
            : r === 1
              ? 2
              : d === 1
                ? 3
                : r === 3 || d === 3
                  ? 4
                  : r || d
                    ? 5
                    : 0
        ];
      pixels.data.set(color, ((top - y) * canvas.width + x - left) * 4);
    }
  context.putImageData(pixels, 0, 0);
  return { canvas, col: left, row: bottom };
}
export function visionHeroIconSize(size: number, hovered: boolean) {
  return hovered ? Math.max(32, size * 1.6) : size;
}

export function drawVision(
  context: CanvasRenderingContext2D,
  p: VisionPlanner,
  texture: VisionTexture | null,
  screen: (p: VisionPosition) => VisionPosition,
  data: MapViewData,
  preview?: { id: string; position: VisionPosition; moving: boolean },
  hoveredSourceId?: string | null,
) {
  if (!p.enabled) return;
  context.save();
  if (texture && p.samples) {
    const { bounds, cell } = p.samples;
    const a = screen({
      x: bounds.minX + texture.col * cell,
      y: bounds.minY + (texture.row + texture.canvas.height) * cell,
    });
    const b = screen({
      x: bounds.minX + (texture.col + texture.canvas.width) * cell,
      y: bounds.minY + texture.row * cell,
    });
    const top = screen({ x: data.bounds.minX, y: data.bounds.maxY });
    const bottom = screen({ x: data.bounds.maxX, y: data.bounds.minY });
    context.beginPath();
    context.rect(top.x, top.y, bottom.x - top.x, bottom.y - top.y);
    context.clip();
    context.imageSmoothingEnabled = false;
    context.drawImage(texture.canvas, a.x, a.y, b.x - a.x, b.y - a.y);
  }
  context.restore();
  context.save();
  // Artwork fills the hull's occupied placement-grid bounds at world scale.
  const liveSources = p.effectiveSources.map((source) =>
    preview?.id === source.id &&
    !p.placementIssue(preview.position, source.kind)
      ? { ...source, ...p.snap(preview.position) }
      : source,
  );
  const invalid =
    preview &&
    p.placementIssue(
      preview.position,
      p.sources.find((source) => source.id === preview.id)?.kind,
    )
      ? preview
      : p.invalidPreview;
  if (invalid) {
    const position =
      p.placementIssue(invalid.position) === "outside"
        ? invalid.position
        : p.snap(invalid.position);
    const at = screen(position);
    const edge = screen({ x: position.x + VISION_SOURCE_CELL, y: position.y });
    const size = Math.max(12, Math.abs(edge.x - at.x));
    context.fillStyle = "#ef444433";
    context.strokeStyle = "#fca5a5";
    context.lineWidth = 2;
    context.fillRect(at.x - size / 2, at.y - size / 2, size, size);
    context.strokeRect(at.x - size / 2, at.y - size / 2, size, size);
    context.beginPath();
    context.moveTo(at.x - 4, at.y - 4);
    context.lineTo(at.x + 4, at.y + 4);
    context.moveTo(at.x + 4, at.y - 4);
    context.lineTo(at.x - 4, at.y + 4);
    context.stroke();
  }
  const detected = detectedObservers(
    liveSources,
    p.mode === "both" ? teams : [p.mode],
  );
  const covered = observersInSentryRange(liveSources, teams);
  const visible = liveSources.filter(
    (source) =>
      p.mode === "both" || source.team === p.mode || detected.has(source.id),
  );
  visible
    .filter((source) => source.kind === "sentry")
    .forEach((source) => {
      const at = screen(source),
        edge = screen({ x: source.x + source.detection, y: source.y });
      context.beginPath();
      context.arc(at.x, at.y, Math.abs(edge.x - at.x), 0, Math.PI * 2);
      context.fillStyle = source.team === "radiant" ? "#22d3ee12" : "#f472b612";
      context.fill();
      context.strokeStyle = source.team === "radiant" ? "#67e8f9" : "#f9a8d4";
      context.lineWidth = 1.5;
      context.setLineDash([5, 4]);
      context.stroke();
      context.setLineDash([]);
    });
  // Keep the selected source and its badge above nearby/overlapping markers.
  const emphasis = (id: string) =>
    Number(p.selectedSources.includes(id)) * 2 + Number(id === hoveredSourceId);
  visible.sort((a, b) => emphasis(a.id) - emphasis(b.id));
  visible.forEach((source) => {
    const at = screen(source);
    const preset = p.presets.find((v) => v.key === source.presetKey);
    const hull = source.kind === "hero" ? preset?.collisionRadius : null;
    const footprint = heroVisionFootprint(source, hull, p.gridBounds);
    const cellStart = {
      x:
        p.gridBounds.minX +
        Math.floor((source.x - p.gridBounds.minX) / VISION_SOURCE_CELL) *
          VISION_SOURCE_CELL,
      y:
        p.gridBounds.minY +
        Math.floor((source.y - p.gridBounds.minY) / VISION_SOURCE_CELL) *
          VISION_SOURCE_CELL,
    };
    const a = screen({
        x: cellStart.x,
        y: Math.min(cellStart.y + VISION_SOURCE_CELL, data.bounds.maxY),
      }),
      b = screen({
        x: Math.min(cellStart.x + VISION_SOURCE_CELL, data.bounds.maxX),
        y: cellStart.y,
      });
    const color = source.team === "radiant" ? "#a7f3d0" : "#f9a8d4";
    const cursor = source.id === "cursor";
    const selected = p.selectedSources.includes(source.id);
    context.fillStyle = color;
    context.strokeStyle = detected.has(source.id)
      ? "#fbbf24"
      : selected
        ? "#fde68a"
        : color;
    context.lineWidth = 1;
    context.globalAlpha = cursor ? 0.45 : 0.6;
    // Show exactly the cells intersected by the hull, with no artwork frame.
    if (footprint) {
      for (const cell of footprint.cells) {
        const top = screen({ x: cell.minX, y: cell.maxY });
        const bottom = screen({ x: cell.maxX, y: cell.minY });
        context.fillRect(top.x, top.y, bottom.x - top.x, bottom.y - top.y);
        if (cursor)
          context.strokeRect(top.x, top.y, bottom.x - top.x, bottom.y - top.y);
      }
    } else if (source.kind !== "hero") {
      context.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      if (cursor || selected)
        context.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    context.globalAlpha = 1;
    const iconBounds = footprint?.bounds;
    const iconTop = iconBounds
      ? screen({ x: iconBounds.minX, y: iconBounds.maxY })
      : at;
    const iconBottom = iconBounds
      ? screen({ x: iconBounds.maxX, y: iconBounds.minY })
      : at;
    const iconCenter = iconBounds
      ? {
          x: (iconTop.x + iconBottom.x) / 2,
          y: (iconTop.y + iconBottom.y) / 2,
        }
      : at;
    const size = iconBounds
      ? Math.min(
          Math.abs(iconBottom.x - iconTop.x),
          Math.abs(iconBottom.y - iconTop.y),
        )
      : Math.max(20, Math.abs(b.x - a.x));
    const image = preset?.imageUrl ? p.images[preset.imageUrl] : null;
    const iconSize = !cursor
      ? visionHeroIconSize(size, source.id === hoveredSourceId)
      : size;
    // While choosing a position, expose the exact footprint and underlying grid.
    if (!cursor && image) {
      const ratio =
        iconSize / Math.max(image.naturalWidth, image.naturalHeight);
      const w = image.naturalWidth * ratio,
        h = image.naturalHeight * ratio;
      context.drawImage(
        image,
        iconCenter.x - w * (preset?.imageAnchor?.[0] ?? 0.5),
        iconCenter.y - h * (preset?.imageAnchor?.[1] ?? 0.5),
        w,
        h,
      );
    } else if (!cursor && !image && source.kind !== "hero") {
      context.fillStyle = color;
      const dot = source.id === hoveredSourceId ? 8 : 4;
      context.fillRect(at.x - dot / 2, at.y - dot / 2, dot, dot);
    }
    // Selection stays visible above the opaque artwork and follows its grid bounds.
    if (selected && !cursor && footprint) {
      context.strokeStyle = "#fde68a";
      context.lineWidth = 2;
      context.strokeRect(
        iconTop.x,
        iconTop.y,
        iconBottom.x - iconTop.x,
        iconBottom.y - iconTop.y,
      );
    }
    // Missing hull data is not replaced with an invented collision box.
    if (cursor && !footprint && source.kind === "hero") {
      context.beginPath();
      context.moveTo(at.x - 3, at.y);
      context.lineTo(at.x + 3, at.y);
      context.moveTo(at.x, at.y - 3);
      context.lineTo(at.x, at.y + 3);
      context.stroke();
    }
    context.strokeStyle = detected.has(source.id)
      ? "#fbbf24"
      : selected
        ? "#fde68a"
        : color;
    context.lineWidth = detected.has(source.id) ? 3 : 1;
    if (covered.has(source.id) && !cursor) {
      const warning = detected.has(source.id);
      const ringColor = warning ? "#fbbf24" : "#67e8f9";
      const imageHeight = image
        ? (image.naturalHeight * iconSize) /
          Math.max(image.naturalWidth, image.naturalHeight)
        : iconSize;
      const centerY =
        iconCenter.y + imageHeight * (0.5 - (preset?.imageAnchor?.[1] ?? 0.5));
      const radius = iconSize / 2 + 5;
      context.save();
      context.setLineDash([]);
      context.beginPath();
      context.arc(iconCenter.x, centerY, radius, 0, Math.PI * 2);
      context.strokeStyle = "#07131f";
      context.lineWidth = 5;
      context.stroke();
      context.strokeStyle = ringColor;
      context.lineWidth = 2;
      context.stroke();
      const badgeX = iconCenter.x - radius + 1,
        badgeY = centerY - radius + 1;
      context.beginPath();
      context.arc(badgeX, badgeY, 7, 0, Math.PI * 2);
      context.fillStyle = "#101e28";
      context.fill();
      context.strokeStyle = ringColor;
      context.lineWidth = 1.5;
      context.stroke();
      if (warning) {
        context.fillStyle = ringColor;
        context.font = "bold 10px system-ui";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("!", badgeX, badgeY);
      } else {
        context.beginPath();
        context.ellipse(badgeX, badgeY, 4, 2.5, 0, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.arc(badgeX, badgeY, 1, 0, Math.PI * 2);
        context.fillStyle = ringColor;
        context.fill();
      }
      context.restore();
    }
    if (!cursor) {
      const number = String(p.sources.findIndex((s) => s.id === source.id) + 1);
      if (selected) {
        // Screen-sized brackets follow the artwork anchor, not the collision hull.
        const ratio = image
          ? iconSize / Math.max(image.naturalWidth, image.naturalHeight)
          : 1;
        const artworkWidth = image ? image.naturalWidth * ratio : iconSize;
        const artworkHeight = image ? image.naturalHeight * ratio : iconSize;
        const centerX =
          iconCenter.x +
          artworkWidth * (0.5 - (preset?.imageAnchor?.[0] ?? 0.5));
        const centerY =
          iconCenter.y +
          artworkHeight * (0.5 - (preset?.imageAnchor?.[1] ?? 0.5));
        const halfWidth = Math.max(26, artworkWidth + 8) / 2;
        const halfHeight = Math.max(26, artworkHeight + 8) / 2;
        const corner = 5;
        context.save();
        context.setLineDash([]);
        context.lineJoin = "round";
        context.lineCap = "round";
        context.beginPath();
        for (const x of [-1, 1])
          for (const y of [-1, 1]) {
            const edgeX = centerX + x * halfWidth;
            const edgeY = centerY + y * halfHeight;
            context.moveTo(edgeX - x * corner, edgeY);
            context.lineTo(edgeX, edgeY);
            context.lineTo(edgeX, edgeY - y * corner);
          }
        context.strokeStyle = "#07131f";
        context.lineWidth = 4;
        context.stroke();
        context.strokeStyle = "#a5f3fc";
        context.lineWidth = 1.5;
        context.stroke();
        const badgeX = centerX + halfWidth + 2;
        const badgeY = centerY - halfHeight + 2;
        context.beginPath();
        context.arc(badgeX, badgeY, 7, 0, Math.PI * 2);
        context.fillStyle = "#a5f3fc";
        context.fill();
        context.strokeStyle = "#07131f";
        context.lineWidth = 1;
        context.stroke();
        context.fillStyle = "#07131f";
        context.font = "bold 10px sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(number, badgeX, badgeY);
        context.restore();
      } else {
        context.fillStyle = "#fff";
        context.font = "11px sans-serif";
        context.fillText(number, at.x + iconSize / 2 + 3, at.y - iconSize / 2);
      }
    }
  });
  for (const id of p.removed) {
    const tree = data.points.find((point) => point.id === id);
    if (!tree) continue;
    const at = screen(tree);
    context.strokeStyle = "#fb7185";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(at.x - 4, at.y - 4);
    context.lineTo(at.x + 4, at.y + 4);
    context.moveTo(at.x - 4, at.y + 4);
    context.lineTo(at.x + 4, at.y - 4);
    context.stroke();
  }
  if (p.target) {
    const at = screen(p.target);
    context.strokeStyle = "#fff";
    context.lineWidth = 2;
    context.strokeRect(at.x - 4, at.y - 4, 8, 8);
  }
  context.restore();
}
