import { expect, it } from "vitest";
import {
  visionPlacementIssue,
  detectedObservers,
  observersInSentryRange,
  heroVisionFootprint,
  snapVisionPosition,
  type PlacedVisionSource,
} from "@/domain/map/vision-sources";
it("uses the hero hull's occupied native cells, including larger hulls and shifted origins", () => {
  const grid = { minX: -128, minY: -128, maxX: 128, maxY: 128 };
  expect(heroVisionFootprint({ x: 32, y: 32 }, 27, grid)).toEqual({
    bounds: { minX: 0, minY: 0, maxX: 64, maxY: 64 },
    cells: [{ minX: 0, minY: 0, maxX: 64, maxY: 64 }],
  });
  const large = heroVisionFootprint({ x: -96, y: -96 }, 43, grid)!;
  expect(large.bounds).toEqual({ minX: -192, minY: -192, maxX: 0, maxY: 0 });
  expect(large.cells).toHaveLength(5); // Center and four neighbors; diagonal cells are outside the circle.
  expect(heroVisionFootprint({ x: 32, y: 32 }, 32, grid)?.cells).toHaveLength(
    1,
  );
  const shifted = { ...grid, minX: -100, minY: -100 };
  expect(heroVisionFootprint({ x: -68, y: -68 }, 27, shifted)?.bounds).toEqual({
    minX: -100,
    minY: -100,
    maxX: -36,
    maxY: -36,
  });
  expect(heroVisionFootprint({ x: 0, y: 0 }, null, grid)).toBeNull();
  expect(heroVisionFootprint({ x: 0, y: 0 }, NaN, grid)).toBeNull();
});

it("snaps positive/negative positions and partial boundary cells to the coverage grid", () => {
  const bounds = { minX: -100, maxX: 90, minY: -100, maxY: 90 };
  expect(snapVisionPosition({ x: -99, y: -36 }, bounds)).toEqual({
    x: -68,
    y: -4,
  });
  expect(snapVisionPosition({ x: 200, y: -200 }, bounds)).toEqual({
    x: 59,
    y: -68,
  });
  const nativeBounds = { minX: -128, minY: -128, maxX: 128, maxY: 128 };
  expect(snapVisionPosition({ x: 20, y: 20 }, bounds, nativeBounds)).toEqual({
    x: 32,
    y: 32,
  });
  expect(snapVisionPosition({ x: 99, y: -200 }, bounds, nativeBounds)).toEqual({
    x: 32,
    y: -96,
  });
  expect(snapVisionPosition({ x: 20, y: 20 }, bounds)).toEqual(
    snapVisionPosition({ x: -30, y: -30 }, bounds),
  );
});
it("highlights only enemy Observer Wards within a displayed Sentry's inclusive range", () => {
  const ward: PlacedVisionSource = {
    id: "s",
    x: 0,
    y: 0,
    kind: "sentry",
    presetKey: "sentry",
    team: "radiant",
    day: 0,
    night: 0,
    detection: 1050,
  };
  const observer: PlacedVisionSource = {
    ...ward,
    id: "o",
    kind: "observer",
    team: "dire",
    x: 1050,
  };
  expect([...detectedObservers([ward, observer], ["radiant"])]).toEqual(["o"]);
  expect(
    detectedObservers([ward, { ...observer, x: 1050.01 }], ["radiant"]).size,
  ).toBe(0);
  expect(
    detectedObservers([ward, { ...observer, team: "radiant" }], ["radiant"])
      .size,
  ).toBe(0);
  expect(
    detectedObservers([ward, { ...observer, kind: "hero" }], ["radiant"]).size,
  ).toBe(0);
  expect(detectedObservers([ward, observer], ["dire"]).size).toBe(0);
  const allied = { ...observer, team: "radiant" as const };
  expect([...observersInSentryRange([ward, allied], ["radiant"])]).toEqual([
    "o",
  ]);
  expect(
    observersInSentryRange([ward, { ...allied, x: 1050.01 }], ["radiant"]).size,
  ).toBe(0);
  expect(observersInSentryRange([allied], ["radiant"]).size).toBe(0);
});

it("rejects prohibited, unknown and out-of-bounds cells while retaining ward cliffs", () => {
  const bounds = { minX: -128, minY: -64, maxX: 128, maxY: 0 };
  const grid = {
    x: -128,
    y: -64,
    width: 4,
    height: 1,
    cell: 64,
    walkable: "1100",
    noWard: "0100",
    wardable: "1010",
  };
  const point = (col: number) => ({ x: -96 + col * 64, y: -32 });
  for (const kind of ["observer", "sentry", "hero"] as const) {
    expect(visionPlacementIssue(point(0), bounds, grid, kind)).toBeNull();
    expect(visionPlacementIssue(point(1), bounds, grid, kind)).toBe("no-ward");
    expect(visionPlacementIssue(point(3), bounds, grid, kind)).toBe("unknown");
    expect(visionPlacementIssue({ x: 128, y: -32 }, bounds, grid, kind)).toBe(
      "outside",
    );
  }
  expect(visionPlacementIssue(point(2), bounds, grid, "observer")).toBeNull();
  expect(visionPlacementIssue(point(2), bounds, grid, "sentry")).toBeNull();
  expect(visionPlacementIssue(point(2), bounds, grid, "hero")).toBe("blocked");
  expect(visionPlacementIssue({ x: NaN, y: -32 }, bounds, grid, "hero")).toBe(
    "outside",
  );
  expect(visionPlacementIssue(point(0), bounds, null, "observer")).toBeNull();
});
