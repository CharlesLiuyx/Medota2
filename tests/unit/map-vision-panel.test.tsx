// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/i18n/provider";
import {
  VisionPanel,
  useVisionPlanner,
  drawVision,
  visionTexture,
} from "@/components/map/vision-panel";
import type { MapViewData, MapPoint } from "@/domain/map/schema";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
import { visionPresets } from "../fixtures/map-vision-presets";
const tree: MapPoint = {
  id: "tree",
  x: 256,
  y: 256,
  z: 0,
  kind: "tree",
  label: "树木",
  team: "neutral",
  sourceClass: "tree",
  sourcePath: "fixture",
  properties: {},
};
const data: MapViewData = {
  visionPresets,
  bounds: { minX: 0, maxX: 512, minY: 0, maxY: 512 },
  points: [tree],
  imageUrl: null,
  clientVersion: "fixture",
  coverage: null,
  visions: { tree: { day: 400, night: 100, unitName: "fixture" } },
  visionScene: {
    datasetRevision: "a",
    scene: {
      bounds: { minX: 0, maxX: 512, minY: 0, maxY: 512 },
      trees: [tree],
      terrain: {
        cell: 64,
        width: 8,
        height: 8,
        origin: { x: 0, y: 0 },
        values: Array(64).fill(0),
      },
    },
  },
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("runs the tree explanation journey, switches night, unions sources and resets on version remount", async () => {
  vi.stubGlobal("Worker", undefined);
  const hook = renderHook(() => useVisionPlanner(data));
  act(() => hook.result.current.toggle());
  act(() => hook.result.current.add({ x: 64, y: 256 }, tree));
  await waitFor(() => expect(hook.result.current.status).toBe("done"));
  act(() => hook.result.current.setTool("query"));
  act(() => hook.result.current.pick({ x: 400, y: 256 }, null));
  expect(hook.result.current.result).toMatchObject({
    status: "blocked",
    reason: "tree",
  });
  act(() => hook.result.current.setTool("tree"));
  act(() => hook.result.current.pick(tree, tree));
  expect(hook.result.current.samples).toBeUndefined();
  expect(hook.result.current.result?.status).toBe("visible");
  act(() => hook.result.current.restore());
  expect(hook.result.current.result?.status).toBe("blocked");
  act(() => hook.result.current.setNight(true));
  expect(hook.result.current.result?.status).toBe("out-of-range");
  act(() => hook.result.current.add({ x: 440, y: 256 }));
  expect(hook.result.current.result?.status).toBe("visible");
  act(() => hook.result.current.cancel());
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(hook.result.current.status).toBe("cancelled");
  expect(hook.result.current.samples).toBeUndefined();
  act(() => hook.result.current.retry());
  await waitFor(() => expect(hook.result.current.status).toBe("done"));
  hook.unmount();
  const other = renderHook(() =>
    useVisionPlanner({
      ...data,
      visionScene: {
        datasetRevision: "b",
        scene: { ...data.visionScene!.scene, terrain: null },
      },
    }),
  );
  expect(other.result.current.sources).toEqual([]);
  expect(other.result.current.removed).toEqual([]);
  act(() => {
    other.result.current.toggle();
    other.result.current.add({ x: 32, y: 32 });
  });
  act(() => other.result.current.setTool("query"));
  act(() => other.result.current.pick({ x: 32, y: 32 }, null));
  expect(other.result.current.result).toEqual({
    status: "unknown",
    reason: "missing-height",
  });
});
it("exposes translated source controls, preset values and cancellation in English", async () => {
  vi.stubGlobal("Worker", undefined);
  function Panel() {
    const planner = useVisionPlanner(data);
    return (
      <>
        <button onClick={planner.toggle}>toggle</button>
        <VisionPanel
          planner={planner}
          selected={tree}
          data={data}
          activate={() => {}}
        />
      </>
    );
  }
  render(
    <LocaleProvider initialLocale="en">
      <Panel />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByText("toggle"));
  fireEvent.click(screen.getByRole("button", { name: "Add selected object" }));
  expect(screen.getByText("Ground Z: 0")).toBeTruthy();
  expect(
    (
      screen.getByRole("spinbutton", {
        name: "Source 1 day radius",
      }) as HTMLInputElement
    ).value,
  ).toBe("400");
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Source 1 night radius" }),
    { target: { value: "0" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Night" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel vision calculation" }),
  );
  await waitFor(() =>
    expect(screen.getByText("Vision calculation cancelled")).toBeTruthy(),
  );
  expect(
    screen.getByRole("region", { name: "Vision simulation" }).textContent,
  ).not.toMatch(/\p{Script=Han}/u);
});

