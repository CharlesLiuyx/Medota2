// @vitest-environment jsdom
import { Profiler } from "react";
import { visionPresets } from "../fixtures/map-vision-presets";
import { LocaleProvider } from "@/i18n/provider";
import { VisionClient } from "@/components/map/vision-client";
import { RouteClient } from "@/components/map/route-client";
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

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

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
  let resize = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  let viewportSize = 0;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => viewportSize,
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    () => viewportSize,
  );
  const context = new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === "createImageData")
          return (w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4),
          });
        if (key === "measureText") return () => ({ width: 30 });
        if (key === "drawImage")
          return (image: CanvasImageSource) => {
            if (
              image instanceof HTMLCanvasElement &&
              (image.width === 0 || image.height === 0)
            )
              throw new DOMException("Zero-sized canvas", "InvalidStateError");
          };
        return () => {};
      },
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
  const dispose = vi.spyOn(RouteClient.prototype, "dispose");
  const payload = {
    bounds: { minX: 0, maxX: 6400, minY: 0, maxY: 6400 },
    points,
    imageUrl: "/fixture.webp",
    clientVersion: "6944",
    coverage: null,
  };
  const { unmount, rerender } = render(
    <LocaleProvider initialLocale="zh-CN">
      <MapViewer data={payload} />
    </LocaleProvider>,
  );
  const canvas = screen.getByLabelText(/交互地图/) as HTMLCanvasElement;
  canvas.setPointerCapture = vi.fn();
  flush();
  expect(canvas.dataset.paints).toBeUndefined();
  expect(widthWrites).not.toHaveBeenCalled();
  expect(heightWrites).not.toHaveBeenCalled();
  viewportSize = 600;
  resize();
  flush();
  const visiblePaints = canvas.dataset.paints;
  // Hide after queuing a frame, as happens when navigating away from a map.
  resize();
  viewportSize = 0;
  resize();
  flush();
  expect(canvas.dataset.paints).toBe(visiblePaints);
  expect(canvas.width).toBe(600);
  expect(canvas.height).toBe(600);
  viewportSize = 600;
  resize();
  flush();
  expect(Number(canvas.dataset.paints)).toBeGreaterThan(Number(visiblePaints));
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
  expect(screen.getByRole("status").textContent).toContain("树 ·");
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
  fireEvent.keyDown(document, { key: "Escape" });
  flush();
  fireEvent.click(screen.getByRole("button", { name: "寻路" }));
  flush();
  expect(widthWrites).not.toHaveBeenCalled();
  expect(heightWrites).not.toHaveBeenCalled();
  rerender(
    <LocaleProvider initialLocale="en">
      <MapViewer data={{ ...payload, points: [...points] }} />
    </LocaleProvider>,
  );
  flush();
  expect(screen.getByRole("button", { name: "Routes" })).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "Point details" }).textContent,
  ).toContain("3200, 3200");
  expect(dispose).not.toHaveBeenCalled();
  expect(widthWrites.mock.contexts).not.toContain(canvas);
  expect(heightWrites.mock.contexts).not.toContain(canvas);
  unmount();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(0);
});

