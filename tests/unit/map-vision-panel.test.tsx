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
  visionHeroIconSize,
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
  const row = screen
    .getByRole("button", { name: /^Source 1 ·/ })
    .closest("li")!;
  expect(row.getAttribute("data-selected")).toBe("true");
  expect(row.querySelectorAll('input[type="number"]')).toHaveLength(2);
  const status = document.querySelector("[data-vision-status]")!;
  expect(status.tagName).toBe("SPAN");
  expect(status.querySelector("button svg")).toBeTruthy();
  expect(status.querySelector(".sr-only")).toBeTruthy();
  expect(screen.queryByText("Ground Z: 0")).toBeNull();
  fireEvent.focus(screen.getByRole("button", { name: /^Source 1 ·/ }));
  expect(screen.getByRole("tooltip").textContent).toContain("Ground Z: 0");
  for (const name of ["Move source", "Remove source"]) {
    const action = screen.getByRole("button", { name });
    expect(action.querySelector("svg")).toBeTruthy();
    expect(action.textContent).toBe("");
  }
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
  act(() => result.current.setPlacementKind("sentry"));
  act(() =>
    result.current.setPreview({ id: "cursor", position: { x: 224, y: 224 } }),
  );
  expect(result.current.sentryRangeIds.has(result.current.sources[0].id)).toBe(
    true,
  );
  expect(result.current.detectionIds.size).toBe(0);
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

it("searches heroes in either language and replaces the selected source's hero", () => {
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
  const observer = screen.getByRole("button", { name: "Observer Ward" });
  expect(observer.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(observer);
  expect(observer.getAttribute("aria-pressed")).toBe("false");
  expect(
    screen
      .getByRole("button", { name: "Select mode" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByText("place"));
  expect(
    screen.queryByRole("spinbutton", { name: "Source 1 day radius" }),
  ).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: "Select mode" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose hero" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search heroes" }), {
    target: { value: "Axe" },
  });
  fireEvent.click(screen.getByRole("option", { name: "Axe" }));
  expect(
    screen.getByRole("spinbutton", { name: "Source 1 day radius" }),
  ).toHaveProperty("value", "1800");
  expect(
    screen.getByRole("spinbutton", { name: "Source 1 night radius" }),
  ).toHaveProperty("value", "800");
});