it("continuously places sources and keeps live previews and opposing teams independent", async () => {
  vi.stubGlobal("Worker", undefined);
  const { result } = renderHook(() => useVisionPlanner(data));
  act(() => result.current.toggle());
  expect(result.current.tool).toBe("add");
  act(() =>
    result.current.setPreview({ id: "cursor", position: { x: 32, y: 32 } }),
  );
  await waitFor(() => expect(result.current.samples).toBeDefined());
  expect(result.current.sources).toHaveLength(0);
  act(() => result.current.pick({ x: 32, y: 32 }, null));
  act(() => result.current.pick({ x: 32, y: 96 }, null));
  expect(result.current.sources).toHaveLength(2);
  expect(result.current.tool).toBe("add");
  act(() =>
    result.current.sources.forEach((s) =>
      result.current.update(s.id, { day: 64 }),
    ),
  );
  act(() => result.current.setMode("dire"));
  expect(result.current.samples).toBeUndefined();
  expect(result.current.visibleSources).toHaveLength(0);
  act(() => result.current.pick({ x: 448, y: 448 }, null));
  act(() => result.current.update(result.current.sources[2].id, { day: 64 }));
  act(() => result.current.setMode("both"));
  await waitFor(() => expect(result.current.status).toBe("done"));
  const before = result.current.grids!;
  expect(before.radiant!.cells[0]).toBe(1);
  expect(before.dire!.cells[0]).toBe(0);
  expect(before.dire!.cells[63]).toBe(1);
  expect(before.radiant!.cells[63]).toBe(0);
  act(() => result.current.beginDrag());
  act(() =>
    result.current.setPreview({
      id: result.current.sources[0].id,
      position: { x: 448, y: 64 },
    }),
  );
  await waitFor(() => expect(result.current.grids?.radiant?.cells[7]).toBe(1));
  expect(result.current.sources[0].x).toBe(32);
  expect(result.current.grids!.dire!.cells).toEqual(before.dire!.cells);
  act(() => result.current.endDrag(result.current.sources[0].id));
  await waitFor(() => expect(result.current.grids?.radiant?.cells[7]).toBe(0));
});

it("switches from add to selection, snaps drag positions, and previews Sentry detection without adding vision", async () => {
  vi.stubGlobal("Worker", undefined);
  const { result } = renderHook(() => useVisionPlanner(data));
  act(() => result.current.toggle());
  expect(result.current.placementKind).toBe("observer");
  act(() => result.current.pick({ x: 65, y: 65 }, null));
  expect(result.current.sources[0]).toMatchObject({
    kind: "observer",
    x: 96,
    y: 96,
    day: 1600,
    night: 1600,
  });
  act(() => result.current.stop());
  act(() => result.current.selectSource(result.current.sources[0].id));
  expect(result.current.tool).toBeNull();
  act(() =>
    result.current.endDrag(result.current.sources[0].id, { x: 130, y: 150 }),
  );
  expect(result.current.sources[0]).toMatchObject({ x: 160, y: 160 });
  act(() => result.current.setMode("dire"));
  act(() => result.current.setPlacementKind("sentry"));
  act(() =>
    result.current.setPreview({ id: "cursor", position: { x: 224, y: 224 } }),
  );
  await waitFor(() => expect(result.current.status).toBe("done"));
  expect(result.current.detectionIds.has(result.current.sources[0].id)).toBe(
    true,
  );
  expect(result.current.grids?.dire).toBeUndefined();
  act(() => result.current.pick({ x: 224, y: 224 }, null));
  expect(result.current.sources[1]).toMatchObject({
    kind: "sentry",
    day: 0,
    night: 0,
    detection: 1050,
  });
  act(() => result.current.setTool("query"));
  act(() => result.current.pick({ x: 224, y: 224 }, null));
  expect(result.current.result?.status).toBe("out-of-range");
  act(() => result.current.setPlacementKind("hero"));
  expect(result.current.heroKey).toBe("npc_dota_hero_axe");
  act(() => result.current.setHeroKey("npc_dota_hero_night_stalker"));
  act(() => result.current.pick({ x: 320, y: 320 }, null));
  expect(result.current.sources[2]).toMatchObject({
    kind: "hero",
    day: 800,
    night: 1800,
  });
  act(() => result.current.remove(result.current.sources[1].id));
  expect(result.current.detectionIds.size).toBe(0);
});

