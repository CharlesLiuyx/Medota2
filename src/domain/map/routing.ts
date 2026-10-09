import {
  currentField,
  flowBonus,
  type CurrentPath,
  type CurrentField,
} from "./currents";
export type Position = { x: number; y: number };
export type NavGrid = {
  cell: number;
  width: number;
  height: number;
  x: number;
  y: number;
  walkable: string;
  /** Known GNV flags with bit 16, matching the navigation purple overlay. */
  noWard?: string;
  /** Known flags without bit 16; unlike walkability this permits ward cliffs. */
  wardable?: string;
};
export type RoutingData = {
  grid: NavGrid | null;
  gate: { channel: number; castRange: number } | null;
  revision: string;
  currents?: CurrentPath[];
  obstacles?: (Position & { id: string; radius: number; estimated: boolean })[];
};
export type RouteMode = "ground" | "flying" | "current";
export const routeKey = (r: Route) => `${r.mode ?? "ground"}:${r.kind}`;
export const routeColor = (r: Route) =>
  r.mode === "flying"
    ? "#ffd478"
    : r.mode === "current"
      ? "#80efb2"
      : "#89eaff";
export type Route = {
  mode?: RouteMode;
  kind: "direct" | "gate";
  legs: Position[][];
  distance: number;
  delay: number;
  seconds: number;
  segmentSeconds?: number[][];
};
const length = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y);
export const pathLength = (points: Position[]) =>
  points.slice(1).reduce((s, p, i) => s + length(points[i], p), 0);
export function cellAt(g: NavGrid, p: Position) {
  const x = Math.floor((p.x - g.x) / g.cell),
    y = Math.floor((p.y - g.y) / g.cell);
  return x < 0 || y < 0 || x >= g.width || y >= g.height ? -1 : y * g.width + x;
}
const center = (g: NavGrid, i: number): Position => ({
  x: g.x + ((i % g.width) + 0.5) * g.cell,
  y: g.y + (Math.floor(i / g.width) + 0.5) * g.cell,
});

/** Rasterized initial collision hull, expanded by the same 24-unit hero approximation. */
export function obstacleCells(
  grid: NavGrid,
  obstacles: (Position & { radius: number })[],
): number[] {
  const cells = new Set<number>();
  for (const object of obstacles) {
    const radius = object.radius + 24;
    const col = Math.floor((object.x - grid.x) / grid.cell),
      row = Math.floor((object.y - grid.y) / grid.cell);
    const n = Math.ceil(radius / grid.cell);
    for (
      let y = Math.max(0, row - n);
      y <= Math.min(grid.height - 1, row + n);
      y++
    )
      for (
        let x = Math.max(0, col - n);
        x <= Math.min(grid.width - 1, col + n);
        x++
      ) {
        const i = y * grid.width + x;
        if (length(center(grid, i), object) <= radius) cells.add(i);
      }
  }
  return [...cells];
}
export function treeCells(grid: NavGrid, trees: Position[]): number[] {
  return obstacleCells(
    grid,
    trees.map((p) => ({ ...p, radius: 32 })),
  );
}
export function withTrees(
  grid: NavGrid,
  trees: Position[],
  obstacles: (Position & { radius: number })[] = [],
): NavGrid {
  const cells = grid.walkable.split("");
  for (const i of obstacleCells(grid, [
    ...obstacles,
    ...trees.map((p) => ({ ...p, radius: 32 })),
  ]))
    cells[i] = "0";
  return { ...grid, walkable: cells.join("") };
}

// Binary heap avoids sorting the open set on every visited cell.
class Queue {
  items: { id: number; score: number }[] = [];
  push(id: number, score: number) {
    const item = { id, score };
    let i = this.items.length;
    this.items.push(item);
    while (i) {
      const p = (i - 1) >> 1;
      if (this.items[p].score <= score) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = item;
  }
  pop() {
    const first = this.items[0],
      last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let c = i * 2 + 1;
        if (
          c + 1 < this.items.length &&
          this.items[c + 1].score < this.items[c].score
        )
          c++;
        if (last.score <= this.items[c].score) break;
        this.items[i] = this.items[c];
        i = c;
      }
      this.items[i] = last;
    }
    return first.id;
  }
}

