// @vitest-environment jsdom
import {
  act,
  waitFor,
  within,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MapViewer } from "@/components/map/map-viewer";
import type { MapPoint } from "@/domain/map/schema";
import type { MapEconomy } from "@/domain/map/economy-schema";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("coalesces dense-map pointer input, reuses the scene, and keeps the canvas intact across state changes", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flush = () =>
    act(() => {
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach((callback) => callback(nextFrame * 16));
    });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === "measureText" ? () => ({ width: 30 }) : () => {},
      set: () => true,
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as CanvasRenderingContext2D,
  );
  const widthWrites = vi.spyOn(HTMLCanvasElement.prototype, "width", "set");
  const heightWrites = vi.spyOn(HTMLCanvasElement.prototype, "height", "set");
  const points: MapPoint[] = Array.from({ length: 2500 }, (_, i) => ({
    id: `tree-${i}`,
    label: "树木",
    kind: "tree",
    x: (i % 50) * 128,
    y: Math.floor(i / 50) * 128,
    z: 0,
    team: "neutral",
    sourceClass: "ent_dota_tree",
    sourcePath: "fixture",
    properties: {},
  }));
  const { unmount } = render(
    <MapViewer
      data={{
        bounds: { minX: 0, maxX: 6400, minY: 0, maxY: 6400 },
        points,
        imageUrl: "/fixture.webp",
        clientVersion: "6944",
        coverage: null,
      }}
    />,
  );
  const canvas = screen.getByLabelText(/交互地图/) as HTMLCanvasElement;
  canvas.setPointerCapture = vi.fn();
  flush();
  widthWrites.mockClear();
  heightWrites.mockClear();
  const burst = () => {
    for (let i = 0; i < 1000; i++)
      fireEvent(
        canvas,
        new MouseEvent("pointermove", {
          clientX: 300,
          clientY: 300,
          bubbles: true,
        }),
      );
  };
  burst();
  expect(frames.size).toBe(1);
  flush();
  expect(canvas.dataset.hitTests).toBe("1");
  expect(canvas.dataset.backgroundBuilds).toBe("1");
  expect(screen.getByRole("status").textContent).toContain("树木");
  const paints = canvas.dataset.paints;
  burst();
  flush();
  expect(canvas.dataset.paints).toBe(paints); // Staying on the same target does not repaint.
  expect(frames.size).toBe(0); // No idle animation loop.
  for (const type of ["pointerdown", "pointerup"])
    fireEvent(
      canvas,
      new MouseEvent(type, {
        clientX: 300,
        clientY: 300,
        button: 0,
        bubbles: true,
      }),
    );
  flush();
  expect(
    screen.getByRole("region", { name: "点位详情" }).textContent,
  ).toContain("3200, 3200");
  fireEvent.change(screen.getByLabelText("范围圈半径"), {
    target: { value: "600" },
  });
  flush();
  expect(canvas.dataset.backgroundBuilds).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: "测距" }));
  flush();
  fireEvent.click(screen.getByRole("button", { name: "寻路" }));
  flush();
  expect(widthWrites).not.toHaveBeenCalled();
  expect(heightWrites).not.toHaveBeenCalled();
  fireEvent(
    canvas,
    new MouseEvent("pointermove", { clientX: 310, clientY: 300 }),
  );
  unmount();
  expect(frames.size).toBe(0);
});

