import { expect, it } from "vitest";
import {
  createVisionSolver,
  sampleVision,
  type VisionScene,
} from "@/domain/map/vision";

function flat(): VisionScene {
  return {
    bounds: { minX: 0, minY: 0, maxX: 512, maxY: 512 },
    trees: [{ id: "tree", x: 256, y: 256 }],
    terrain: {
      cell: 64,
      width: 8,
      height: 8,
      origin: { x: 0, y: 0 },
      values: Array(64).fill(0),
    },
  };
}
const source = { id: "a", x: 64, y: 256, radius: 400 };

it("keeps targets before a tree visible, blocks behind/tangent, and reveals after removal or a second source", () => {
  const scene = flat();
  const query = createVisionSolver(scene, [source]);
  expect(query({ x: 128, y: 256 }).status).toBe("visible");
  expect(query({ x: 400, y: 256 })).toMatchObject({
    status: "blocked",
    reason: "tree",
    obstacleId: "tree",
  });
  expect(query({ x: 64, y: 450 }).status).toBe("visible");
  expect(
    createVisionSolver(scene, [{ ...source, y: 192 }])({ x: 400, y: 192 })
      .status,
  ).toBe("blocked");
  expect(
    createVisionSolver(scene, [source], { removedTreeIds: ["tree"] })({
      x: 400,
      y: 256,
    }).status,
  ).toBe("visible");
  expect(
    createVisionSolver(scene, [
      source,
      { id: "b", x: 440, y: 256, radius: 100 },
    ])({ x: 400, y: 256 }),
  ).toEqual({ status: "visible", sourceId: "b" });
  expect(query({ x: 500, y: 256 }).status).toBe("out-of-range");
});

it("approximates low-to-high and intervening hills, while a high source sees downhill", () => {
  const scene = flat();
  scene.trees = [];
  for (let row = 0; row < 8; row++) scene.terrain!.values[row * 8 + 4] = 128;
  expect(createVisionSolver(scene, [source])({ x: 400, y: 256 })).toMatchObject(
    { status: "blocked", reason: "terrain" },
  );
  expect(
    createVisionSolver(scene, [{ ...source, x: 288 }])({ x: 64, y: 256 })
      .status,
  ).toBe("visible");
  scene.terrain!.values.fill(0);
  scene.terrain!.values[4 * 8 + 4] = 30;
  expect(createVisionSolver(scene, [source])({ x: 400, y: 256 }).status).toBe(
    "visible",
  );
});

it("preserves missing heights, combines uncertainty across sources, and handles boundaries", () => {
  const scene = flat();
  scene.terrain = null;
  const query = createVisionSolver(scene, [source]);
  expect(query(source)).toEqual({
    status: "unknown",
    reason: "missing-height",
  });
  expect(query({ x: 400, y: 256 }).status).toBe("blocked");
  expect(
    createVisionSolver(scene, [
      source,
      { id: "b", x: 440, y: 256, radius: 100 },
    ])({ x: 400, y: 256 }).status,
  ).toBe("unknown");
  expect(query({ x: 512, y: 256 })).toEqual({
    status: "unknown",
    reason: "outside-map",
  });
  const insideTree = createVisionSolver(flat(), [{ ...source, x: 256 }]);
  expect(insideTree({ x: 256, y: 256 }).status).toBe("visible");
  expect(insideTree({ x: 400, y: 256 }).status).toBe("visible");
});

it("samples increasing world Y, includes the radius boundary and rejects malformed scenarios", () => {
  const scene = flat();
  scene.trees = [];
  const query = createVisionSolver(scene, [
    { id: "a", x: 32, y: 32, radius: 64 },
  ]);
  expect(query({ x: 96, y: 32 }).status).toBe("visible");
  expect(
    Array.from(
      sampleVision(query, { minX: 0, maxX: 128, minY: 0, maxY: 128 }).cells,
    ),
  ).toEqual([1, 1, 1, 0]);
  expect(() =>
    createVisionSolver(scene, [source], { removedTreeIds: ["missing"] }),
  ).toThrow("Unknown removed tree");
  expect(() =>
    createVisionSolver(scene, [{ ...source, radius: NaN }]),
  ).toThrow();
  expect(() => createVisionSolver(scene, [source, source])).toThrow();
  expect(() => sampleVision(query, scene.bounds, 0)).toThrow();
});