it("searches the hero dropdown in either language and uses the chosen preset", () => {
  vi.stubGlobal("Worker", undefined);
  function Panel() {
    const p = useVisionPlanner(data);
    return (
      <>
        <button onClick={p.toggle}>toggle</button>
        <button onClick={() => p.pick({ x: 32, y: 32 }, null)}>place</button>
        <VisionPanel
          planner={p}
          selected={null}
          data={data}
          activate={() => {}}
        />
      </>
    );
  }
  render(
    <LocaleProvider initialLocale="en">
      <Panel />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByText("toggle"));
  fireEvent.click(screen.getByRole("button", { name: "Heroes" }));
  expect(
    screen.getByRole("button", { name: "Choose hero" }).textContent,
  ).toContain("Axe");
  fireEvent.click(screen.getByRole("button", { name: "Choose hero" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search heroes" }), {
    target: { value: "暗夜" },
  });
  fireEvent.click(screen.getByRole("option", { name: "Night Stalker" }));
  fireEvent.click(screen.getByText("place"));
  expect(
    (
      screen.getByRole("spinbutton", {
        name: "Source 1 day radius",
      }) as HTMLInputElement
    ).value,
  ).toBe("800");
  expect(
    (
      screen.getByRole("spinbutton", {
        name: "Source 1 night radius",
      }) as HTMLInputElement
    ).value,
  ).toBe("1800");
});

it("shows a bare placement footprint, then native artwork within the hero's world-space hull", () => {
  vi.stubGlobal("Worker", undefined);
  const icon = { naturalWidth: 32, naturalHeight: 32 } as HTMLImageElement;
  const payload = {
    ...data,
    visionPresets: {
      ...visionPresets,
      presets: visionPresets.presets.map((p) => ({
        ...p,
        imageUrl: "/icon.png",
      })),
    },
  };
  const hook = renderHook(() => useVisionPlanner(payload));
  const image = vi.fn(),
    arc = vi.fn(),
    box = vi.fn();
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === "drawImage"
          ? image
          : key === "arc"
            ? arc
            : key === "strokeRect"
              ? box
              : () => {},
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  const paint = () =>
    drawVision(
      context,
      { ...hook.result.current, images: { "/icon.png": icon } },
      null,
      (p) => ({ x: p.x * 2, y: p.y * 2 }),
      payload,
    );
  act(() => hook.result.current.toggle());
  act(() =>
    hook.result.current.setPreview({
      id: "cursor",
      position: { x: 48, y: 49 },
    }),
  );
  paint();
  expect(image).not.toHaveBeenCalled();
  expect(box).toHaveBeenCalledWith(0, 128, 128, -128); // Exact world cell, no icon frame.
  act(() => hook.result.current.pick({ x: 48, y: 49 }, null));
  act(() => hook.result.current.setPreview(null));
  paint();
  expect(image).toHaveBeenCalled();
  act(() => hook.result.current.remove(hook.result.current.sources[0].id));
  act(() => hook.result.current.setPlacementKind("hero"));
  act(() =>
    hook.result.current.setPreview({
      id: "cursor",
      position: { x: 48, y: 49 },
    }),
  );
  image.mockClear();
  box.mockClear();
  arc.mockClear();
  paint();
  expect(image).not.toHaveBeenCalled();
  expect(box).not.toHaveBeenCalled();
  expect(arc).toHaveBeenCalledWith(64, 64, 54, 0, Math.PI * 2); // 27 world units at 2 px/unit.
  act(() => hook.result.current.pick({ x: 48, y: 49 }, null));
  act(() => hook.result.current.setPreview(null));
  paint();
  expect(image).toHaveBeenLastCalledWith(icon, 10, 10, 108, 108);
  expect(box).not.toHaveBeenCalled();
  act(() => hook.result.current.setTool("query"));
  act(() => hook.result.current.pick({ x: 48, y: 49 }, null));
  expect(hook.result.current.target).toEqual({ x: 32, y: 32 });
});

it("crops both teams to their occupied rectangle and preserves pixel orientation and world coordinates", () => {
  const pixels = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
  const image = vi.fn();
  const context = new Proxy(
    {
      createImageData: vi.fn(() => pixels),
      putImageData: vi.fn(),
      drawImage: image,
    },
    {
      get: (target, key) => Reflect.get(target, key) ?? (() => {}),
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  const base = {
    algorithm: "approx-ground-vision/2",
    bounds: { minX: 0, minY: 0, maxX: 256, maxY: 192 },
    cell: 64,
    width: 4,
    height: 3,
  };
  const radiant = {
    ...base,
    cells: new Uint8Array(12),
    extent: { col: 1, row: 1, endCol: 1, endRow: 1 },
  };
  const dire = {
    ...base,
    cells: new Uint8Array(12),
    extent: { col: 2, row: 2, endCol: 2, endRow: 2 },
  };
  radiant.cells[5] = 1;
  dire.cells[10] = 1;
  const texture = visionTexture({ radiant, dire })!;
  expect([
    texture.canvas.width,
    texture.canvas.height,
    texture.col,
    texture.row,
  ]).toEqual([2, 2, 1, 1]);
  expect([...pixels.data]).toEqual([
    0, 0, 0, 0, 244, 114, 182, 110, 52, 211, 153, 110, 0, 0, 0, 0,
  ]);
  const hook = renderHook(() => useVisionPlanner(data));
  drawVision(
    context,
    { ...hook.result.current, enabled: true, samples: radiant },
    texture,
    (p) => ({ x: p.x * 2, y: 512 - p.y * 2 }),
    data,
  );
  expect(image).toHaveBeenCalledWith(texture.canvas, 128, 128, 256, 256);
});
