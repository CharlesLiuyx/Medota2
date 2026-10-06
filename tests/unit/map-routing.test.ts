import { expect, it } from "vitest";
import {
  calculateRoutes,
  nearbyRoutes,
  obstacleCells,
  routeKey,
  calculateRoutesAsync,
  clearSegment,
  groundPath,
  pathLength,
  routePosition,
  withTrees,
  treeCells,
  type NavGrid,
} from "@/domain/map/routing";

it("routes around walls through a gap and never cuts blocked corners", () => {
  const g: NavGrid = {
    cell: 64,
    width: 5,
    height: 5,
    x: 0,
    y: 0,
    walkable: ["11011", "11011", "11011", "11111", "11011"].join(""),
  };
  const a = { x: 32, y: 32 },
    b = { x: 288, y: 32 };
  const path = groundPath(g, a, b)!;
  expect(pathLength(path)).toBeGreaterThan(256);
  expect(path[0]).toEqual(a);
  expect(path.at(-1)).toEqual(b);
  expect(path.slice(1).every((p, i) => clearSegment(g, path[i], p))).toBe(true);
  const corner = { ...g, width: 2, height: 2, walkable: "1001" };
  expect(groundPath(corner, { x: 32, y: 32 }, { x: 96, y: 96 })).toBeNull();
  expect(clearSegment(corner, { x: 32, y: 32 }, { x: 96, y: 96 })).toBe(false);
  expect(groundPath(g, { x: -1, y: 32 }, b)).toBeNull();
});

it("compares direct and gate travel, includes channel time and simulates a paused gate jump", () => {
  const args = {
    grid: null,
    gate: { channel: 4, castRange: 200 },
    gates: [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
    ],
    start: { x: 0, y: 0 },
    end: { x: 3000, y: 0 },
    speed: 300,
    flying: true,
  };
  const r = calculateRoutes(args);
  expect(r.routes.map((r) => [r.kind, r.seconds])).toEqual([
    ["gate", 4],
    ["direct", 10],
  ]);
  expect(r.close).toBe(false);
  expect(routePosition(r.routes[0], 2, 300)).toEqual({
    position: args.start,
    channeling: true,
  });
  expect(routePosition(r.routes[0], 4, 300)).toEqual({
    position: args.end,
    channeling: false,
  });
  expect(calculateRoutes({ ...args, speed: 600 }).close).toBe(true);
  expect(calculateRoutes({ ...args, speed: 0 }).routes).toHaveLength(0);
  expect(calculateRoutes({ ...args, gate: null }).routes).toHaveLength(1);
  expect(calculateRoutes({ ...args, flying: false }).error).toContain("未收录");
  expect(calculateRoutes({ ...args, end: args.start }).routes[0].seconds).toBe(
    0,
  );
});

it("uses the same fully filled tree cells for drawing and ground blockers; flight ignores them", () => {
  const grid: NavGrid = {
    cell: 64,
    width: 4,
    height: 4,
    x: 0,
    y: 0,
    walkable: "1".repeat(16),
  };
  const trees = [{ x: 128, y: 128 }],
    cells = treeCells(grid, trees),
    blocked = withTrees(grid, trees);
  expect(cells.sort((a, b) => a - b)).toEqual([5, 6, 9, 10]);
  expect(
    [...blocked.walkable].flatMap((v, i) => (v === "0" ? [i] : [])),
  ).toEqual([5, 6, 9, 10]);
  const args = {
    grid: blocked,
    gate: null,
    gates: [],
    start: { x: 96, y: 96 },
    end: { x: 224, y: 224 },
    speed: 320,
    flying: false,
  };
  expect(calculateRoutes(args).error).toContain("阻挡");
  expect(
    calculateRoutes({ ...args, flying: true }).routes[0].seconds,
  ).toBeCloseTo(Math.hypot(128, 128) / 320);
});

