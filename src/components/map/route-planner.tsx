"use client";
import { HoverTooltip } from "@/components/ui/hover-tooltip";
import { Info, Plus } from "lucide-react";
import { CompactSelect } from "@/components/ui/compact-select";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  routeKey,
  nearbyRoutes,
  routeColor,
  cellAt,
  routePosition,
  withTrees,
  type Position,
  type RoutingResult,
  type RoutingProgress,
} from "@/domain/map/routing";
import { RouteClient } from "./route-client";
import type { MapViewData } from "@/domain/map/schema";
type Mode = "ground" | "current";
type SavedRoute = { id: number; points: Position[]; speed: string; mode: Mode };
const emptyPoints: Position[] = [];
export function useRoutePlanner(data: MapViewData) {
  const [enabled, setEnabled] = useState(false);
  const [records, setRecords] = useState<SavedRoute[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Position[]>(emptyPoints);
  const [defaultSpeed, setDefaultSpeed] = useState("300");
  const [defaultMode, setDefaultMode] = useState<Mode>("ground");
  const sequence = useRef(0);
  const active = records.find((r) => r.id === activeId);
  const points = active?.points ?? draft;
  const speed = active?.speed ?? defaultSpeed,
    mode = active?.mode ?? defaultMode;
  const flying = false;
  const [selected, setSelected] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0),
    [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [pickError, setPickError] = useState<string | null>(null);
  const grid = useMemo(
    () =>
      data.routing?.grid
        ? withTrees(
            data.routing.grid,
            data.points.filter((p) => p.kind === "tree"),
            data.routing.obstacles,
          )
        : null,
    [data.routing, data.points],
  );
  const gates = useMemo(
    () => data.points.filter((p) => p.kind === "gate"),
    [data.points],
  );
  const client = useMemo(
    () =>
      new RouteClient({
        grid,
        gate: data.routing?.gate ?? null,
        gates,
        currents: data.routing?.currents,
      }),
    [grid, data.routing, gates],
  );
  useEffect(() => () => client.dispose(), [client]);
  const cache = client.results;
  const keyFor = (r: SavedRoute) =>
    `${r.id}:ground-v3:${r.speed}:${r.points.map((p) => `${p.x},${p.y}`).join(":")}`;
  const key = active ? keyFor(active) : "";
  const calculationSpeed = Number(speed);
  const request = useMemo(
    () =>
      enabled && activeId !== null && points.length === 2
        ? {
            start: points[0],
            end: points[1],
            flying: false,
            allModes: true,
            speed: calculationSpeed,
          }
        : null,
    [enabled, activeId, points, calculationSpeed],
  );
  const [job, setJob] = useState<{
    key: string;
    result: RoutingResult | null;
    progress: RoutingProgress | null;
    elapsedMs: number;
  }>({ key: "", result: null, progress: null, elapsedMs: 0 });
  useEffect(() => {
    if (!request || cache.has(key)) return;
    let valid = true;
    void client
      .run(request, (progress) => {
        if (valid) setJob({ key, progress, result: null, elapsedMs: 0 });
      })
      .then((value) => {
        if (!valid) return;
        cache.set(key, value);
        setJob({ key, ...value, progress: null });
      })
      .catch((error) => {
        if (valid && error.name !== "AbortError")
          setJob({
            key,
            result: {
              routes: [],
              error: `寻路计算失败：${error.message}`,
              close: false,
            },
            progress: null,
            elapsedMs: 0,
          });
      });
    return () => {
      valid = false;
      client.cancel();
    };
  }, [client, cache, key, request]);
  const currentJob = cache.get(key) ?? (job.key === key ? job : null);
  const geometry = currentJob?.result;
  const result = useMemo(
    () =>
      geometry
        ? {
            ...geometry,
            routes: nearbyRoutes(
              geometry.routes.filter((r) => r.mode !== "flying"),
            ),
          }
        : null,
    [geometry],
  );
  const chosen =
    result?.routes.find((r) => routeKey(r) === selected) ??
    result?.routes.find((r) => r.mode === mode) ??
    result?.routes[0];
  const shown = useMemo(() => (chosen ? [chosen] : []), [chosen]);
  const overlays = useMemo(
    () =>
      records
        .flatMap((r) => {
          const value =
            r.id === activeId
              ? result
              : cache.get(
                  `${r.id}:ground-v3:${r.speed}:${r.points.map((p) => `${p.x},${p.y}`).join(":")}`,
                )?.result;
          return nearbyRoutes(
            (value?.routes ?? []).filter((r) => r.mode !== "flying"),
          ).map((route) => ({
            id: r.id,
            route,
            active:
              r.id === activeId &&
              routeKey(route) === (chosen ? routeKey(chosen) : ""),
          }));
        })
        .sort((a, b) => Number(a.active) - Number(b.active)),
    [records, cache, activeId, result, chosen],
  );
  const duration = Math.max(0, ...shown.map((r) => r.seconds));
  const complete = elapsed >= duration;
  useEffect(() => {
    if (!playing || !enabled || !duration || complete) return;
    let frame = 0,
      previous: number | null = null;
    const tick = (now: number) => {
      if (previous !== null)
        setElapsed((t) =>
          Math.min(
            duration,
            t + Math.min(0.1, (now - previous!) / 1000) * rate,
          ),
        );
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, enabled, duration, rate, complete]);
  const resetPlayback = () => {
    setPickError(null);
    setElapsed(0);
    setPlaying(false);
    setSelected(null);
  };
  const begin = () => {
    setActiveId(null);
    setDraft([]);
    resetPlayback();
  };
  const remove = () => {
    if (activeId !== null) {
      setRecords((all) => all.filter((r) => r.id !== activeId));
      cache.removeRoute(activeId);
      begin();
    }
  };
  useEffect(() => {
    if (!enabled || activeId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" || e.repeat || e.defaultPrevented) return;
      if (
        e.target instanceof Element &&
        e.target.closest(
          'input,textarea,select,[contenteditable="true"],[role="combobox"],[role="listbox"]',
        )
      )
        return;
      e.preventDefault();
      setRecords((all) => all.filter((r) => r.id !== activeId));
      setActiveId(null);
      setDraft([]);
      setPlaying(false);
      setElapsed(0);
      setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, activeId]);
  const canPick = (p: Position) =>
    flying || (!!grid && grid.walkable[cellAt(grid, p)] === "1");
  const accept = (next: Position[]) => {
    resetPlayback();
    if (next.length === 2) {
      const id = ++sequence.current;
      setRecords((all) => [...all, { id, points: next, speed, mode }]);
      setActiveId(id);
      setDraft([]);
    } else setDraft(next);
  };
  const validate = (p: Position) => {
    if (canPick(p)) return true;
    setPickError(
      grid
        ? "该位置不可通行，请在附近可行走地面选点。"
        : "此版本没有导航数据，暂不可寻路。",
    );
    return false;
  };
  return {
    enabled,
    records,
    activeId,
    overlays,
    drafting: activeId === null,
    computing: !!request && !geometry,
    progress: job.key === key ? job.progress : null,
    calculationMs: currentJob?.elapsedMs,
    pickError,
    points,
    speed,
    mode: chosen?.mode ?? mode,
    flying,
    result,
    shown,
    elapsed,
    playing: playing && !complete,
    duration,
    rate,
    canPick,
    toggle: () => {
      setEnabled((v) => !v);
      resetPlayback();
    },
    stop: () => {
      setEnabled(false);
      resetPlayback();
    },
    pick: (p: Position) => {
      p = { x: Math.round(p.x), y: Math.round(p.y) };
      if (activeId !== null || !validate(p)) return;
      accept(draft.length === 1 ? [draft[0], p] : [p]);
    },
    clear: begin,
    remove,
    selectRoute: (id: number, variant?: string) => {
      if (records.some((r) => r.id === id)) {
        setActiveId(id);
        setDraft([]);
        resetPlayback();
        if (variant) setSelected(variant);
      }
    },
    pickLandmark: (p: Position, index: number) => {
      p = { x: Math.round(p.x), y: Math.round(p.y) };
      if (!validate(p)) return;
      if (active) {
        setRecords((all) =>
          all.map((r) =>
            r.id === activeId
              ? {
                  ...r,
                  points: index === 0 ? [p, r.points[1]] : [r.points[0], p],
                }
              : r,
          ),
        );
        resetPlayback();
      } else if (index === 0) accept([p]);
      else if (draft[0]) accept([draft[0], p]);
    },
    setSpeed: (v: string) => {
      setDefaultSpeed(v);
      if (activeId !== null)
        setRecords((all) =>
          all.map((r) => (r.id === activeId ? { ...r, speed: v } : r)),
        );
      resetPlayback();
    },
    setMode: (v: Mode) => {
      setDefaultMode(v);
      if (activeId !== null)
        setRecords((all) =>
          all.map((r) => (r.id === activeId ? { ...r, mode: v } : r)),
        );
      resetPlayback();
    },
    select: (v: string) => {
      setSelected(v);
      setElapsed(0);
      setPlaying(false);
    },
    play: () => {
      if (complete) setElapsed(0);
      setPlaying((v) => !v || complete);
    },
    setRate,
    markers: shown.map((route) => ({
      route,
      ...routePosition(route, elapsed, Number(speed)),
    })),
  };
}
export type RoutePlanner = ReturnType<typeof useRoutePlanner>;
const control =
  "h-6 rounded bg-[#20303d] px-1.5 py-0.5 text-[11px] text-[#edf5fc] [color-scheme:dark]";
export function RoutePanel({
  planner: p,
  data,
}: {
  planner: RoutePlanner;
  data: MapViewData;
}) {
  if (!p.enabled) return null;
  return (
    <section
      aria-label="寻路设置与结果"
      className="map-route-panel mb-2 rounded bg-[#14212b] p-2 text-[11px]"
    >
      <div className="flex flex-col items-stretch gap-1.5">
        <div className="flex items-center justify-between gap-1">
          <strong>
            {p.activeId === null ? "新建路线" : `路线 ${p.activeId}`}
          </strong>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-[var(--text-muted)]">
              静态估算
            </span>
            <HoverTooltip
              className="grid size-5 place-items-center rounded text-[var(--text-muted)] hover:bg-white/10"
              content={
                <div className="max-w-xs space-y-2 text-[11px] leading-5">
                  <strong>寻路估算与操作说明</strong>
                  <p>
                    选择地图上的起点 A、终点
                    B，也可选择地标。点击路线切换方案，重合处重复点击轮换；Delete
                    删除，右键或 Esc 退出工具。
                  </p>
                  <p>
                    仅显示最快及相差不超过3秒或10%的方案。陆地最短距离与湍流最短耗时均计算沿途顺流加速：最大
                    +150，逆流不减速，斜向按正向投影；尚未经引擎验证。
                  </p>
                  <p>
                    陆地使用64单位导航格和初始树木／建筑阻挡，禁止穿越阻挡及斜切墙角；最短指八方向网格路径，首尾连接所在格中心。选点与路径坐标对齐1单位，地形数据精度仍为64单位。
                  </p>
                  <p>
                    未模拟转身、动态单位碰撞、建筑变化及技能效果；双生门落点按门旁可行走格估算。路线尚未在同版本游戏引擎逐点验证。
                  </p>
                </div>
              }
            >
              <Info aria-hidden="true" size={14} />
              <span className="sr-only">寻路估算与操作说明</span>
            </HoverTooltip>
            <button
              className="flex h-6 items-center gap-0.5 rounded bg-white/5 px-1 hover:bg-white/10"
              aria-label="新建路线"
              onClick={p.clear}
            >
              <Plus aria-hidden="true" size={12} />
              新建
            </button>
          </div>
          {p.activeId !== null && (
            <button
              className="px-1 text-red-200"
              onClick={p.remove}
              title="删除路线（Delete）"
              aria-label="删除路线"
            >
              ×
            </button>
          )}
        </div>
        {!!p.records.length && (
          <ul aria-label="已创建路线" className="flex flex-wrap gap-1">
            {p.records.map((r) => (
              <li key={r.id}>
                <button
                  className={`${control} ${p.activeId === r.id ? "ring-1 ring-cyan-200" : ""}`}
                  aria-pressed={p.activeId === r.id}
                  onClick={() => p.selectRoute(r.id)}
                >
                  路线 {r.id}
                </button>
              </li>
            ))}
          </ul>
        )}

        <CompactSelect
          hideLabel
          label="移动方式"
          className="map-select"
          value={p.mode}
          onValueChange={(value) => p.setMode(value as Mode)}
        >
          <option value="ground">陆地行走</option>
          <option value="current" disabled={!data.routing?.currents?.length}>
            湍流 · 陆地加速估算
          </option>
        </CompactSelect>
        <label className="flex items-center gap-1.5">
          移速{" "}
          <input
            aria-label="英雄移动速度"
            className={`${control} min-w-0 flex-1 tabular-nums`}
            type="number"
            min="1"
            step="1"
            value={p.speed}
            onChange={(e) => p.setSpeed(e.target.value)}
          />{" "}
          单位/秒
        </label>
        <span role="status" className="text-[10px] leading-4 text-[#b9dce7]">
          {p.points.length === 0
            ? "点击地图选择起点 A"
            : p.points.length === 1
              ? "点击地图选择终点 B"
              : "路线已创建 · 点击路径切换"}
        </span>
      </div>
      <div className="mt-1.5 grid gap-1">
        {(["A", "B"] as const).map((label, i) => (
          <label key={label} className="flex min-w-0 items-center gap-1.5">
            {label}
            <CompactSelect
              hideLabel
              label={`${label === "A" ? "起点" : "终点"}地标`}
              className="map-select min-w-0 flex-1"
              value=""
              onValueChange={(value) => {
                const point = data.points.find((v) => v.id === value);
                if (point) p.pickLandmark(point, i);
              }}
              disabled={i === 1 && p.points.length === 0}
            >
              <option value="">
                {p.points[i]
                  ? `${Math.round(p.points[i].x)}, ${Math.round(p.points[i].y)}`
                  : "也可选择地标"}
              </option>
              {data.points
                .filter((v) =>
                  ["gate", "fountain", "rune", "outpost"].includes(v.kind),
                )
                .map((v) => (
                  <option key={v.id} value={v.id} disabled={!p.canPick(v)}>
                    {v.label} ({Math.round(v.x)}, {Math.round(v.y)})
                    {!p.canPick(v) ? " · 中心不可行走" : ""}
                  </option>
                ))}
            </CompactSelect>
          </label>
        ))}
      </div>
      {!p.flying && !data.routing?.grid && (
        <p className="mt-2 text-amber-200">此版本没有导航数据，暂不可寻路。</p>
      )}
      {p.pickError && (
        <p role="alert" className="mt-2 text-amber-200">
          {p.pickError}
        </p>
      )}
      {p.computing && (
        <div role="status" className="mt-2 space-y-1" aria-label="寻路计算状态">
          <p>{p.progress?.stage ?? "正在启动后台寻路"}…</p>
          <progress
            className="w-full accent-[#89eaff]"
            aria-label="寻路计算进度"
            max={p.progress?.total ?? 1}
            value={p.progress?.completed ?? 0}
          />
          <p className="text-[10px] text-[var(--text-muted)]">
            已完成 {p.progress?.completed ?? 0}/{p.progress?.total ?? 1} 阶段 ·
            已检查 {(p.progress?.expanded ?? 0).toLocaleString()} 格
          </p>
          <button className={control} onClick={p.clear}>
            取消计算
          </button>
        </div>
      )}
      {p.result?.error && (
        <p role="alert" className="mt-2 text-amber-200">
          {p.result.error}
        </p>
      )}
      {!!p.result?.routes.length && (
        <>
          <div className="mt-1.5 grid gap-1">
            {p.result.routes.map((r) => (
              <button
                key={routeKey(r)}
                aria-pressed={p.shown.includes(r)}
                onClick={() => p.select(routeKey(r))}
                className={`rounded border px-2 py-1.5 text-left ${p.shown.includes(r) ? "border-white/50 bg-white/10" : "border-white/10"}`}
              >
                <span style={{ color: routeColor(r) }}>
                  {r.mode === "flying"
                    ? "飞行"
                    : r.mode === "current"
                      ? "湍流最短耗时"
                      : "陆地最短距离"}{" "}
                  · {r.kind === "gate" ? "经双生门" : "直达"}
                </span>
                <strong className="ml-1 text-[13px] tabular-nums">
                  {r.seconds.toFixed(1)} 秒
                </strong>
                <span className="mt-1 block text-[10px]">
                  {Math.round(r.distance)} 单位
                  {r.delay ? ` + ${r.delay}秒持续施法` : ""}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button className={control} onClick={p.play}>
              {p.playing
                ? "暂停移动"
                : p.elapsed >= p.duration
                  ? "重新模拟"
                  : "模拟移动"}
            </button>
            <CompactSelect
              hideLabel
              label="模拟倍速"
              className="map-select"
              value={p.rate}
              onValueChange={(value) => p.setRate(Number(value))}
            >
              <option value={1}>1×</option>
              <option value={4}>4×</option>
              <option value={8}>8×</option>
            </CompactSelect>
            <span className="tabular-nums">
              {p.elapsed.toFixed(1)} / {p.duration.toFixed(1)} 秒
              {p.playing && p.markers.some((m) => m.channeling)
                ? " · 双生之门持续施法中"
                : ""}
            </span>
          </div>
        </>
      )}
      {!!p.result?.routes.length && (
        <p className="mt-2 text-[10px] text-[var(--text-muted)]">
          {p.flying
            ? "飞行直线"
            : p.mode === "current"
              ? "A* 湍流最短耗时估算"
              : "A* 网格最短路径"}{" "}
          · 计算 {p.calculationMs?.toFixed(1)} ms
        </p>
      )}
    </section>
  );
}