it("shows and hits trees at 100%, draws the hover label above markers, and obeys the layer switch", async () => {
  let queued: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queued = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const paint: string[] = [];
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === "measureText"
          ? () => ({ width: 24 })
          : (...args: unknown[]) => {
              paint.push(`${String(key)}:${args.join(",")}`);
            },
      set: (_, key, value) => {
        paint.push(`set:${String(key)}:${value}`);
        return true;
      },
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as CanvasRenderingContext2D,
  );
  const tree: MapPoint = {
    id: "tree",
    label: "树木",
    kind: "tree",
    x: 0,
    y: 0,
    z: 128,
    team: "unknown",
    sourceClass: "ent_dota_tree",
    sourcePath: "fixture",
    properties: {},
  };
  const units: MapEconomy["units"] = {};
  for (const team of ["goodguys", "badguys"])
    for (const suffix of ["", "_upgraded", "_upgraded_mega"])
      for (const kind of ["melee", "ranged", "flagbearer"])
        units[`npc_dota_creep_${team}_${kind}${suffix}`] = {
          name: kind,
          min: 10,
          max: 20,
          xp: suffix ? 25 : 50,
          neutralUpgrade: false,
        };
  render(
    <MapViewer
      data={{
        bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
        routing: {
          grid: {
            cell: 64,
            width: 4,
            height: 4,
            x: -128,
            y: -128,
            walkable: "1".repeat(16),
          },
          gate: null,
          revision: "test",
        },
        points: [
          tree,
          {
            ...tree,
            id: "camp",
            label: "营地",
            kind: "camp",
            x: 10,
            properties: { volumename: "[PR#]camp-a" },
          },
        ],
        zones: [
          {
            id: "zone-a",
            label: "camp-a",
            kind: "camp",
            zMin: -128,
            zMax: 256,
            vertices: [
              { x: 5, y: -5 },
              { x: 15, y: -5 },
              { x: 15, y: 5 },
              { x: 5, y: 5 },
            ],
          },
        ],
        economy: {
          schemaVersion: 1,
          clientVersion: "6944",
          patch: "7.41f",
          rulesVersion: "creep-economy-7.41-v2",
          units,
          groups: [],
          camps: [],
          sources: [],
          neutralUpgrade: { interval: 450, gold: 1, xp: 5, max: 30 },
          laneUpgrade: { interval: 450, rangedXp: 8 },
        },
        lanePaths: [
          {
            id: "lane",
            team: "radiant",
            lane: "mid",
            vertices: [
              { x: -80, y: 50, z: 0 },
              { x: 80, y: 50, z: 0 },
            ],
          },
          {
            id: "lane-dire",
            team: "dire",
            lane: "mid",
            vertices: [
              { x: 80, y: 50, z: 0 },
              { x: -80, y: 50, z: 0 },
            ],
          },
        ],
        imageUrl: "/fixture.webp",
        clientVersion: "6944",
        coverage: null,
      }}
    />,
  );
  const canvas = screen.getByLabelText(/交互地图/);
  act(() => queued?.(0));
  expect(screen.getByLabelText("缩放比例").textContent).toBe("100%");
  const treeFill = () =>
    paint.some(
      (s) =>
        (s.startsWith("fillRect:") || s.startsWith("rect:")) &&
        Math.abs(Number(s.split(",")[2]) - 64 * 2.88) < 0.001,
    );
  expect(treeFill()).toBe(true);
  expect(paint.some((s) => s.startsWith("arc:328.8,300,4,"))).toBe(true);
  expect(paint.some((s) => s.startsWith("arc:300,300,"))).toBe(false);
  expect(paint).not.toContain("set:lineWidth:5");
  expect(
    (screen.getByRole("checkbox", { name: "野区经验" }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  expect(
    (
      screen.getByRole("checkbox", {
        name: "拉野/叠野秒数",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect(paint.some((s) => s.includes("Z 轴范围"))).toBe(false);
  // MouseEvent supplies screen coordinates in jsdom, which has no native PointerEvent.
  fireEvent(
    canvas,
    new MouseEvent("pointermove", {
      clientX: 300,
      clientY: 300,
      bubbles: true,
    }),
  );
  act(() => queued?.(1));
  expect(screen.getByRole("status").textContent).toContain(
    "树木 · X 0, Y 0, Z 128",
  );
  expect(paint.at(-1)).toBe("fillText:树木,300,323");
  fireEvent.click(screen.getByRole("checkbox", { name: /树木/ }));
  paint.length = 0;
  act(() => queued?.(2));
  expect(treeFill()).toBe(false);
  fireEvent(
    canvas,
    new MouseEvent("pointermove", {
      clientX: 300,
      clientY: 300,
      bubbles: true,
    }),
  );
  expect(screen.queryByRole("status")?.textContent ?? "").not.toContain("树木");
  paint.length = 0;
  fireEvent(
    canvas,
    new MouseEvent("pointermove", {
      clientX: 329,
      clientY: 300,
      bubbles: true,
    }),
  );
  act(() => queued?.(3));
  expect(paint).toContain("set:lineWidth:5");
  expect(paint.some((s) => s.includes("Z 轴范围：-128～256"))).toBe(true);
  expect(paint.indexOf("set:lineWidth:5")).toBeGreaterThan(
    paint.findIndex((s) => s.startsWith("arc:")),
  );
  expect(paint.at(-1)).toBe("fillText:营地,328.8,323");
  expect(paint.some((s) => s.startsWith("arc:328.8,300,4,"))).toBe(true);
  expect(paint.some((s) => s.startsWith("arc:328.8,300,11,"))).toBe(false);
  paint.length = 0;
  fireEvent.pointerLeave(canvas);
  act(() => queued?.(4));
  expect(paint).not.toContain("set:lineWidth:5");
  expect(paint.some((s) => s.includes("Z 轴范围"))).toBe(false);
  fireEvent(
    canvas,
    new MouseEvent("pointermove", {
      clientX: 200,
      clientY: 156,
      bubbles: true,
    }),
  );
  act(() => queued?.(4.5));
  const preview = screen.getByRole("status", { name: "兵线路径收益" });
  expect(preview.textContent).toContain("经验 200");
  expect(preview.textContent).toContain("天辉");
  expect(preview.textContent).toContain("夜魇");
  fireEvent.change(screen.getByLabelText("游戏时间"), {
    target: { value: "450" },
  });
  expect(preview.textContent).toContain("经验 208");
  fireEvent.click(screen.getByRole("combobox", { name: "地图兵营情景" }));
  fireEvent.click(
    within(screen.getByRole("listbox", { name: "地图兵营情景" })).getByRole(
      "option",
      { name: "本路两座兵营被毁" },
    ),
  );
  expect(preview.textContent).toContain("经验 108");
  fireEvent.click(screen.getByRole("checkbox", { name: "兵线路径" }));
  expect(screen.queryByRole("status", { name: "兵线路径收益" })).toBeNull();
  const campButton = screen.getByRole("button", { name: "营地 10, 0" });
  fireEvent.pointerEnter(campButton);
  act(() => queued?.(5));
  expect(paint).toContain("set:lineWidth:5");
  paint.length = 0;
  fireEvent.pointerLeave(campButton);
  act(() => queued?.(6));
  expect(paint).not.toContain("set:lineWidth:5");
  const campLayer = screen
    .getByRole("checkbox", { name: /野怪营地/ })
    .closest("label")!;
  fireEvent.pointerEnter(campLayer);
  act(() => queued?.(7));
  expect(paint).toContain("set:lineWidth:5");
  fireEvent.pointerLeave(campLayer);
  fireEvent.click(screen.getByRole("button", { name: "寻路" }));

  (canvas as HTMLCanvasElement).setPointerCapture = vi.fn();
  fireEvent(
    canvas,
    new MouseEvent("pointermove", {
      clientX: 156,
      clientY: 70,
      bubbles: true,
    }),
  );
  act(() => queued?.(8));
  expect(canvas.getAttribute("data-pick-hint")).toBe("点击设置起点 A");
  for (const x of [156, 444]) {
    fireEvent(
      canvas,
      new MouseEvent("pointerdown", {
        clientX: x,
        clientY: 70,
        button: 0,
        bubbles: true,
      }),
    );
    fireEvent(
      canvas,
      new MouseEvent("pointerup", {
        clientX: x,
        clientY: 70,
        button: 0,
        bubbles: true,
      }),
    );
  }
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "寻路设置与结果" }).textContent,
    ).toContain("0.4 秒"),
  );
  fireEvent.change(screen.getByLabelText("英雄移动速度"), {
    target: { value: "100" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "寻路设置与结果" }).textContent,
    ).toContain("1.1 秒"),
  );
  expect(screen.getByRole("button", { name: "路线 1" })).toBeTruthy();
  fireEvent.keyDown(screen.getByLabelText("英雄移动速度"), { key: "Delete" });
  expect(screen.getByRole("button", { name: "路线 1" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "新建路线" }));
  for (const x of [200, 400]) {
    fireEvent(
      canvas,
      new MouseEvent("pointerdown", {
        clientX: x,
        clientY: 530,
        button: 0,
        bubbles: true,
      }),
    );
    fireEvent(
      canvas,
      new MouseEvent("pointerup", {
        clientX: x,
        clientY: 530,
        button: 0,
        bubbles: true,
      }),
    );
  }
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "路线 2" })).toBeTruthy(),
  );
  // Pick the first route by its rendered line, not only via the sidebar list.
  fireEvent(
    canvas,
    new MouseEvent("pointerdown", {
      clientX: 300,
      clientY: 24,
      button: 0,
      bubbles: true,
    }),
  );
  fireEvent(
    canvas,
    new MouseEvent("pointerup", {
      clientX: 300,
      clientY: 24,
      button: 0,
      bubbles: true,
    }),
  );
  expect(
    screen.getByRole("button", { name: "路线 1" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.keyDown(canvas, { key: "Delete" });
  expect(screen.queryByRole("button", { name: "路线 1" })).toBeNull();
  expect(screen.getByRole("button", { name: "路线 2" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "测距" }));
  expect(screen.queryByRole("region", { name: "寻路设置与结果" })).toBeNull();
  expect(screen.getByRole("button", { name: "测距" }).className).toContain(
    "ring-cyan",
  );
  fireEvent.contextMenu(canvas);
  expect(
    screen.getByRole("button", { name: "测距" }).getAttribute("aria-pressed"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "寻路" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(
    screen.getByRole("button", { name: "寻路" }).getAttribute("aria-pressed"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "寻路" }));
  expect(screen.getByRole("button", { name: "路线 2" })).toBeTruthy();
  fireEvent.contextMenu(canvas);
  expect(
    screen.getByRole("button", { name: "寻路" }).getAttribute("aria-pressed"),
  ).toBe("false");
});
