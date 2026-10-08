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
import { HoverTooltip } from "@/components/ui/hover-tooltip";
import { VisionClient } from "./vision-client";

import {
  detectedObservers,
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
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [mode, setMode] = useState<Team | "both">("radiant");
  const [placementTeam, setPlacementTeam] = useState<Team>("radiant");
  const team = mode === "both" ? placementTeam : mode;
  const [preview, setPreview] = useState<Preview>(null);
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
  const setTool = (value: Tool) => {
    setToolState(value);
    setPreview(null);
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
    const preset = point ? data.visions?.[point.id] : undefined;
    if (!point && !canPlace) return;
    const id = `source-${++sourceSequence.current}`;
    setSelectedSource(id);
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
    presets,
    draft,
    canPlace,
    placementKind,
    heroKey,
    images,
    effectiveSources,
    detectionIds,
    setPlacementKind(value: VisionPreset["kind"]) {
      setPlacementKind(value);
      setCancelled(false);
      setPreview(null);
      setToolState("add");
    },
    setHeroKey(value: string) {
      setHeroKey(value);
      setCancelled(false);
      setPreview(null);
    },
    snap,
    gridBounds,
    selectedSource,
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
      const next = value ? { ...value, position: snap(value.position) } : null;
      setPreview((previous) =>
        previous?.id === next?.id &&
        previous?.position.x === next?.position.x &&
        previous?.position.y === next?.position.y
          ? previous
          : next,
      );
    },
    selectSource(id: string | null) {
      setSelectedSource(id);
      setToolState(null);
      setPreview(null);
    },
    beginDrag() {
      setDragging(true);
      setCancelled(false);
    },
    endDrag(id: string, position?: VisionPosition) {
      if (position)
        setSources((ss) =>
          ss.map((s) => (s.id === id ? { ...s, ...snap(position) } : s)),
        );
      setDragging(false);
      setPreview(null);
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
      if (selectedSource === id) setSelectedSource(null);
      setSources((ss) => ss.filter((s) => s.id !== id));
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
      planner.mode,
      planner.sources,
      planner.removed,
      planner.target,
      planner.tool,
      planner.selectedSource,
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
    p.selectedSource,
    p.mode,
    p.team,
    p.placementTeam,
    p.visibleSources,
    [...p.detectionIds],
    p.sources,
    p.night,
    p.removed,
    p.tool,
    p.target,
    p.results,
    p.status,
    p.progress,
    p.missingHeight,
  ]);
  if (!p.enabled) return null;
  return (
    <section
      aria-label={t("视野模拟")}
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
  return (
    <div className="mb-3 space-y-2 rounded bg-white/[0.035] p-2 text-[11px]">
      <div className="flex items-center justify-between gap-1">
        <h2 className="font-semibold">
          {t("视野模拟")} · {t("近似估算")}
        </h2>
        <HoverTooltip
          className="shrink-0 rounded-full px-1 text-[var(--text-muted)]"
          content={
            <div className="space-y-2">
              {[
                "同队地面来源取并集；按来源、树木与地形Z判断遮挡。树圆64、有效树高128、高度分层128、覆盖采样64；高度保留原生采样。未校准引擎，不含专用FoW阻挡、肉山／飞行特例、隐身与视野延迟。",
                "添加模式移动鼠标预览，点击连续放置；Esc或右键进入选中模式，选中后拖动。来源与查询吸附到同一64单位格中心。预览只显示占地；英雄占地按同版本碰撞半径绘制。",
                "守卫和英雄参数来自所选图鉴版本；自定义半径仅用于情景。岗哨反隐圈高亮范围内敌方侦查守卫，圈内不等于已有地面视野；未模拟通用隐身规则。",
              ].map((text) => (
                <p key={text}>{t(text)}</p>
              ))}
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
        {(["observer", "sentry", "hero"] as const).map((kind) => (
          <button
            key={kind}
            className={`${button} flex flex-col items-center !px-0.5`}
            aria-pressed={p.placementKind === kind}
            aria-label={t(
              kind === "observer"
                ? "侦查守卫"
                : kind === "sentry"
                  ? "岗哨守卫"
                  : "英雄",
            )}
            onClick={() => p.setPlacementKind(kind)}
          >
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
      <div className="flex gap-1">
        <button
          className={button}
          aria-pressed={p.tool === null}
          onClick={() => p.setTool(null)}
        >
          {t("选中模式")}
        </button>
        <span className="self-center text-[var(--text-muted)]">
          {p.tool === "add"
            ? t("添加模式 · Esc选中")
            : p.tool === null
              ? t("点击选中并拖动")
              : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        <button
          className={button}
          aria-pressed={!p.night}
          onClick={() => p.setNight(false)}
        >
          {t("白天")}
        </button>
        <button
          className={button}
          aria-pressed={p.night}
          onClick={() => p.setNight(true)}
        >
          {t("夜晚")}
        </button>
        <button
          className={button}
          aria-pressed={p.tool === "add"}
          disabled={p.sources.length >= 8 || !p.canPlace}
          onClick={() => choose("add")}
        >
          {t("放置来源")}
        </button>
        <button
          className={button}
          disabled={!selected || p.sources.length >= 8}
          onClick={() => selected && p.add(selected, selected)}
        >
          {t("添加所选对象")}
        </button>
        <button
          className={button}
          aria-pressed={p.tool === "query"}
          onClick={() => choose("query")}
        >
          {t("查询选点")}
        </button>
        <button
          className={button}
          aria-pressed={p.tool === "tree"}
          onClick={() => choose("tree")}
        >
          {t("砍树／恢复")}
        </button>
        <button
          className={button}
          disabled={!p.removed.length}
          onClick={p.restore}
        >
          {t("恢复全部树木")}
        </button>
      </div>
      <p>
        {t("已移除 {count} 棵树，仅影响视野情景。", {
          count: p.removed.length,
        })}
      </p>
      {p.tool &&
        info(
          p.tool === "tree"
            ? "点击树木切换砍伐状态；Esc或右键退出。"
            : "点击地图选点；Esc或右键退出。",
        )}
      <ol className="space-y-2">
        {p.visibleSources.map((s) => (
          <li
            key={s.id}
            data-detected={p.detectionIds.has(s.id) || undefined}
            className={`space-y-1 border-t pt-1 ${p.detectionIds.has(s.id) ? "border-amber-300 bg-amber-300/10" : "border-white/10"}`}
          >
            <div className="flex items-center gap-1">
              <VisionSourceIcon
                preset={p.presets.find((v) => v.key === s.presetKey)}
              />
              <span>
                {s.kind === "custom"
                  ? t("自定义来源")
                  : (() => {
                      const preset = p.presets.find(
                        (v) => v.key === s.presetKey,
                      );
                      return preset
                        ? locale === "en"
                          ? preset.enName
                          : preset.zhName
                        : "—";
                    })()}
              </span>
            </div>
            {p.detectionIds.has(s.id) && (
              <p className="text-amber-200">{t("位于敌方岗哨反隐范围内")}</p>
            )}
            <button
              className={button}
              aria-pressed={p.selectedSource === s.id}
              onClick={() => p.selectSource(s.id)}
            >
              {t("来源 {number}", { number: p.sources.indexOf(s) + 1 })} ·{" "}
              {t(s.team === "radiant" ? "天辉" : "夜魇")} · {Math.round(s.x)},{" "}
              {Math.round(s.y)}
            </button>
            <p className="text-[var(--text-muted)]">
              {t("地面 Z：{height}", {
                height:
                  p.heightAt(s) === null
                    ? t("未知")
                    : Math.round(p.heightAt(s)! * 10) / 10,
              })}
              {s.kind === "hero" && (
                <>
                  {" "}
                  ·{" "}
                  {t("碰撞半径：{radius}", {
                    radius:
                      p.presets.find((v) => v.key === s.presetKey)
                        ?.collisionRadius ?? t("未知"),
                  })}
                </>
              )}
            </p>
            {s.kind === "sentry" ? (
              <p>
                {t("反隐范围：{radius}；不提供视野", { radius: s.detection })}
              </p>
            ) : (
              <div className="flex gap-1">
                {(["day", "night"] as const).map((period) => (
                  <label key={period} className="min-w-0 flex-1">
                    {period === "day" ? t("白天半径") : t("夜晚半径")}
                    <input
                      className="w-full rounded bg-white/5 px-1"
                      type="number"
                      min={0}
                      max={32768}
                      aria-label={t(
                        period === "day"
                          ? "来源 {number} 白天半径"
                          : "来源 {number} 夜晚半径",
                        { number: p.sources.indexOf(s) + 1 },
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
                ))}
              </div>
            )}
            <button
              className={button}
              aria-pressed={p.tool === s.id}
              onClick={() => choose(s.id)}
            >
              {t("移动来源")}
            </button>{" "}
            <button className={button} onClick={() => p.remove(s.id)}>
              {t("移除来源")}
            </button>
          </li>
        ))}
      </ol>
      {!p.sources.length && (
        <span>
          {info(
            "最多添加8个来源；双方独立计算，绿色为天辉，粉色为夜魇，白色为双方可见。",
          )}
        </span>
      )}
      <p role="status" data-vision-status={p.status}>
        {t(
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
        )}
        {p.status === "running" ? ` ${Math.round(p.progress * 100)}%` : ""}
      </p>
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
      <div className="flex gap-1">
        <span className="text-emerald-300">{t("天辉")}</span> ·{" "}
        <span className="text-pink-300">{t("夜魇")}</span> ·{" "}
        <span>{t("双方可见")}</span>
        {info("灰色为遮挡，黄色为未知，范围外透明；双方独立计算。")}
      </div>
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
  [52, 211, 153, 110],
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
export function drawVision(
  context: CanvasRenderingContext2D,
  p: VisionPlanner,
  texture: VisionTexture | null,
  screen: (p: VisionPosition) => VisionPosition,
  data: MapViewData,
  preview?: { id: string; position: VisionPosition; moving: boolean },
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
  // Draw the footprint at world scale; keep the asset legible when zoomed out.
  const liveSources = p.effectiveSources.map((source) =>
    preview?.id === source.id
      ? { ...source, ...p.snap(preview.position) }
      : source,
  );
  const detected = detectedObservers(
    liveSources,
    p.mode === "both" ? teams : [p.mode],
  );
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
  visible.forEach((source) => {
    const at = screen(source);
    const preset = p.presets.find((v) => v.key === source.presetKey);
    const hull = source.kind === "hero" ? preset?.collisionRadius : null;
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
    const selected = p.selectedSource === source.id;
    const radius =
      hull == null
        ? null
        : Math.abs(screen({ x: source.x + hull, y: source.y }).x - at.x);
    context.fillStyle = color;
    context.strokeStyle = detected.has(source.id)
      ? "#fbbf24"
      : selected
        ? "#fde68a"
        : color;
    context.lineWidth = 1;
    context.globalAlpha = cursor ? 0.45 : 0.6;
    // World-space collision footprint. Artwork has no separate decorative frame.
    if (radius !== null) {
      context.beginPath();
      context.arc(at.x, at.y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    } else if (source.kind !== "hero") {
      context.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      if (cursor || selected)
        context.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    context.globalAlpha = 1;
    const size =
      radius === null ? Math.max(20, Math.abs(b.x - a.x)) : radius * 2;
    const image = preset?.imageUrl ? p.images[preset.imageUrl] : null;
    // While choosing a position, expose the exact footprint and underlying grid.
    if (!cursor && image) {
      const ratio = size / Math.max(image.naturalWidth, image.naturalHeight);
      const w = image.naturalWidth * ratio,
        h = image.naturalHeight * ratio;
      context.drawImage(image, at.x - w / 2, at.y - h / 2, w, h);
    } else if (!cursor && !image && source.kind !== "hero") {
      context.fillStyle = color;
      context.fillRect(at.x - 2, at.y - 2, 4, 4);
    }
    // Missing hull data is not replaced with an invented collision box.
    if (cursor && radius === null && source.kind === "hero") {
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
    if (detected.has(source.id)) {
      context.beginPath();
      context.arc(at.x, at.y, size / 2 + 7, 0, Math.PI * 2);
      context.stroke();
    }
    if (source.id !== "cursor") {
      context.fillStyle = "#fff";
      context.font = "11px sans-serif";
      context.fillText(
        String(p.sources.findIndex((s) => s.id === source.id) + 1),
        at.x + size / 2 + 3,
        at.y - size / 2,
      );
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
