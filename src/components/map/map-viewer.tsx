"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAP_LAYERS,
  type MapLayer,
  type MapPoint,
  type MapViewData,
} from "@/domain/map/schema";
import {
  fitScale,
  pointIndex,
  toScreen,
  toWorld,
  zoomAt,
  type Camera,
} from "@/domain/map/geometry";

type Position = { x: number; y: number };
type MapControls = {
  reset(): void;
  zoom(factor: number): void;
  focus(point: MapPoint): void;
};
const buttonStyle =
  "rounded px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-white/5 disabled:opacity-35";
export function MapViewer({ data }: { data: MapViewData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const controls = useRef<MapControls | null>(null);
  const camera = useRef<Camera>({
    x: (data.bounds.minX + data.bounds.maxX) / 2,
    y: (data.bounds.minY + data.bounds.maxY) / 2,
    zoom: 1,
  });
  const [layers, setLayers] = useState<Set<MapLayer>>(
    () =>
      new Set(
        (Object.keys(MAP_LAYERS) as MapLayer[]).filter(
          (k) => k !== "tree" && k !== "other",
        ),
      ),
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [hovered, setHovered] = useState<MapPoint | null>(null);
  const [measure, setMeasure] = useState(false);
  const [range, setRange] = useState(0);
  const [measurement, setMeasurement] = useState<Position[]>([]);
  const [zoom, setZoom] = useState(1);
  const [imageError, setImageError] = useState(false);
  const texture = useRef<HTMLImageElement | null>(null);
  const redraw = useRef<() => void>(() => {});
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
          `${p.label} ${p.properties.targetname ?? ""} ${p.sourceClass} ${p.team === "radiant" ? "天辉" : p.team === "dire" ? "夜魇" : p.team === "neutral" ? "中立" : "阵营未提供"}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [data.points, layers, query],
  );
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
    const canvas = canvasRef.current,
      host = surfaceRef.current;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    let width = 1,
      height = 1,
      scale = 1,
      frame = 0;
    let hoverId: string | null = null,
      dragged = false;
    let last: Position | null = null;
    const pointers = new Map<number, Position>();
    const lookup = pointIndex(visible);
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
      if (!ctx || !canvas) return;
      const started = performance.now();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // DPR can change when moving between displays without a CSS resize.
      if (
        canvas.width !== Math.round(width * dpr) ||
        canvas.height !== Math.round(height * dpr)
      ) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0b131a";
      ctx.fillRect(0, 0, width, height);
      const topLeft = screen({ x: data.bounds.minX, y: data.bounds.maxY });
      const bottomRight = screen({ x: data.bounds.maxX, y: data.bounds.minY });
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
      if (layers.has("camp") && camera.current.zoom >= 2 && !query.trim()) {
        ctx.strokeStyle = "#e8b878aa";
        ctx.fillStyle = "#e8b87815";
        ctx.lineWidth = 1;
        for (const zone of data.zones ?? []) {
          ctx.beginPath();
          zone.vertices.forEach((vertex, i) => {
            const p = screen(vertex);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
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
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const p of visible) {
        const s = screen(p);
        if (s.x < -40 || s.y < -40 || s.x > width + 40 || s.y > height + 40)
          continue;
        if (p.kind === "tree" && camera.current.zoom < 2) continue;
        const active = p.id === selected?.id || p.id === hoverId;
        const radius =
          p.kind === "tree" || p.kind === "other" ? 2 : active ? 11 : 8;
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = active ? "#f3e6bd" : "#10191fe8";
        ctx.fill();
        ctx.strokeStyle =
          p.team === "radiant"
            ? "#7fcca1"
            : p.team === "dire"
              ? "#e18b80"
              : MAP_LAYERS[p.kind].color;
        ctx.lineWidth = active ? 2 : 1.5;
        ctx.stroke();
        if (radius > 2) {
          ctx.font = "11px system-ui";
          ctx.fillStyle = active ? "#10191f" : MAP_LAYERS[p.kind].color;
          ctx.fillText(MAP_LAYERS[p.kind].symbol, s.x, s.y);
        }
        if (
          active ||
          (camera.current.zoom >= 3 && p.kind !== "tree" && p.kind !== "other")
        ) {
          ctx.font = "11px system-ui";
          ctx.lineWidth = 3;
          ctx.strokeStyle = "#091219";
          ctx.strokeText(p.label, s.x, s.y + 21);
          ctx.fillStyle = "#e3eaf0";
          ctx.fillText(p.label, s.x, s.y + 21);
        }
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
      // A 1/2/5 ruler in actual world units, independent of texture resolution.
      const rawUnits = 100 / (scale * camera.current.zoom),
        power = 10 ** Math.floor(Math.log10(rawUnits));
      const units =
        [5, 2, 1].map((n) => n * power).find((n) => n <= rawUnits) ?? power;
      const length = units * scale * camera.current.zoom;
      ctx.fillStyle = "#c6d2dc";
      ctx.fillRect(18, height - 23, length, 2);
      ctx.textAlign = "left";
      ctx.font = "10px system-ui";
      ctx.fillText(`${units} 单位`, 18, height - 35);
      canvas.dataset.zoom = String(camera.current.zoom);
      canvas.dataset.drawMs = (performance.now() - started).toFixed(2);
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    redraw.current = schedule;
    const resize = () => {
      width = host.clientWidth;
      height = host.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      scale = fitScale(data.bounds, width, height);
      schedule();
    };
    const point = (e: MouseEvent | PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const hit = (p: Position) => {
      const w = world(p),
        radius = 14 / (scale * camera.current.zoom);
      return (
        lookup(w.x, w.y, radius)
          .filter((item) => item.kind !== "tree" || camera.current.zoom >= 2)
          .sort(
            (a, b) =>
              Math.hypot(a.x - w.x, a.y - w.y) -
              Math.hypot(b.x - w.x, b.y - w.y),
          )[0] ?? null
      );
    };
    const down = (e: PointerEvent) => {
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
      const target = hit(p);
      if (target?.id !== hoverId) {
        hoverId = target?.id ?? null;
        setHovered(target);
        schedule();
      }
      canvas.style.cursor = measure ? "crosshair" : target ? "pointer" : "grab";
    };
    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (e.type === "pointerup" && !dragged) {
        if (measure) {
          const w = world(point(e));
          if (
            w.x >= data.bounds.minX &&
            w.x <= data.bounds.maxX &&
            w.y >= data.bounds.minY &&
            w.y <= data.bounds.maxY
          )
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
      setZoom(camera.current.zoom);
      schedule();
    };
    const reset = () => {
      camera.current = {
        x: (data.bounds.minX + data.bounds.maxX) / 2,
        y: (data.bounds.minY + data.bounds.maxY) / 2,
        zoom: 1,
      };
      setZoom(1);
      schedule();
    };
    const zoomBy = (factor: number) => {
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
      hoverId = null;
      setHovered(null);
      schedule();
    };
    controls.current = {
      reset,
      zoom: zoomBy,
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
  }, [data, visible, selected, range, measurement, measure, layers, query]);

  const distance =
    measurement.length === 2
      ? Math.round(
          Math.hypot(
            measurement[1].x - measurement[0].x,
            measurement[1].y - measurement[0].y,
          ),
        )
      : null;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <button
          className={buttonStyle}
          onClick={() => controls.current?.zoom(1.5)}
          aria-label="放大地图"
        >
          ＋
        </button>
        <span
          className="w-12 text-center text-[11px] tabular-nums"
          aria-label="缩放比例"
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          className={buttonStyle}
          onClick={() => controls.current?.zoom(1 / 1.5)}
          aria-label="缩小地图"
        >
          −
        </button>
        <button
          className={buttonStyle}
          onClick={() => controls.current?.reset()}
        >
          复位
        </button>
        <button
          className={`${buttonStyle} ${measure ? "bg-white/10" : ""}`}
          aria-pressed={measure}
          onClick={() => {
            setMeasure(!measure);
            setMeasurement([]);
          }}
        >
          测距
        </button>
        {measurement.length > 0 && (
          <button className={buttonStyle} onClick={() => setMeasurement([])}>
            清除测距
          </button>
        )}
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">
          拖拽平移 · 滚轮或双指缩放
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_230px]">
        <div
          ref={surfaceRef}
          className="relative h-[62vh] min-h-[330px] overflow-hidden rounded bg-[#0b131a] sm:h-[72vh]"
          aria-label="地图视口"
        >
          <canvas
            ref={canvasRef}
            tabIndex={0}
            aria-label="交互地图；方向键平移，加减号缩放，0复位，Escape清除选择"
            className="block h-full w-full touch-none"
          />
          {(!data.imageUrl || imageError) && (
            <div className="pointer-events-none absolute inset-0 grid place-content-center px-8 text-center">
              <div className="max-w-sm rounded bg-[#101a22ee] p-6">
                <h2 className="text-sm font-medium">
                  {imageError ? "地图底图加载失败" : "等待原生地图资源"}
                </h2>
                <p
                  role="status"
                  className="mt-2 text-xs leading-6 text-[var(--text-muted)]"
                >
                  {imageError
                    ? "请检查地图资源是否完整，再重新加载页面。"
                    : "已读取当前版本的坐标配置。地形底图、建筑、野区和神符点位需要从完整游戏资源中提取。"}
                </p>
              </div>
            </div>
          )}
          <div className="pointer-events-none absolute left-3 top-3 rounded bg-[#0b131acc] px-2 py-1 text-[10px] text-[var(--text-muted)]">
            北 ↑ · 天辉西南 / 夜魇东北
          </div>
          {(hovered || measure) && (
            <div
              className="pointer-events-none absolute bottom-3 right-3 max-w-[65%] rounded bg-[#0b131ae8] px-3 py-2 text-[11px]"
              role="status"
            >
              {measure
                ? distance === null
                  ? measurement.length
                    ? "选择第二个点"
                    : "依次点击两个点测量直线距离"
                  : `直线距离 ${distance.toLocaleString()} 单位`
                : `${hovered!.label} · ${Math.round(hovered!.x)}, ${Math.round(hovered!.y)}`}
            </div>
          )}
        </div>
        <aside aria-label="地图图层与详情" className="min-w-0 text-xs">
          <input
            aria-label="搜索地图点位"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索防御塔、肉山、远古…"
            autoComplete="off"
            spellCheck={false}
            className="mb-3 w-full rounded bg-white/5 px-3 py-2"
          />
          <h2 className="mb-2 font-semibold">图层</h2>
          <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
            {(Object.keys(MAP_LAYERS) as MapLayer[]).map((kind) => (
              <label
                key={kind}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={layers.has(kind)}
                  onChange={() =>
                    setLayers((previous) => {
                      const next = new Set(previous);
                      if (next.has(kind)) next.delete(kind);
                      else next.add(kind);
                      return next;
                    })
                  }
                  className="accent-[#a4c5bc]"
                />
                <span style={{ color: MAP_LAYERS[kind].color }}>
                  {MAP_LAYERS[kind].symbol}
                </span>
                <span>{MAP_LAYERS[kind].label}</span>
                <span className="ml-auto text-[10px] text-[var(--text-muted)]">
                  {counts.get(kind) ?? (data.coverage ? 0 : "待接入")}
                </span>
              </label>
            ))}
          </div>
          {selected && (
            <section
              className="mt-4 rounded bg-white/[0.035] p-3"
              aria-label="点位详情"
            >
              <div className="flex justify-between gap-2">
                <h2 className="font-semibold">{selected.label}</h2>
                <button
                  aria-label="关闭点位详情"
                  onClick={() => setSelected(null)}
                >
                  ×
                </button>
              </div>
              <p className="mt-2 text-[var(--text-muted)]">
                {selected.team === "radiant"
                  ? "天辉"
                  : selected.team === "dire"
                    ? "夜魇"
                    : selected.team === "neutral"
                      ? "中立"
                      : "阵营未提供"}{" "}
                ·{" "}
                {selected.z === null
                  ? "高度未提供"
                  : `高度 ${Math.round(selected.z)}`}
              </p>
              <p className="mt-1 font-mono text-[10px]">
                {Math.round(selected.x)}, {Math.round(selected.y)}
              </p>
              <label className="mt-3 block">
                范围圈 <span className="tabular-nums">{range}</span> 单位
                <input
                  aria-label="范围圈半径"
                  type="range"
                  min="0"
                  max="3000"
                  step="50"
                  value={range}
                  onChange={(e) => setRange(Number(e.target.value))}
                  className="mt-2 w-full accent-[#a4c5bc]"
                />
              </label>
            </section>
          )}
          {data.points.length > 0 && (
            <section className="mt-4">
              <h2 className="mb-2 font-semibold">点位 · {visible.length}</h2>
              <ul aria-label="地图点位" className="max-h-48 overflow-auto">
                {visible.slice(0, 80).map((p) => (
                  <li key={p.id}>
                    <button
                      className="w-full rounded px-2 py-1.5 text-left hover:bg-white/5"
                      onClick={() => controls.current?.focus(p)}
                    >
                      {p.label}{" "}
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {Math.round(p.x)}, {Math.round(p.y)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {visible.length > 80 && (
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  列出前80项；搜索可定位其他点位。
                </p>
              )}
            </section>
          )}
          <p className="mt-4 text-[10px] leading-5 text-[var(--text-muted)]">
            {data.coverage
              ? "游戏俯视图与静态实体点位。树木和营地边界在放大后显示。"
              : "当前仅有坐标配置，点位尚未导入。"}{" "}
            测距为平面直线距离；范围圈不计算通行、碰撞、高低坡和战争迷雾。
          </p>
        </aside>
      </div>
      <p className="mt-2 text-[10px] text-[var(--text-muted)]">
        键盘：方向键平移，＋ / − 缩放，0 复位，Esc 清除选择。
        {data.coverage
          ? `已导入 ${data.points.length.toLocaleString()} 个静态点位；${data.coverage.skippedEntities} 个无坐标或依赖父级变换的实体未显示。`
          : "地形与点位接入后，图层和搜索将自动启用。"}
      </p>
    </div>
  );
}