it("replaces only the selected hero in select mode and keeps placement presets separate", () => {
  vi.stubGlobal("Worker", undefined);
  const payload = {
    ...data,
    visionPresets: {
      ...visionPresets,
      presets: visionPresets.presets.map((p) => ({
        ...p,
        imageUrl: `/${p.key}.png`,
      })),
    },
  };
  const { result } = renderHook(() => useVisionPlanner(payload));
  act(() => result.current.toggle());
  act(() => result.current.setPlacementKind("hero"));
  act(() => result.current.pick({ x: 32, y: 32 }, null));
  const first = result.current.sources[0];
  act(() => result.current.setHeroKey("npc_dota_hero_night_stalker"));
  expect(result.current.sources[0]).toEqual(first); // Add mode changes only the next placement.
  act(() => result.current.pick({ x: 352, y: 352 }, null));
  const second = result.current.sources[1];
  act(() => result.current.selectSource(first.id));
  expect(result.current.heroKey).toBe("npc_dota_hero_axe");
  act(() => result.current.setHeroKey("npc_dota_hero_night_stalker"));
  expect(result.current.sources[0]).toEqual({
    ...first,
    presetKey: "npc_dota_hero_night_stalker",
    day: 800,
    night: 1800,
  });
  expect(result.current.sources[1]).toBe(second);
  expect(result.current.selectedSource).toBe(first.id);
  expect(result.current.tool).toBeNull();
  const drawImage = vi.fn();
  const context = new Proxy(
    {},
    {
      get: (_, key) => (key === "drawImage" ? drawImage : () => {}),
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  const axe = { naturalWidth: 32, naturalHeight: 32 } as HTMLImageElement;
  const night = { naturalWidth: 32, naturalHeight: 32 } as HTMLImageElement;
  drawVision(
    context,
    {
      ...result.current,
      images: {
        "/npc_dota_hero_axe.png": axe,
        "/npc_dota_hero_night_stalker.png": night,
      },
    },
    null,
    (p) => p,
    payload,
  );
  expect(drawImage.mock.calls.map((c) => c[0])).toEqual([night, night]);
  act(() => result.current.update(first.id, { night: 1200 }));
  act(() => result.current.setHeroKey("npc_dota_hero_night_stalker"));
  expect(result.current.sources[0].night).toBe(1200); // Re-selecting the same hero preserves scenario edits.
  act(() => result.current.setTool("add"));
  act(() => result.current.setHeroKey("npc_dota_hero_axe"));
  expect(result.current.sources[0].presetKey).toBe(
    "npc_dota_hero_night_stalker",
  );
  act(() => result.current.stop());
  expect(result.current.heroKey).toBe("npc_dota_hero_night_stalker");
  act(() => result.current.setMode("dire"));
  act(() => result.current.setHeroKey("npc_dota_hero_axe"));
  expect(result.current.sources[0].presetKey).toBe(
    "npc_dota_hero_night_stalker",
  ); // Hidden sources are not edited.
});

it.each([27, 43])(
  "fills the hero's occupied grid bounds at world scale (hull %i)",
  (hull) => {
    vi.stubGlobal("Worker", undefined);
    const icon = { naturalWidth: 32, naturalHeight: 32 } as HTMLImageElement;
    const payload = {
      ...data,
      visionPresets: {
        ...visionPresets,
        presets: visionPresets.presets.map((p) => ({
          ...p,
          imageUrl: "/icon.png",
          ...(p.kind !== "hero"
            ? { imageAnchor: [0.5, 1] as [number, number] }
            : {}),
          ...(p.kind === "hero" ? { collisionRadius: hull } : {}),
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
    const paint = (hoveredHeroId?: string) =>
      drawVision(
        context,
        { ...hook.result.current, images: { "/icon.png": icon } },
        null,
        (p) => ({ x: p.x * 2, y: p.y * 2 }),
        payload,
        undefined,
        hoveredHeroId,
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
    expect(image).toHaveBeenLastCalledWith(icon, 0, -64, 128, 128);
    for (const kind of ["observer", "sentry"] as const) {
      if (kind === "sentry") {
        act(() =>
          hook.result.current.remove(hook.result.current.sources[0].id),
        );
        act(() => hook.result.current.setPlacementKind(kind));
        act(() => hook.result.current.pick({ x: 48, y: 49 }, null));
      }
      paint(hook.result.current.sources[0].id);
      expect(image).toHaveBeenLastCalledWith(
        icon,
        64 - 204.8 / 2,
        64 - 204.8,
        204.8,
        204.8,
      );
      paint();
      expect(image).toHaveBeenLastCalledWith(icon, 0, -64, 128, 128);
    }
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
    expect(box).toHaveBeenCalledTimes(hull === 27 ? 1 : 5);
    expect(arc).not.toHaveBeenCalled();
    box.mockClear();
    act(() => hook.result.current.pick({ x: 48, y: 49 }, null));
    act(() => hook.result.current.setPreview(null));
    paint();
    const start = hull === 27 ? 0 : -128;
    const size = hull === 27 ? 128 : 384;
    expect(image).toHaveBeenLastCalledWith(icon, start, start, size, size);
    expect(box).toHaveBeenCalledTimes(1); // Selected grid boundary remains visible above the icon.
    expect(box).toHaveBeenLastCalledWith(start, start + size, size, -size);
    paint(hook.result.current.sources[0].id);
    const enlarged = size * 1.6;
    expect(image).toHaveBeenLastCalledWith(
      icon,
      64 - enlarged / 2,
      64 - enlarged / 2,
      enlarged,
      enlarged,
    );
    paint();
    expect(image).toHaveBeenLastCalledWith(icon, start, start, size, size);
    expect(visionHeroIconSize(3, true)).toBe(32); // Still legible at the full-map scale.
    act(() => hook.result.current.setTool("query"));
    act(() => hook.result.current.pick({ x: 48, y: 49 }, null));
    expect(hook.result.current.target).toEqual({ x: 32, y: 32 });
  },
);

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
    0, 0, 0, 0, 244, 114, 182, 110, 46, 255, 136, 160, 0, 0, 0, 0,
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

it.each(["observer", "sentry", "hero"] as const)(
  "rejects illegal %s placement, preview and both move paths without changing the source",
  (kind) => {
    vi.stubGlobal("Worker", undefined);
    const hook = renderHook(() =>
      useVisionPlanner({
        ...data,
        routing: {
          revision: "fixture",
          gate: null,
          grid: {
            x: 0,
            y: 0,
            cell: 64,
            width: 8,
            height: 8,
            walkable: "1".repeat(64),
            noWard: "01" + "0".repeat(62),
            wardable: "10" + "1".repeat(62),
          },
        },
      }),
    );
    const bad = { x: 100, y: 40 },
      good = { x: 20, y: 40 };
    act(() => hook.result.current.toggle());
    act(() => hook.result.current.setPlacementKind(kind));
    act(() => hook.result.current.setPreview({ id: "cursor", position: bad }));
    expect(hook.result.current.placementError).toBe("no-ward");
    expect(hook.result.current.preview).toBeNull();
    expect(hook.result.current.effectiveSources).toEqual([]);
    act(() => hook.result.current.pick(bad, null));
    expect(hook.result.current.sources).toEqual([]);
    expect(hook.result.current.invalidPreview?.position).toEqual(bad);
    act(() => hook.result.current.pick(good, null));
    const original = hook.result.current.sources[0];
    expect(original).toMatchObject({ id: "source-1", x: 32, y: 32 });
    expect(hook.result.current.placementError).toBeNull();
    act(() => hook.result.current.selectSource(original.id));
    act(() => hook.result.current.beginDrag());
    act(() =>
      hook.result.current.setPreview({ id: original.id, position: bad }),
    );
    expect(hook.result.current.effectiveSources).toEqual([original]);
    act(() => hook.result.current.endDrag(original.id, bad));
    expect(hook.result.current.sources).toEqual([original]);
    expect(hook.result.current.dragging).toBe(false);
    expect(hook.result.current.placementError).toBe("no-ward");
    act(() => hook.result.current.endDrag(original.id, { x: -1, y: 32 }));
    expect(hook.result.current.sources).toEqual([original]);
    act(() => hook.result.current.setTool(original.id));
    act(() => hook.result.current.pick(bad, null));
    expect(hook.result.current.tool).toBe(original.id);
    expect(hook.result.current.sources).toEqual([original]);
    act(() => hook.result.current.pick({ x: 150, y: 40 }, null));
    expect(hook.result.current.sources[0]).toMatchObject({
      id: original.id,
      x: 160,
      y: 32,
    });
    expect(hook.result.current.tool).toBeNull();
    expect(hook.result.current.placementError).toBeNull();
  },
);

it("toggles multiple sources without changing their values and deletes only visible selected sources", () => {
  vi.stubGlobal("Worker", undefined);
  const { result } = renderHook(() => useVisionPlanner(data));
  act(() => result.current.toggle());
  act(() => result.current.add({ x: 32, y: 32 }));
  act(() => result.current.add({ x: 224, y: 224 }));
  const [first, second] = result.current.sources;
  act(() => result.current.setMode("dire"));
  act(() => result.current.add({ x: 416, y: 416 }));
  const third = result.current.sources[2];
  act(() => result.current.setMode("both"));
  act(() => result.current.selectSource(first.id));
  act(() => result.current.selectSource(second.id, true));
  act(() => result.current.selectSource(third.id, true));
  expect(result.current.selectedSources).toEqual([
    first.id,
    second.id,
    third.id,
  ]);
  expect(result.current.selectedSource).toBeNull();
  expect(result.current.sources).toEqual([first, second, third]);
  act(() => result.current.selectSource(second.id, true));
  expect(result.current.selectedSources).toEqual([first.id, third.id]);
  act(() => result.current.setMode("radiant"));
  act(() => result.current.removeSelected());
  expect(result.current.sources).toEqual([second, third]);
  expect(result.current.selectedSources).toEqual([third.id]);
  act(() => result.current.selectSource(null));
  act(() => result.current.removeSelected());
  expect(result.current.sources).toEqual([second, third]);
  act(() => result.current.setMode("both"));
  act(() => result.current.selectSource(second.id));
  act(() => result.current.selectSource(third.id, true));
  act(() => result.current.removeSelected());
  expect(result.current.sources).toEqual([]);
  expect(result.current.selectedSources).toEqual([]);

  // A revealed enemy observer is visibly selectable in the sentry team's view.
  act(() => result.current.setMode("radiant"));
  act(() => result.current.add({ x: 32, y: 32 }));
  const observer = result.current.sources[0];
  act(() => result.current.setMode("dire"));
  act(() => result.current.setPlacementKind("sentry"));
  act(() => result.current.add({ x: 224, y: 224 }));
  const sentry = result.current.sources[1];
  expect(result.current.visibleSources).toHaveLength(2);
  act(() => result.current.selectSource(observer.id));
  act(() => result.current.selectSource(sentry.id, true));
  act(() => result.current.removeSelected());
  expect(result.current.sources).toEqual([]);
});