/** Supercover traversal: even diagonal corner touches must not clip a blocked cell. */
export function clearSegment(g: NavGrid, a: Position, b: Position): boolean {
  let x = Math.floor((a.x - g.x) / g.cell),
    y = Math.floor((a.y - g.y) / g.cell);
  const ex = Math.floor((b.x - g.x) / g.cell),
    ey = Math.floor((b.y - g.y) / g.cell);
  const walk = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < g.width &&
    y < g.height &&
    g.walkable[y * g.width + x] === "1";
  if (!walk(x, y) || !walk(ex, ey)) return false;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    sx = Math.sign(dx),
    sy = Math.sign(dy);
  const tx = dx ? g.cell / Math.abs(dx) : Infinity,
    ty = dy ? g.cell / Math.abs(dy) : Infinity;
  let mx = dx ? (g.x + (x + (sx > 0 ? 1 : 0)) * g.cell - a.x) / dx : Infinity;
  let my = dy ? (g.y + (y + (sy > 0 ? 1 : 0)) * g.cell - a.y) / dy : Infinity;
  for (let steps = 0; steps <= g.width + g.height; steps++) {
    if (x === ex && y === ey) return true;
    if (Math.abs(mx - my) < 1e-10) {
      if (!walk(x + sx, y) || !walk(x, y + sy)) return false;
      x += sx;
      y += sy;
      mx += tx;
      my += ty;
    } else if (mx < my) {
      x += sx;
      mx += tx;
    } else {
      y += sy;
      my += ty;
    }
    if (!walk(x, y)) return false;
  }
  return false;
}