it("shows and hits trees at 100%, draws the hover label above markers, and obeys the layer switch", async () => {
  // Tooltip positioning and map paints can queue independent animation frames.
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flush = (time: number) =>
    act(() => {
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach((callback) => callback(time));
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
          { ...tree, id: "shop", label: "商店", kind: "shop", x: 70 },
          {
            ...tree,
            id: "melee-rax",
            label: "近战兵营",
            kind: "barracks",
            x: -70,
            properties: { mapunitname: "npc_dota_goodguys_melee_rax_top" },
          },
          {
            ...tree,
            id: "range-rax",
            label: "远程兵营",
            kind: "barracks",
            x: -50,
            properties: { subType: "range" },
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
          groups: [
            {
              id: "camp-group",
              label: "测试野怪",
              tier: 0,
              spawnType: 1,
              members: [{ unit: "npc_dota_creep_goodguys_melee", count: 1 }],
              children: [],
            },
          ],
          camps: [
            {
              pointId: "camp",
              name: "camp-a",
              tier: 0,
              minType: 1,
              maxType: 1,
              forced: 0,
              maxUpgrade: 0,
              stack: [54, 55],
              stackDirection: null,
              pulls: [{ team: "radiant", windows: [[15, 17]], direction: 90 }],
            },
          ],
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
  flush(0);
  expect(screen.getByLabelText("缩放比例").textContent).toBe("100%");
  for (const [option, count] of [
    ["近战兵营被毁", 1],
    ["远程兵营被毁", 1],
    ["本路两座兵营被毁", 2],
    ["全部六座兵营被毁 · 超级兵", 2],
    ["普通兵 · 兵营完整", 0],
  ] as const) {
    fireEvent.click(screen.getByRole("combobox", { name: "地图兵营情景" }));
    fireEvent.click(
      within(screen.getByRole("listbox", { name: "地图兵营情景" })).getByRole(
        "option",
        { name: option },
      ),
    );
    paint.length = 0;
    flush(0);
    expect(
      paint.filter((entry) => entry === "set:strokeStyle:#ef8a83"),
    ).toHaveLength(count);
    if (count === 1) {
      const centerX = option === "近战兵营被毁" ? 98.4 : 156;
      expect(
        paint.some(
          (entry) =>
            entry.startsWith("moveTo:") &&
            Math.abs(
              Number(entry.split(":")[1].split(",")[0]) - (centerX - 8),
            ) < 0.001,
        ),
      ).toBe(true);
    }
  }
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
    (screen.getByRole("checkbox", { name: "野区金币" }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  expect(
    (screen.getByRole("checkbox", { name: "兵线路径" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
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
  ).toBe(false);
  expect(paint.some((s) => s.startsWith("fillText:10–20,"))).toBe(false);
  expect(paint.some((s) => s.includes("叠 54–55秒"))).toBe(false);
  expect(paint.some((s) => s.includes("天拉 15–17秒"))).toBe(false);
  expect(paint.some((s) => s.includes("Z 轴范围"))).toBe(false);
  // Timings sit above the camp; rewards sit below its boundary and name.
  for (const [toggles, expected] of [
    [["野区金币"], ["10–20"]],
    [["野区经验"], ["经验 50"]],
    [["拉野/叠野秒数"], ["叠 54–55秒", "天拉 15–17秒"]],
    [
      ["野区金币", "野区经验"],
      ["10–20", "经验 50"],
    ],
  ]) {
    for (const name of toggles)
      fireEvent.click(screen.getByRole("checkbox", { name }));
    paint.length = 0;
    flush(0.1);
    expected.forEach((text, row) => {
      const draw = paint.find((entry) => entry.startsWith(`fillText:${text},`));
      expect(draw).toBeDefined();
      const [, x, y] = draw!.split(",");
      expect(Number(x)).toBeCloseTo(328.8);
      expect(Number(y)).toBeCloseTo(
        toggles[0] === "拉野/叠野秒数" ? 275.6 - row * 16 : 339 + row * 16,
      );
    });
    for (const name of toggles)
      fireEvent.click(screen.getByRole("checkbox", { name }));
    flush(0.2);
  }
  // MouseEvent supplies screen coordinates in jsdom, which has no native PointerEvent.
  fireEvent(
    canvas,
    new MouseEvent("pointermove", {
      clientX: 300,
      clientY: 300,
      bubbles: true,
    }),
  );
  flush(1);
  expect(screen.getByRole("status").textContent).toContain(
    "树 · X 0, Y 0, Z 128",
  );
  expect(paint.at(-1)).toBe("fillText:树,300,323");
  fireEvent.click(screen.getByRole("checkbox", { name: /树/ }));
  paint.length = 0;
  flush(2);
  expect(treeFill()).toBe(false);
  fireEvent(
    canvas,
    new MouseEvent("pointermove", {
      clientX: 300,
      clientY: 300,
      bubbles: true,
    }),
  );
  expect(screen.queryByRole("status")?.textContent ?? "").not.toContain("树 ·");
  paint.length = 0;
  fireEvent(
    canvas,
    new MouseEvent("pointermove", {
      clientX: 329,
      clientY: 300,
      bubbles: true,
    }),
  );
  flush(3);
  expect(paint.some((s) => s.startsWith("fillText:10–20,"))).toBe(true);
  expect(paint.some((s) => s.includes("叠 54–55秒"))).toBe(true);
  expect(paint.some((s) => s.includes("天拉 15–17秒"))).toBe(true);
  expect(paint.some((s) => s.startsWith("fillText:经验 50,"))).toBe(true);
  for (const [text, side] of [
    ["叠 54–55秒", "top"],
    ["天拉 15–17秒", "top"],
    ["10–20", "bottom"],
    ["经验 50", "bottom"],
  ]) {
    const draws = paint.filter((entry) =>
      entry.startsWith(`fillText:${text},`),
    );
    expect(draws.length).toBeGreaterThan(0);
    for (const draw of draws) {
      const y = Number(draw.split(",")[2]);
      if (side === "top") expect(y).toBeLessThan(285.6);
      else expect(y).toBeGreaterThan(323);
    }
  }
  expect(canvas.style.cursor).toBe("default");
  const hoverCard = screen.getByRole("region", { name: "营地组合详情" });
  expect(hoverCard.textContent).toContain("金币 10–20");
  expect(hoverCard.textContent).toContain("经验 50");
  expect(hoverCard.textContent).toContain(":54–:55");
  expect(hoverCard.textContent).toContain("天辉拉野：:15–:17");
  expect(hoverCard.textContent).toContain("Z 轴 128.0");
  expect(hoverCard.textContent).toContain("Z 轴范围：-128.0～256.0");
  expect(hoverCard.textContent).toContain("测试野怪");
  expect(hoverCard.textContent).toContain("×1");
  expect(paint).toContain("set:lineWidth:5");
  expect(paint.some((s) => s.includes("Z 轴范围：-128～256"))).toBe(false);
  expect(paint.indexOf("set:lineWidth:5")).toBeGreaterThan(
    paint.findIndex((s) => s.startsWith("arc:")),
  );
  expect(paint.at(-1)).toBe("fillText:营地,328.8,323");
  expect(paint.some((s) => s.startsWith("arc:328.8,300,4,"))).toBe(true);
  expect(paint.some((s) => s.startsWith("arc:328.8,300,11,"))).toBe(false);
  for (const name of ["野区金币", "野区经验", "拉野/叠野秒数"]) {
    fireEvent.click(screen.getByRole("checkbox", { name }));
    paint.length = 0;
    flush(3.01);
    expect(paint.some((s) => s.startsWith("fillText:10–20,"))).toBe(true);
    expect(paint.some((s) => s.includes("叠 54–55秒"))).toBe(true);
    expect(paint.some((s) => s.includes("天拉 15–17秒"))).toBe(true);
    expect(paint.some((s) => s.startsWith("fillText:经验 50,"))).toBe(true);
  }
  for (const name of ["野区金币", "野区经验", "拉野/叠野秒数"])
    fireEvent.click(screen.getByRole("checkbox", { name }));
  flush(3.02);
  (canvas as HTMLCanvasElement).setPointerCapture = vi.fn();
  for (const type of ["pointerdown", "pointerup"]) {
    fireEvent(
      canvas,
      new MouseEvent(type, {
        clientX: 329,
        clientY: 300,
        button: 0,
        bubbles: true,
      }),
    );
  }
  paint.length = 0;
  fireEvent.pointerLeave(canvas);
  flush(3.1);
  const selectedCard = screen.getByRole("region", { name: "营地组合详情" });
  expect(selectedCard.textContent).toContain("金币 10–20");
  expect(selectedCard.textContent).toContain("经验 50");
  expect(selectedCard.textContent).toContain("Z 轴范围：-128.0～256.0");
  expect(selectedCard.textContent).toContain("×1");
  expect(selectedCard.textContent).toContain("叠野：每分钟");

  expect(paint).toContain("set:lineWidth:5");
  expect(paint.some((s) => s.includes("Z 轴范围：-128～256"))).toBe(false);
  expect(paint.some((s) => s.startsWith("fillText:经验 50,"))).toBe(true);
  expect(paint.at(-1)).toBe("fillText:营地,328.8,323");
  // Moving onto empty space must not remove the selected camp's foreground.
  paint.length = 0;
  fireEvent(
    canvas,
    new MouseEvent("pointermove", { clientX: 25, clientY: 25, bubbles: true }),
  );
  flush(3.2);
  // No hover change: keep the previous complete frame rather than repaint it.
  expect(paint).toHaveLength(0);
  fireEvent(
    canvas,
    new MouseEvent("pointermove", {
      clientX: 502,
      clientY: 300,
      bubbles: true,
    }),
  );
  flush(3.25);
  expect(paint.some((s) => s.startsWith("fillText:营地,"))).toBe(true);
  expect(paint.some((s) => s.startsWith("fillText:商店,"))).toBe(true);
  expect(paint).toContain("set:lineWidth:5");
  expect(paint.some((s) => s.startsWith("fillText:经验 50,"))).toBe(true);
  const campToggle = screen.getByRole("checkbox", { name: /野怪营地/ });
  fireEvent.click(campToggle);
  paint.length = 0;
  flush(3.3);
  expect(paint).not.toContain("set:lineWidth:5");
  expect(paint.some((s) => s.includes("Z 轴范围"))).toBe(false);
  expect(paint.some((s) => s.startsWith("fillText:经验 50,"))).toBe(false);
  fireEvent.click(campToggle);
  paint.length = 0;
  flush(3.4);
  expect(paint).toContain("set:lineWidth:5");
  fireEvent.click(screen.getByRole("button", { name: "关闭点位详情" }));
  paint.length = 0;
  fireEvent.pointerLeave(canvas);
  flush(4);
  expect(paint).not.toContain("set:lineWidth:5");
  expect(paint.some((s) => s.startsWith("fillText:经验 50,"))).toBe(false);
  expect(paint.some((s) => s.includes("Z 轴范围"))).toBe(false);
  fireEvent(
    canvas,
    new MouseEvent("pointermove", {
      clientX: 200,
      clientY: 156,
      bubbles: true,
    }),
  );
  flush(4.5);
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
  flush(5);
  expect(
    screen.getByRole("region", { name: "营地组合详情" }).textContent,
  ).toContain("金币 10–20");
  expect(paint).toContain("set:lineWidth:5");
  paint.length = 0;
  fireEvent.pointerLeave(campButton);
  flush(6);
  expect(screen.queryByRole("region", { name: "营地组合详情" })).toBeNull();
  expect(paint).not.toContain("set:lineWidth:5");
  const campLayer = screen
    .getByRole("checkbox", { name: /野怪营地/ })
    .closest("label")!;
  fireEvent.pointerEnter(campLayer);
  flush(7);
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
  flush(8);
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
  fireEvent.keyDown(screen.getByLabelText("英雄移动速度"), {
    key: "Backspace",
  });
  fireEvent.keyDown(canvas, { key: "Delete", ctrlKey: true });
  fireEvent.keyDown(canvas, { key: "Backspace", metaKey: true });
  fireEvent.keyDown(canvas, { key: "Delete", isComposing: true });
  expect(screen.getByRole("button", { name: "路线 1" })).toBeTruthy();
  const clickRouteCanvas = (x: number, y: number) => {
    for (const type of ["pointerdown", "pointerup"])
      fireEvent(
        canvas,
        new MouseEvent(type, {
          clientX: x,
          clientY: y,
          button: 0,
          bubbles: true,
        }),
      );
  };
  clickRouteCanvas(300, 300);
  expect(
    screen.getByRole("button", { name: "路线 1" }).getAttribute("aria-pressed"),
  ).toBe("false");
  expect(screen.getByText("点击地图选择起点 A")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "删除路线" })).toBeNull();
  fireEvent.keyDown(canvas, { key: "Backspace" });
  expect(screen.getByRole("button", { name: "路线 1" })).toBeTruthy();
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
  clickRouteCanvas(300, 300);
  expect(screen.getByText("点击地图选择起点 A")).toBeTruthy();
  clickRouteCanvas(300, 24); // An existing line can be reselected before placing draft A.
  expect(
    screen.getByRole("button", { name: "路线 1" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.keyDown(canvas, { key: "Delete" });
  expect(screen.queryByRole("button", { name: "路线 1" })).toBeNull();
  expect(screen.getByRole("button", { name: "路线 2" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "测距" })).toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.keyDown(document, { key: "w" });
  fireEvent.keyDown(document, { key: "W" });
  expect(
    screen.getByRole("button", { name: "寻路" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(
    screen.getByRole("button", { name: "寻路" }).getAttribute("aria-pressed"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "寻路" }));
  expect(screen.getByRole("button", { name: "路线 2" })).toBeTruthy();
  const routeTwo = screen.getByRole("button", { name: "路线 2" });
  fireEvent.click(routeTwo);
  expect(routeTwo.getAttribute("data-selected")).toBe("true");
  fireEvent.keyDown(routeTwo, { key: "Backspace" });
  expect(screen.queryByRole("button", { name: "路线 2" })).toBeNull();
  expect(screen.getByText("点击地图选择起点 A")).toBeTruthy();
  fireEvent.contextMenu(canvas);
  expect(
    screen.getByRole("button", { name: "寻路" }).getAttribute("aria-pressed"),
  ).toBe("false");
});

it("toggles currents independently of terrain, invalidates the scene, and resets zoom from its number", () => {
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
      batch.forEach((callback) => callback(0));
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
  const paint: string[] = [];
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === "measureText" ? () => ({ width: 24 }) : () => {},
      set: (_, key, value) => {
        paint.push(`set:${String(key)}:${value}`);
        return true;
      },
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as CanvasRenderingContext2D,
  );
  render(
    <MapViewer
      data={{
        bounds: { minX: -128, maxX: 128, minY: -128, maxY: 128 },
        points: [],
        imageUrl: "/fixture.webp",
        clientVersion: "6944",
        coverage: null,
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
          currents: [
            {
              id: "current",
              maxBonus: 150,
              samples: [
                { x: -100, y: 0, z: 0, radius: 64 },
                { x: 100, y: 0, z: 0, radius: 64 },
              ],
            },
          ],
        },
        rasterLayers: [
          {
            id: "navigation",
            label: "导航栅格",
            file: "navigation.webp",
            url: "/navigation.webp",
            sha256: "a".repeat(64),
            bounds: { minX: -128, maxX: 128, minY: -128, maxY: 128 },
            width: 4,
            height: 4,
            note: "fixture",
          },
          {
            id: "height",
            label: "地面高度",
            file: "height.webp",
            url: "/height.webp",
            sha256: "b".repeat(64),
            bounds: { minX: -128, maxX: 128, minY: -128, maxY: 128 },
            width: 4,
            height: 4,
            note: "fixture",
          },
        ],
      }}
    />,
  );
  const canvas = screen.getByLabelText(/交互地图/) as HTMLCanvasElement;
  flush();
  fireEvent.click(screen.getByRole("button", { name: "放大地图" }));
  flush();
  expect(screen.getByLabelText("缩放比例").textContent).toBe("150%");
  fireEvent.click(screen.getByRole("button", { name: "缩放比例" }));
  flush();
  expect(screen.getByLabelText("缩放比例").textContent).toBe("100%");
  expect(screen.queryByRole("button", { name: "复位地图" })).toBeNull();

  for (const [key, name] of [
    ["2", "导航栅格"],
    ["3", "地面高度"],
    ["1", "底图"],
    ["2", "导航栅格"],
  ]) {
    fireEvent.keyDown(document, { key });
    expect(
      screen.getByRole("button", { name }).getAttribute("aria-pressed"),
    ).toBe("true");
  }
  flush();
  const currentSwitch = screen.getByRole("switch", {
    name: "湍流",
  }) as HTMLInputElement;
  expect(currentSwitch.checked).toBe(false);
  paint.length = 0;
  const builds = Number(canvas.dataset.backgroundBuilds);
  fireEvent.click(currentSwitch);
  flush();
  expect(currentSwitch.checked).toBe(true);
  expect(
    screen
      .getByRole("button", { name: "导航栅格" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(paint).toContain("set:fillStyle:#38bfc950");
  expect(Number(canvas.dataset.backgroundBuilds)).toBe(builds + 1);
  expect(screen.getAllByRole("region", { name: "地形图例" })).toHaveLength(2);
  paint.length = 0;
  fireEvent.click(currentSwitch);
  flush();
  expect(paint).not.toContain("set:fillStyle:#38bfc950");
  expect(Number(canvas.dataset.backgroundBuilds)).toBe(builds + 2);
  fireEvent.keyDown(document, { key: "Escape" });
  flush();
  expect(
    screen.getByRole("button", { name: "底图" }).getAttribute("aria-pressed"),
  ).toBe("true");
});

it("aligns vision on 2x displays and coalesces dragging with bounded live calculations and no background rebuilds", async () => {
  const runs = vi.spyOn(VisionClient.prototype, "run");
  vi.stubGlobal("Worker", undefined);
  vi.stubGlobal("devicePixelRatio", 2);
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  const markers: {
    canvas: HTMLCanvasElement;
    x: number;
    y: number;
    transform: number[];
  }[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      let transform: number[] = [];
      return new Proxy(
        {},
        {
          get: (_, name) => {
            if (name === "setTransform")
              return (...values: number[]) => {
                transform = values;
              };
            if (name === "fillRect")
              return (x: number, y: number, w: number, h: number) => {
                if (w === 96 && h === 96)
                  markers.push({
                    canvas: this,
                    x: x + w / 2,
                    y: y + h / 2,
                    transform,
                  });
              };
            if (name === "createImageData")
              return (w: number, h: number) => ({
                data: new Uint8ClampedArray(w * h * 4),
              });
            if (name === "measureText") return () => ({ width: 20 });
            return () => {};
          },
          set: () => true,
        },
      ) as CanvasRenderingContext2D;
    },
  );
  const bounds = { minX: -128, maxX: 128, minY: -128, maxY: 128 };
  render(
    <MapViewer
      data={{
        bounds,
        visionPresets: {
          ...visionPresets,
          presets: visionPresets.presets.map((p) =>
            p.key === "npc_dota_hero_axe" ? { ...p, collisionRadius: 43 } : p,
          ),
        },
        points: [],
        imageUrl: null,
        clientVersion: "fixture",
        coverage: null,
        rasterLayers: (["navigation", "height"] as const).map((id) => ({
          id,
          label: id === "navigation" ? "导航栅格" : "地面高度",
          file: `${id}.webp` as const,
          url: `/${id}.webp`,
          sha256: "a".repeat(64),
          bounds,
          width: 4,
          height: 4,
          note: "fixture",
        })),
        visionScene: {
          datasetRevision: "fixture",
          scene: {
            bounds,
            trees: [],
            terrain: {
              cell: 64,
              width: 4,
              height: 4,
              origin: { x: -128, y: -128 },
              values: Array(16).fill(0),
            },
          },
        },
      }}
    />,
  );
  const canvas = screen.getByLabelText(/交互地图/) as HTMLCanvasElement;
  canvas.setPointerCapture = vi.fn();
  const flush = () =>
    act(() => {
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach((callback) => callback(0));
    });
  flush();
  const pointSearch = screen.getByRole("textbox", { name: "搜索地图点位" });
  fireEvent.keyDown(pointSearch, { key: "q" });
  fireEvent.keyDown(document, { key: "q", ctrlKey: true });
  fireEvent.keyDown(document, { key: "q", isComposing: true });
  fireEvent.keyDown(document, { key: "q", repeat: true });
  expect(
    screen.getByRole("button", { name: "视野" }).getAttribute("aria-pressed"),
  ).toBe("false");
  fireEvent.keyDown(document, { key: "q" });
  fireEvent.keyDown(document, { key: "Q" });
  expect(
    screen.getByRole("button", { name: "视野" }).getAttribute("aria-pressed"),
  ).toBe("true");

  const terrainButton = screen.getByRole("button", { name: "导航栅格" });
  expect(terrainButton.getAttribute("aria-keyshortcuts")).toBeNull();
  expect(terrainButton.querySelector("kbd")?.className).toContain("invisible");
  fireEvent.keyDown(document, { key: "2" });
  expect(
    screen
      .getByRole("button", { name: "岗哨守卫" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(terrainButton.getAttribute("aria-pressed")).toBe("false");
  fireEvent.keyDown(document, { key: "3" });
  expect(
    screen.getByRole("button", { name: "英雄" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.keyDown(pointSearch, { key: "1" });
  fireEvent.keyDown(document, { key: "1", ctrlKey: true });
  expect(
    screen.getByRole("button", { name: "英雄" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.keyDown(document, { key: "Escape" });
  expect(terrainButton.getAttribute("aria-keyshortcuts")).toBe("2");
  expect(terrainButton.querySelector("kbd")?.className).not.toContain(
    "invisible",
  );
  fireEvent.keyDown(document, { key: "2" });
  expect(terrainButton.getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(document, { key: "1" });
  fireEvent.keyDown(document, { key: "q" });
  fireEvent.keyDown(document, { key: "1" });
  expect(
    screen
      .getByRole("button", { name: "侦查守卫" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    screen
      .getByRole("button", { name: "侦查守卫" })
      .getAttribute("aria-keyshortcuts"),
  ).toBe("1");

  fireEvent.keyDown(document, { key: "1" });
  expect(
    screen
      .getByRole("button", { name: "侦查守卫" })
      .getAttribute("aria-pressed"),
  ).toBe("false");
  expect(
    screen
      .getByRole("button", { name: "选中模式" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(canvas.style.cursor).toBe("default");
  fireEvent.keyDown(document, { key: "1" });
  expect(
    screen
      .getByRole("button", { name: "侦查守卫" })
      .getAttribute("aria-pressed"),
  ).toBe("true");

  for (const type of ["pointerdown", "pointerup"])
    fireEvent(
      canvas,
      new MouseEvent(type, {
        clientX: 200,
        clientY: 200,
        button: 0,
        bubbles: true,
      }),
    );
  await waitFor(() => expect(screen.getByText(/视野计算完成/)).toBeTruthy());
  flush();
  expect(
    markers.filter((marker) => marker.canvas === canvas).at(-1),
  ).toMatchObject({ x: 248, y: 152, transform: [2, 0, 0, 2, 0, 0] });
  fireEvent.keyDown(canvas, { key: "Escape" });
  expect(
    screen
      .getByRole("button", { name: "选中模式" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  const backgroundBuilds = canvas.dataset.backgroundBuilds;
  const sourceLabel = screen.getByRole("button", {
    name: /^来源 1 ·/,
  }).textContent;
  expect(runs).toHaveBeenCalledTimes(1);
  fireEvent(
    canvas,
    new MouseEvent("pointerdown", {
      clientX: 248,
      clientY: 152,
      button: 0,
      bubbles: true,
    }),
  );
  for (let i = 1; i <= 500; i++)
    fireEvent(
      canvas,
      new MouseEvent("pointermove", {
        clientX: 248 + i * 0.16,
        clientY: 152 + i * 0.04,
        bubbles: true,
      }),
    );
  expect(frames.size).toBe(1);
  flush();
  await waitFor(() => expect(runs).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByText(/视野计算完成/)).toBeTruthy());
  expect(screen.getByRole("button", { name: /^来源 1 ·/ }).textContent).toBe(
    sourceLabel,
  );
  expect(canvas.dataset.backgroundBuilds).toBe(backgroundBuilds);
  expect(runs).toHaveBeenCalledTimes(2);
  const preview = markers.filter((marker) => marker.canvas === canvas).at(-1)!;
  expect(preview.x).toBeCloseTo(344, 0);
  expect(preview.y).toBeCloseTo(152, 0);
  fireEvent(
    canvas,
    new MouseEvent("pointerup", {
      clientX: 328,
      clientY: 172,
      button: 0,
      bubbles: true,
    }),
  );
  await waitFor(() => expect(screen.getByText(/视野计算完成/)).toBeTruthy());
  expect(runs).toHaveBeenCalledTimes(3);
  expect(
    screen.getByRole("button", { name: /^来源 1 ·/ }).textContent,
  ).not.toBe(sourceLabel);
  flush();
  const movedLabel = screen.getByRole("button", {
    name: /^来源 1 ·/,
  }).textContent;
  fireEvent(
    canvas,
    new MouseEvent("pointerdown", {
      clientX: preview.x,
      clientY: preview.y,
      button: 0,
      bubbles: true,
    }),
  );
  fireEvent(
    canvas,
    new MouseEvent("pointermove", {
      clientX: preview.x + 40,
      clientY: preview.y + 40,
      bubbles: true,
    }),
  );
  fireEvent(canvas, new MouseEvent("pointercancel", { bubbles: true }));
  expect(screen.getByRole("button", { name: /^来源 1 ·/ }).textContent).toBe(
    movedLabel,
  );

  // A large hero is selectable at the visible icon's corner, outside the old circle hit area.
  fireEvent.click(screen.getByRole("button", { name: "移除来源" }));
  fireEvent.click(screen.getByRole("button", { name: /^英雄$/ }));
  const pointer = (type: string, x: number, y: number, shiftKey = false) =>
    fireEvent(
      canvas,
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        button: 0,
        bubbles: true,
        shiftKey,
      }),
    );
  for (const at of [
    { x: 200, y: 200 },
    { x: 320, y: 320 },
  ]) {
    pointer("pointerdown", at.x, at.y);
    pointer("pointerup", at.x, at.y);
  }
  fireEvent.click(screen.getByRole("button", { name: "选中模式" }));
  expect(canvas.style.cursor).toBe("default");
  const firstHero = screen.getByRole("button", { name: /^来源 1 ·/ });
  expect(firstHero.getAttribute("aria-pressed")).toBe("false");
  const beforeHeroMove = firstHero.textContent;
  pointer("pointermove", 320, 80);
  flush();
  expect(canvas.style.cursor).toBe("default");
  const heroTip = screen.getByRole("tooltip", { name: "英雄视野信息" });
  expect(heroTip.textContent).toContain("斧王");
  expect(heroTip.textContent).toContain("白天视野1,800");
  expect(heroTip.textContent).toContain("夜晚视野800");
  expect(heroTip.textContent).toContain("初始移速315");
  const hoverBuilds = canvas.dataset.backgroundBuilds;
  pointer("pointermove", 398, 80); // Remain over the enlarged artwork, outside its original bounds.
  flush();
  expect(screen.getByRole("tooltip", { name: "英雄视野信息" })).toBeTruthy();
  expect(canvas.dataset.backgroundBuilds).toBe(hoverBuilds);
  // Shift toggles the canvas hit in the selection; the sidebar shows the same set.
  pointer("pointerdown", 398, 80, true);
  pointer("pointerup", 398, 80, true);
  expect(firstHero.getAttribute("aria-pressed")).toBe("true");
  expect(
    screen
      .getByRole("button", { name: /^来源 2 ·/ })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  pointer("pointerdown", 320, 80, true);
  pointer("pointerup", 320, 80, true);
  expect(firstHero.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(firstHero, { shiftKey: true });
  expect(firstHero.getAttribute("aria-pressed")).toBe("true");
  pointer("pointerdown", 10, 10);
  pointer("pointerup", 10, 10);
  expect(
    screen
      .getAllByRole("button", { name: /^来源 \d+ ·/ })
      .every((source) => source.getAttribute("aria-pressed") === "false"),
  ).toBe(true);
  // A plain click returns to one source and still supports its existing drag behavior.
  pointer("pointermove", 320, 80);
  flush();
  pointer("pointerdown", 398, 80);
  expect(firstHero.getAttribute("aria-pressed")).toBe("true");
  expect(firstHero.closest("li")?.getAttribute("data-selected")).toBe("true");
  expect(
    screen
      .getByRole("button", { name: /^来源 2 ·/ })
      .closest("li")
      ?.getAttribute("data-selected"),
  ).toBe("false");
  expect(screen.queryByRole("tooltip", { name: "英雄视野信息" })).toBeNull();
  pointer("pointermove", 334, 144);
  flush();
  expect(canvas.style.cursor).toBe("default");
  pointer("pointerup", 334, 144);
  expect(firstHero.textContent).not.toBe(beforeHeroMove);
  expect(canvas.style.cursor).toBe("default");
  pointer("pointermove", 10, 10); // Empty terrain keeps the same arrow.
  flush();
  expect(canvas.style.cursor).toBe("default");
  expect(screen.queryByRole("tooltip", { name: "英雄视野信息" })).toBeNull();
  // Escape from the default selection mode closes vision, preserving the scenario.
  fireEvent.keyDown(canvas, { key: "Escape" });
  expect(
    screen.getByRole("button", { name: "视野" }).getAttribute("aria-pressed"),
  ).toBe("false");
  expect(screen.queryByRole("button", { name: /^来源 1 ·/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "视野" }));
  expect(screen.getByRole("button", { name: /^来源 1 ·/ })).toBeTruthy();
  const first = screen.getByRole("button", { name: /^来源 1 ·/ });
  fireEvent.click(first);
  const originalLabel = first.getAttribute("aria-label")!;
  const radius = screen.getByRole("spinbutton", { name: "来源 1 白天半径" });
  fireEvent.keyDown(radius, { key: "Delete" });
  fireEvent.keyDown(pointSearch, { key: "Backspace" });
  fireEvent.keyDown(document, { key: "Delete", ctrlKey: true });
  expect(screen.getAllByRole("button", { name: /^来源 \d+ ·/ })).toHaveLength(
    2,
  );
  fireEvent.keyDown(canvas, { key: "Delete" });
  expect(screen.queryByRole("button", { name: originalLabel })).toBeNull();
  expect(screen.getAllByRole("button", { name: /^来源 \d+ ·/ })).toHaveLength(
    1,
  );
  fireEvent.keyDown(canvas, { key: "Delete" }); // No selection: do not delete the next item.
  expect(screen.getAllByRole("button", { name: /^来源 \d+ ·/ })).toHaveLength(
    1,
  );
  fireEvent.click(screen.getByRole("button", { name: /^来源 1 ·/ }));
  fireEvent.keyDown(canvas, { key: "Backspace" });
  expect(screen.queryByRole("button", { name: /^来源 1 ·/ })).toBeNull();
});

it("draws native point artwork after asynchronous loading and reuses its background on hover", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    frames.set(++sequence, f);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flush = () =>
    act(() => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((f) => f(0));
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
  const images: { src: string; onload: null | (() => void) }[] = [];
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      naturalWidth = 64;
      naturalHeight = 32;
      onload = null;
      onerror = null;
      constructor() {
        images.push(this);
      }
    },
  );
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    new Proxy(
      {},
      {
        get: (_, name) =>
          name === "drawImage"
            ? drawImage
            : name === "measureText"
              ? () => ({ width: 30 })
              : () => {},
        set: () => true,
      },
    ) as CanvasRenderingContext2D,
  );
  render(
    <MapViewer
      data={{
        bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
        imageUrl: null,
        clientVersion: "6944",
        coverage: null,
        points: [
          {
            id: "tower",
            kind: "tower",
            label: "防御塔",
            team: "radiant",
            x: 0,
            y: 0,
            z: 0,
            sourceClass: "tower",
            sourcePath: "fixture",
            properties: {},
          },
          {
            id: "tower2",
            kind: "tower",
            label: "另一防御塔",
            team: "radiant",
            x: 500,
            y: 500,
            z: 0,
            sourceClass: "tower",
            sourcePath: "fixture",
            properties: {},
          },
        ],
        mapIcons: {
          bundleVersion: "fixture",
          points: { tower: "native_tower", tower2: "native_tower" },
          missing: [],
          icons: [
            {
              key: "native_tower",
              label: "塔",
              group: "map",
              width: 64,
              height: 32,
              url: "/map/icons/native_tower?v=fixture",
            },
          ],
        },
      }}
    />,
  );
  const canvas = screen.getByLabelText(/交互地图/) as HTMLCanvasElement;
  flush();
  const before = Number(canvas.dataset.backgroundBuilds);
  expect(images).toHaveLength(1);
  const layer = screen
    .getByRole("checkbox", { name: /防御塔/ })
    .closest("label")!;
  expect(layer.querySelector("img")?.getAttribute("src")).toBe(
    "/map/icons/native_tower?v=fixture",
  );
  act(() => images[0].onload?.());
  flush();
  expect(Number(canvas.dataset.backgroundBuilds)).toBe(before + 1);
  expect(
    drawImage.mock.calls.some(
      ([image, , , w, h]) => image === images[0] && w === 24 && h === 12,
    ),
  ).toBe(true);
  drawImage.mockClear();
  fireEvent.pointerEnter(layer);
  flush();
  expect(
    drawImage.mock.calls.filter(
      ([image, , , w]) => image === images[0] && w > 24,
    ),
  ).toHaveLength(2);
  expect(Number(canvas.dataset.backgroundBuilds)).toBe(before + 1);
  fireEvent.pointerLeave(layer);
  flush();
  fireEvent(
    canvas,
    new MouseEvent("pointermove", {
      clientX: 300,
      clientY: 300,
      bubbles: true,
    }),
  );
  flush();
  expect(Number(canvas.dataset.backgroundBuilds)).toBe(before + 1);
});

it("pans both scroll axes, anchors accelerated pinch, and coalesces camera paints without React commits", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    frames.set(++sequence, f);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flush = () =>
    act(() => {
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach((f) => f(0));
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
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    new Proxy(
      {},
      {
        get: (_, k) => (k === "measureText" ? () => ({ width: 24 }) : () => {}),
        set: () => true,
      },
    ) as CanvasRenderingContext2D,
  );
  const commits = vi.fn();
  render(
    <Profiler id="map" onRender={commits}>
      <MapViewer
        data={{
          bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
          points: [],
          imageUrl: null,
          clientVersion: "fixture",
          coverage: null,
        }}
      />
    </Profiler>,
  );
  const canvas = screen.getByLabelText(/交互地图/) as HTMLCanvasElement;
  canvas.setPointerCapture = vi.fn();
  flush();
  commits.mockClear();
  const before = Number(canvas.dataset.paints);
  const backgroundBuilds = Number(canvas.dataset.backgroundBuilds);
  for (let i = 0; i < 100; i++)
    fireEvent.wheel(canvas, { deltaX: 0.4, deltaY: 0.24 });
  expect(frames.size).toBe(1);
  flush();
  expect(Number(canvas.dataset.cameraX)).toBeCloseTo(40 / 0.288);
  expect(Number(canvas.dataset.cameraY)).toBeCloseTo(-24 / 0.288);
  expect(canvas.dataset.zoom).toBe("1");
  expect(Number(canvas.dataset.paints) - before).toBe(1);
  expect(Number(canvas.dataset.backgroundBuilds)).toBe(backgroundBuilds);
  const anchor = {
    x: Number(canvas.dataset.cameraX) + 120 / 0.288,
    y: Number(canvas.dataset.cameraY) + 90 / 0.288,
  };
  fireEvent.wheel(canvas, {
    ctrlKey: true,
    deltaY: -10,
    clientX: 420,
    clientY: 210,
  });
  flush();
  let zoom = Number(canvas.dataset.zoom);
  const pinchFactor = zoom;
  expect(zoom).toBeCloseTo(Math.exp(0.08));
  expect(Number(canvas.dataset.cameraX) + 120 / (0.288 * zoom)).toBeCloseTo(
    anchor.x,
  );
  expect(Number(canvas.dataset.cameraY) + 90 / (0.288 * zoom)).toBeCloseTo(
    anchor.y,
  );
  expect(screen.getByRole("button", { name: "缩放比例" }).textContent).toBe(
    `${Math.round(zoom * 100)}%`,
  );
  // A real modifier key distinguishes accelerated scrolling from browser pinch.
  fireEvent.keyDown(document, { key: "Control", ctrlKey: true });
  fireEvent.wheel(canvas, {
    ctrlKey: true,
    deltaY: 10,
    clientX: 300,
    clientY: 300,
  });
  flush();
  expect(Number(canvas.dataset.zoom)).toBe(1);
  fireEvent.wheel(canvas, {
    ctrlKey: true,
    deltaY: -10,
    clientX: 300,
    clientY: 300,
  });
  flush();
  expect(Number(canvas.dataset.zoom)).toBeCloseTo(pinchFactor ** 2);
  fireEvent.keyUp(document, { key: "Control" });
  fireEvent.keyDown(canvas, { key: "0" });
  flush();
  const xBefore = Number(canvas.dataset.cameraX),
    yBefore = Number(canvas.dataset.cameraY);
  fireEvent.wheel(canvas, {
    metaKey: true,
    deltaX: 100,
    deltaY: -10,
    clientX: 300,
    clientY: 300,
  });
  flush();
  zoom = Number(canvas.dataset.zoom);
  expect(zoom).toBeCloseTo(pinchFactor ** 2);
  expect(Number(canvas.dataset.cameraX)).toBe(xBefore);
  expect(Number(canvas.dataset.cameraY)).toBe(yBefore);
  const cacheBeforePan = Number(canvas.dataset.backgroundBuilds);
  fireEvent.wheel(canvas, { deltaX: 80, deltaY: 40 });
  flush();
  expect(Number(canvas.dataset.backgroundBuilds)).toBe(cacheBeforePan);
  fireEvent.wheel(canvas, { deltaX: 100, deltaY: 40 });
  flush();
  expect(Number(canvas.dataset.backgroundBuilds)).toBe(cacheBeforePan + 1);
  expect(commits).not.toHaveBeenCalled();
  const pointer = (type: string, id: number, x: number, y: number) => {
    const e = new MouseEvent(type, {
      clientX: x,
      clientY: y,
      button: 0,
      bubbles: true,
    });
    Object.defineProperties(e, {
      pointerId: { value: id },
      pointerType: { value: "touch" },
      timeStamp: { value: 100 },
    });
    fireEvent(canvas, e);
  };
  pointer("pointerdown", 1, 200, 300);
  pointer("pointerdown", 2, 400, 300);
  pointer("pointermove", 1, 180, 300);
  pointer("pointermove", 2, 420, 300);
  flush();
  const touchZoom = Number(canvas.dataset.zoom),
    x = Number(canvas.dataset.cameraX),
    y = Number(canvas.dataset.cameraY);
  expect(touchZoom / zoom).toBeCloseTo(1.2);
  pointer("pointermove", 1, 190, 310);
  pointer("pointermove", 2, 430, 310);
  flush();
  expect(Number(canvas.dataset.zoom)).toBeCloseTo(touchZoom);
  expect(Number(canvas.dataset.cameraX)).toBeCloseTo(
    x - 10 / (0.288 * touchZoom),
  );
  expect(Number(canvas.dataset.cameraY)).toBeCloseTo(
    y + 10 / (0.288 * touchZoom),
  );
  pointer("pointerup", 1, 190, 310);
  pointer("pointerup", 2, 430, 310);
});