// Independent O(V²) Dijkstra oracle for the eight-neighbor, no-corner-cut graph.
it("matches a shortest-distance oracle across walls and disconnected regions", () => {
  for (let seed = 0; seed < 12; seed++) {
    const width = 9,
      n = 81,
      walkable = Array.from({ length: n }, (_, i) =>
        i === 0 || i === n - 1 || (i * 37 + seed * 11) % 17 > 3 ? "1" : "0",
      ).join("");
    const grid = { cell: 64, width, height: 9, x: 0, y: 0, walkable };
    const cost = Array(n).fill(Infinity),
      closed = new Set<number>();
    cost[0] = 0;
    for (let k = 0; k < n; k++) {
      let u = -1;
      for (let i = 0; i < n; i++)
        if (!closed.has(i) && (u < 0 || cost[i] < cost[u])) u = i;
      if (u < 0 || !Number.isFinite(cost[u])) break;
      closed.add(u);
      const x = u % width,
        y = Math.floor(u / width);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(8, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(8, x + 1); xx++) {
          const v = yy * width + xx;
          if (
            walkable[v] !== "1" ||
            (xx !== x &&
              yy !== y &&
              (walkable[y * width + xx] !== "1" ||
                walkable[yy * width + x] !== "1"))
          )
            continue;
          cost[v] = Math.min(
            cost[v],
            cost[u] + Math.hypot(xx - x, yy - y) * 64,
          );
        }
    }
    const path = groundPath(grid, { x: 32, y: 32 }, { x: 544, y: 544 });
    if (Number.isFinite(cost[n - 1]))
      expect(pathLength(path!)).toBeCloseTo(cost[n - 1], 7);
    else expect(path).toBeNull();
  }
});
it("uses directed current travel times, can detour for a faster stream, and keeps animation in time", () => {
  const grid = {
    cell: 64,
    width: 10,
    height: 4,
    x: 0,
    y: 0,
    walkable: "1".repeat(40),
  };
  const currents = [
    {
      id: "stream",
      maxBonus: 150,
      samples: [
        { x: 0, y: 96, z: 0, radius: 31 },
        { x: 640, y: 96, z: 0, radius: 31 },
      ],
    },
  ];
  const args = {
    grid,
    gate: null,
    gates: [],
    start: { x: 32, y: 32 },
    end: { x: 608, y: 32 },
    speed: 100,
    flying: false,
    currents,
  };
  const ordinary = calculateRoutes(args).routes[0],
    forward = calculateRoutes({ ...args, useCurrent: true }).routes[0];
  expect(forward.seconds).toBeLessThan(ordinary.seconds);
  expect(forward.distance).toBeGreaterThan(ordinary.distance);
  expect(forward.legs[0].some((p) => p.y === 96)).toBe(true);
  const backward = calculateRoutes({
    ...args,
    start: args.end,
    end: args.start,
    useCurrent: true,
  }).routes[0];
  expect(backward.seconds).toBeCloseTo(ordinary.seconds);
  const onStream = calculateRoutes({
    ...args,
    start: { x: 32, y: 96 },
    end: { x: 608, y: 96 },
    useCurrent: false,
  }).routes[0];
  expect(onStream.seconds).toBeCloseTo(576 / 250);
  expect(routePosition(onStream, 1, 100).position.x).toBeCloseTo(282);
});
it("reports real staged progress, yields to the event loop and aborts obsolete work", async () => {
  const grid = {
    cell: 64,
    width: 150,
    height: 150,
    x: 0,
    y: 0,
    walkable: "1".repeat(22500),
  };
  const args = {
    grid,
    gate: null,
    gates: [],
    start: { x: 32, y: 32 },
    end: { x: 9568, y: 9568 },
    speed: 300,
    flying: false,
  };
  const abort = new AbortController();
  let visited = 0;
  const job = calculateRoutesAsync(args, {
    sliceMs: 0,
    signal: abort.signal,
    onProgress: (p) => {
      visited = Math.max(visited, p.expanded);
    },
  });
  abort.abort();
  await expect(job).rejects.toMatchObject({ name: "AbortError" });
  expect(visited).toBeGreaterThan(0);
  const progress: string[] = [];
  const result = await calculateRoutesAsync(args, {
    onProgress: (p) => progress.push(p.stage),
  });
  expect(result.routes[0].distance).toBeCloseTo(149 * 64 * Math.SQRT2);
  expect(progress).toContain("计算完成");
});

it("compares all methods and keeps only near-fastest alternatives; collisions share the walking grid", async () => {
  const grid = {
    cell: 64,
    width: 10,
    height: 6,
    x: 0,
    y: 0,
    walkable: "1".repeat(60),
  };
  const blocked = withTrees(grid, [], [{ x: 288, y: 96, radius: 70 }]);
  expect(blocked.walkable[14]).toBe("0");
  expect(obstacleCells(grid, [{ x: 288, y: 96, radius: 70 }])).toContain(14);
  const result = await calculateRoutesAsync({
    grid: blocked,
    gate: { channel: 10, castRange: 200 },
    gates: [
      { x: 32, y: 288 },
      { x: 608, y: 288 },
    ],
    start: { x: 32.2, y: 96.2 },
    end: { x: 608.4, y: 96.4 },
    speed: 100,
    flying: false,
    allModes: true,
    currents: [
      {
        id: "flow",
        maxBonus: 150,
        samples: [
          { x: 0, y: 32, z: 0, radius: 30 },
          { x: 640, y: 32, z: 0, radius: 30 },
        ],
      },
    ],
  });
  expect(new Set(result.routes.map(routeKey)).size).toBe(4);
  expect(result.routes.some((r) => r.mode === "flying")).toBe(false);
  for (const r of result.routes)
    for (const leg of r.legs)
      for (const p of leg) {
        expect(Number.isInteger(p.x)).toBe(true);
        expect(Number.isInteger(p.y)).toBe(true);
      }
  const visible = nearbyRoutes(result.routes),
    fastest = Math.min(...result.routes.map((r) => r.seconds));
  expect(visible.length).toBeGreaterThan(1);
  expect(visible.length).toBeLessThan(4);
  expect(
    visible.every((r) => r.seconds - fastest <= Math.max(3, fastest * 0.1)),
  ).toBe(true);
  for (const r of result.routes.filter((r) => r.mode !== "flying"))
    for (const leg of r.legs)
      for (let i = 1; i < leg.length; i++)
        expect(clearSegment(blocked, leg[i - 1], leg[i])).toBe(true);
});