export type RoutingInput = {
  grid: NavGrid | null;
  gate: RoutingData["gate"];
  gates: Position[];
  start: Position;
  end: Position;
  speed: number;
  flying: boolean;
  useCurrent?: boolean;
  allModes?: boolean;
  currents?: CurrentPath[];
};
export type RoutingResult = {
  routes: Route[];
  error: string | null;
  close: boolean;
};
export type RoutingProgress = {
  stage: string;
  completed: number;
  total: number;
  expanded: number;
  frontier: number;
};
type SearchStep = { expanded: number; frontier: number };
type Workspace = {
  walk: Uint8Array;
  components: Int32Array;
  cost: Float64Array;
  parent: Int32Array;
  seen: Uint32Array;
  closed: Uint32Array;
  generation: number;
  paths: Map<string, Position[] | null>;
};
const workspaces = new WeakMap<NavGrid, Workspace>();
const flowIds = new WeakMap<CurrentField, number>();
let nextFlowId = 0;
/** Four-way connectivity is equivalent to eight-way connectivity without corner cutting. */
function* prepareGrid(g: NavGrid): Generator<SearchStep, Workspace> {
  const cached = workspaces.get(g);
  if (cached) return cached;
  const n = g.width * g.height;
  const w: Workspace = {
    walk: new Uint8Array(n),
    components: new Int32Array(n),
    cost: new Float64Array(n),
    parent: new Int32Array(n),
    seen: new Uint32Array(n),
    closed: new Uint32Array(n),
    generation: 0,
    paths: new Map(),
  };
  for (let i = 0; i < n; i++) w.walk[i] = g.walkable[i] === "1" ? 1 : 0;
  const queue = new Int32Array(n);
  let component = 0,
    visited = 0;
  for (let seed = 0; seed < n; seed++) {
    if (!w.walk[seed] || w.components[seed]) continue;
    let head = 0,
      tail = 1;
    queue[0] = seed;
    w.components[seed] = ++component;
    while (head < tail) {
      const i = queue[head++],
        x = i % g.width;
      for (const j of [
        x > 0 ? i - 1 : -1,
        x + 1 < g.width ? i + 1 : -1,
        i - g.width,
        i + g.width,
      ]) {
        if (j < 0 || j >= n || !w.walk[j] || w.components[j]) continue;
        w.components[j] = component;
        queue[tail++] = j;
      }
      if (++visited % 2048 === 0)
        yield { expanded: visited, frontier: tail - head };
    }
  }
  workspaces.set(g, w);
  return w;
}
const drain = <T>(job: Generator<unknown, T>): T => {
  let step = job.next();
  while (!step.done) step = job.next();
  return step.value;
};
/** Remove only redundant collinear points: never replace the shortest grid route with a greedy shortcut. */
function compactPath(points: Position[]) {
  const path: Position[] = [];
  for (const p of points) {
    if (path.length && length(path.at(-1)!, p) < 1e-8) continue;
    if (path.length >= 2) {
      const a = path.at(-2)!,
        b = path.at(-1)!;
      if (
        Math.abs((b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)) <
          1e-8 &&
        (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) >= 0
      )
        path.pop();
    }
    path.push(p);
  }
  return path;
}
function* searchPath(
  g: NavGrid,
  w: Workspace,
  start: Position,
  end: Position,
  flow?: {
    field: CurrentField;
    speed: number;
    paths: CurrentPath[];
    weighted: boolean;
  },
): Generator<SearchStep, Position[] | null> {
  const s = cellAt(g, start),
    target = cellAt(g, end);
  if (s < 0 || target < 0 || !w.walk[s] || !w.walk[target]) return null;
  if (flow && !flowIds.has(flow.field)) flowIds.set(flow.field, ++nextFlowId);
  const maxSpeed = flow?.weighted
    ? flow.speed + Math.max(0, ...flow.paths.map((p) => p.maxBonus))
    : 1;
  const key = `${start.x},${start.y}:${end.x},${end.y}:${flow ? `${flowIds.get(flow.field)}:${flow.weighted ? flow.speed : "distance"}` : "ground"}`;
  if (w.paths.has(key)) {
    const value = w.paths.get(key)!;
    w.paths.delete(key);
    w.paths.set(key, value);
    return value;
  }
  const save = (path: Position[] | null) => {
    if (w.paths.size >= 128) w.paths.delete(w.paths.keys().next().value!);
    w.paths.set(key, path);
    return path;
  };
  if (w.components[s] !== w.components[target]) return save(null);
  if (s === target) return save(compactPath([start, end]));
  // Costs in cell units. Octile distance is consistent for the eight-neighbor graph.
  const tx = target % g.width,
    ty = Math.floor(target / g.width);
  const heuristic = (x: number, y: number) => {
    const dx = Math.abs(x - tx),
      dy = Math.abs(y - ty);
    const distance = Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    return flow?.weighted ? (distance * g.cell) / maxSpeed : distance;
  };
  if (++w.generation === 0xffffffff) {
    w.seen.fill(0);
    w.closed.fill(0);
    w.generation = 1;
  }
  const generation = w.generation,
    queue = new Queue();
  w.cost[s] = 0;
  w.parent[s] = -1;
  w.seen[s] = generation;
  queue.push(s, heuristic(s % g.width, Math.floor(s / g.width)));
  let expanded = 0;
  while (queue.items.length) {
    const i = queue.pop();
    if (w.closed[i] === generation) continue;
    w.closed[i] = generation;
    if (i === target) {
      const cells: Position[] = [];
      for (let at = target; at >= 0; at = w.parent[at])
        cells.push(center(g, at));
      cells.reverse();
      return save(
        flow ? [start, ...cells, end] : compactPath([start, ...cells, end]),
      );
    }
    const x = i % g.width,
      y = Math.floor(i / g.width);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx,
          ny = y + dy,
          j = ny * g.width + nx;
        if (
          nx < 0 ||
          ny < 0 ||
          nx >= g.width ||
          ny >= g.height ||
          !w.walk[j] ||
          w.closed[j] === generation
        )
          continue;
        if (
          dx &&
          dy &&
          (!w.walk[y * g.width + nx] || !w.walk[ny * g.width + x])
        )
          continue;
        const distance = dx && dy ? Math.SQRT2 : 1;
        const edge = flow?.weighted
          ? distance *
            g.cell *
            0.5 *
            (1 / (flow.speed + flowBonus(flow.field, i, dx, dy)) +
              1 / (flow.speed + flowBonus(flow.field, j, dx, dy)))
          : distance;
        const cost = w.cost[i] + edge;
        if (w.seen[j] === generation && cost >= w.cost[j]) continue;
        w.cost[j] = cost;
        w.parent[j] = i;
        w.seen[j] = generation;
        queue.push(j, cost + heuristic(nx, ny));
      }
    if (++expanded % 256 === 0)
      yield { expanded, frontier: queue.items.length };
  }
  return save(null);
}
export function groundPath(
  g: NavGrid,
  start: Position,
  end: Position,
): Position[] | null {
  return drain(searchPath(g, drain(prepareGrid(g)), start, end));
}
export function retimeRoutes(
  result: RoutingResult,
  speed: number,
): RoutingResult {
  if (!Number.isFinite(speed) || speed <= 0)
    return { routes: [], error: "请输入大于 0 的有效移动速度。", close: false };
  const routes = result.routes
    .map((r) => ({ ...r, seconds: r.distance / speed + r.delay }))
    .sort((a, b) => a.seconds - b.seconds);
  return {
    ...result,
    routes,
    close:
      routes.length === 2 &&
      routes[1].seconds - routes[0].seconds <=
        Math.max(3, routes[0].seconds * 0.1),
  };
}
/** Same generator powers synchronous audits and interruptible background UI work. */
function* routeSteps(
  input: RoutingInput,
): Generator<RoutingProgress, RoutingResult> {
  const { grid, gate, speed, flying } = input;
  const snap = (p: Position): Position => ({
    x: Math.round(p.x),
    y: Math.round(p.y),
  });
  const start = snap(input.start),
    end = snap(input.end),
    gates = input.gates.map(snap);
  const flow =
    !flying && grid && input.currents?.length
      ? {
          field: currentField(grid, input.currents),
          speed,
          paths: input.currents,
          weighted: !!input.useCurrent,
        }
      : undefined;
  const fail = (error: string): RoutingResult => ({
    routes: [],
    error,
    close: false,
  });
  if (!Number.isFinite(speed) || speed <= 0)
    return fail("请输入大于 0 的有效移动速度。");
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite))
    return fail("请选择有效的地图坐标。");
  if (input.useCurrent && !flow) return fail("此版本尚未收录湍流区域与规则。");
  if (!flying && !grid) return fail("此版本未收录导航栅格，可切换飞行估算。");
  if (
    !flying &&
    grid &&
    [start, end].some((p) => grid.walkable[cellAt(grid, p)] !== "1")
  )
    return fail("起点或终点位于阻挡区域，请在附近可行走地面重新选点。");
  let workspace: Workspace | null = null;
  if (!flying) {
    const preparation = prepareGrid(grid!);
    let step = preparation.next();
    while (!step.done) {
      yield {
        stage: "准备导航与连通区域",
        completed: 0,
        total: 1,
        ...step.value,
      };
      step = preparation.next();
    }
    workspace = step.value;
  }
  let completed = 0;
  const total = gate && gates.length === 2 ? 5 : 1;
  function* path(
    a: Position,
    b: Position,
    stage: string,
  ): Generator<RoutingProgress, Position[] | null> {
    yield { stage, completed, total, expanded: 0, frontier: 0 };
    let result: Position[] | null = [a, b];
    if (!flying) {
      const search = searchPath(grid!, workspace!, a, b, flow);
      let step = search.next();
      while (!step.done) {
        yield { stage, completed, total, ...step.value };
        step = search.next();
      }
      result = step.value;
    }
    yield { stage, completed: ++completed, total, expanded: 0, frontier: 0 };
    return result;
  }
  const make = (
    kind: Route["kind"],
    legs: Position[][],
    delay: number,
  ): Route => {
    const distance = legs.reduce((n, p) => n + pathLength(p), 0);
    const segmentSeconds = flow
      ? legs.map((leg) =>
          leg.slice(1).map((b, i) => {
            const a = leg[i],
              dx = b.x - a.x,
              dy = b.y - a.y;
            return (
              length(a, b) *
              0.5 *
              (1 / (speed + flowBonus(flow.field, cellAt(grid!, a), dx, dy)) +
                1 / (speed + flowBonus(flow.field, cellAt(grid!, b), dx, dy)))
            );
          }),
        )
      : undefined;
    return {
      kind,
      mode: flying ? "flying" : input.useCurrent ? "current" : "ground",
      legs,
      distance,
      delay,
      segmentSeconds,
      seconds: segmentSeconds
        ? segmentSeconds.flat().reduce((a, b) => a + b, delay)
        : distance / speed + delay,
    };
  };
  const routes: Route[] = [];
  const direct = yield* path(start, end, "搜索直达路线");
  if (direct) routes.push(make("direct", [direct], 0));
  if (gate && gates.length === 2) {
    // Preserve the versioned gate-center landing model; when its center is blocked,
    // choose the closest approach cell in the endpoint's connected component.
    const approach = (p: Position, endpoint: Position): Position | null => {
      if (flying) return p;
      const g = grid!,
        w = workspace!,
        component = w.components[cellAt(g, endpoint)];
      const at = cellAt(g, p);
      if (at >= 0 && w.walk[at] && w.components[at] === component) return p;
      const col = Math.floor((p.x - g.x) / g.cell),
        row = Math.floor((p.y - g.y) / g.cell),
        radius = Math.ceil(gate.castRange / g.cell);
      let best: Position | null = null,
        distance = Infinity;
      for (let y = row - radius; y <= row + radius; y++)
        for (let x = col - radius; x <= col + radius; x++) {
          if (x < 0 || y < 0 || x >= g.width || y >= g.height) continue;
          const i = y * g.width + x;
          if (!w.walk[i] || w.components[i] !== component) continue;
          const candidate = center(g, i),
            d = length(candidate, p);
          if (d <= gate.castRange && d < distance) {
            best = candidate;
            distance = d;
          }
        }
      return best;
    };
    const alternatives: Route[] = [];
    for (const [entryGate, exitGate] of [
      [gates[0], gates[1]],
      [gates[1], gates[0]],
    ]) {
      const entry = approach(entryGate, start),
        exit = approach(exitGate, end);
      if (!entry || !exit) {
        completed += 2;
        continue;
      }
      const first = yield* path(start, entry, "搜索通往双生之门的路线");
      const last = yield* path(exit, end, "搜索出门后的路线");
      if (first && last)
        alternatives.push(make("gate", [first, last], gate.channel));
    }
    alternatives.sort((a, b) => a.seconds - b.seconds);
    if (alternatives[0]) routes.push(alternatives[0]);
  }
  yield {
    stage: "计算完成",
    completed: total,
    total,
    expanded: 0,
    frontier: 0,
  };
  if (flow) {
    routes.sort((a, b) => a.seconds - b.seconds);
    return {
      routes,
      error: routes.length ? null : "未找到可通行路线。",
      close:
        routes.length === 2 &&
        routes[1].seconds - routes[0].seconds <=
          Math.max(3, routes[0].seconds * 0.1),
    };
  }
  return retimeRoutes(
    {
      routes,
      error: routes.length ? null : "未找到可通行路线，请更换选点或切换飞行。",
      close: false,
    },
    speed,
  );
}
/** Keep useful alternatives under one shared map/panel comparison rule. */
export function nearbyRoutes(routes: Route[]): Route[] {
  const sorted = [...routes].sort((a, b) => a.seconds - b.seconds);
  const best = sorted[0]?.seconds ?? 0;
  return sorted.filter((r) => r.seconds - best <= Math.max(3, best * 0.1));
}
/** Compute every available planning method without changing the chosen endpoints. */
function* planSteps(
  input: RoutingInput,
): Generator<RoutingProgress, RoutingResult> {
  const modes: RouteMode[] = [
    "ground",
    ...(input.currents?.length ? ["current" as const] : []),
  ];
  const routes: Route[] = [];
  const errors: string[] = [];
  const labels = {
    ground: "陆地最短距离",
    flying: "飞行",
    current: "湍流最短耗时",
  };
  for (let i = 0; i < modes.length; i++) {
    const mode = modes[i];
    const job = routeSteps({
      ...input,
      flying: mode === "flying",
      useCurrent: mode === "current",
    });
    let step = job.next();
    while (!step.done) {
      yield {
        ...step.value,
        stage: `${labels[mode]} · ${step.value.stage}`,
        completed: i + step.value.completed / step.value.total,
        total: modes.length,
      };
      step = job.next();
    }
    routes.push(...step.value.routes);
    if (step.value.error) errors.push(`${labels[mode]}：${step.value.error}`);
  }
  return {
    routes,
    error: errors.length ? errors.join("；") : null,
    close: false,
  };
}
export function calculateRoutes(input: RoutingInput): RoutingResult {
  return drain(routeSteps(input));
}
export async function calculateRoutesAsync(
  input: RoutingInput,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: RoutingProgress) => void;
    sliceMs?: number;
  } = {},
): Promise<RoutingResult> {
  const job = input.allModes ? planSteps(input) : routeSteps(input),
    budget = options.sliceMs ?? 4;
  let deadline = performance.now() + budget,
    notified = -Infinity;
  try {
    while (true) {
      if (options.signal?.aborted)
        throw new DOMException("Routing cancelled", "AbortError");
      const step = job.next();
      if (step.done) return step.value;
      const now = performance.now();
      if (now - notified >= 40 || step.value.completed === step.value.total) {
        options.onProgress?.(step.value);
        notified = now;
      }
      if (now >= deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        deadline = performance.now() + budget;
      }
    }
  } finally {
    job.return({ routes: [], error: null, close: false });
  }
}

export function routePosition(
  route: Route,
  elapsed: number,
  speed: number,
): { position: Position; channeling: boolean } {
  let remaining = Math.max(0, elapsed);
  for (let i = 0; i < route.legs.length; i++) {
    const leg = route.legs[i];
    for (let j = 1; j < leg.length; j++) {
      const d = length(leg[j - 1], leg[j]),
        seconds = route.segmentSeconds?.[i]?.[j - 1] ?? d / speed;
      if (remaining < seconds) {
        const t = remaining / seconds;
        return {
          position: {
            x: leg[j - 1].x + (leg[j].x - leg[j - 1].x) * t,
            y: leg[j - 1].y + (leg[j].y - leg[j - 1].y) * t,
          },
          channeling: false,
        };
      }
      remaining -= seconds;
    }
    if (i < route.legs.length - 1) {
      if (remaining < route.delay)
        return { position: leg[leg.length - 1], channeling: true };
      remaining -= route.delay;
    }
  }
  return { position: route.legs.at(-1)!.at(-1)!, channeling: false };
}
