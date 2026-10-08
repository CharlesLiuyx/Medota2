import { afterEach, expect, it, vi } from "vitest";
import { VisionClient } from "@/components/map/vision-client";
import {
  createVisionSolver,
  createVisionSampler,
  sampleVision,
  sampleVisionAsync,
  type VisionScene,
} from "@/domain/map/vision";
import type {
  WorkerRequest,
  WorkerResponse,
} from "@/components/map/vision.worker";
const scene: VisionScene = {
  bounds: { minX: 0, maxX: 512, minY: 0, maxY: 512 },
  trees: [{ id: "tree", x: 256, y: 256 }],
  terrain: {
    cell: 64,
    width: 8,
    height: 8,
    origin: { x: 0, y: 0 },
    values: Array(64).fill(0),
  },
};
const request = {
  sources: [{ id: "a", x: 64, y: 256, radius: 400 }],
  options: {},
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("isolates worker jobs, caches full inputs, cancels and disposes", async () => {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    messages: WorkerRequest[] = [];
    terminate = vi.fn();
    constructor() {
      workers.push(this);
    }
    postMessage(message: WorkerRequest) {
      this.messages.push(message);
    }
    reply(data: WorkerResponse) {
      this.onmessage?.({ data } as MessageEvent<WorkerResponse>);
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const client = new VisionClient(scene, "revision-a");
  const first = client.run(request, vi.fn());
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const changed = { ...request, options: { removedTreeIds: ["tree"] } };
  const progress = vi.fn();
  const second = client.run(changed, progress);
  await rejected;
  const worker = workers[0];
  const jobs = worker.messages.filter((message) => message.type === "run");
  const result = sampleVision(
    createVisionSolver(scene, changed.sources, changed.options),
    scene.bounds,
  );
  worker.reply({ type: "progress", id: jobs[0].id, progress: 1 });
  worker.reply({ type: "result", id: jobs[0].id, result, elapsedMs: 1 });
  expect(progress).not.toHaveBeenCalled();
  let completed = false;
  void second.then(() => {
    completed = true;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  worker.reply({ type: "result", id: jobs[1].id, result, elapsedMs: 2 });
  expect((await second).elapsedMs).toBe(2);
  expect((await client.run(changed, vi.fn())).result).toEqual(result);
  expect(
    worker.messages.filter((message) => message.type === "run"),
  ).toHaveLength(2);
  const third = client.run(request, vi.fn());
  const cancelled = expect(third).rejects.toMatchObject({ name: "AbortError" });
  client.dispose();
  await cancelled;
  expect(worker.terminate).toHaveBeenCalledOnce();
  const other = new VisionClient({ ...scene, terrain: null }, "revision-b");
  const pending = other.run(changed, vi.fn());
  expect(workers).toHaveLength(2);
  const end = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  other.dispose();
  await end;
});
it("fallback matches offline cells including edges and missing heights", async () => {
  vi.stubGlobal("Worker", undefined);
  for (const input of [
    scene,
    { ...scene, terrain: null },
    { ...scene, bounds: { ...scene.bounds, maxX: 510, maxY: 499 } },
  ]) {
    const client = new VisionClient(input, "revision");
    expect((await client.run(request, vi.fn())).result).toMatchObject(
      sampleVision(createVisionSolver(input, request.sources), input.bounds),
    );
    client.dispose();
  }
});
it("yields and aborts actual sampling before completing a large calculation", async () => {
  const abort = new AbortController();
  let ticks = 0;
  vi.spyOn(performance, "now").mockImplementation(() => ticks++ * 10);
  const progress = vi.fn(() => abort.abort());
  await expect(
    sampleVisionAsync(scene, request, {
      signal: abort.signal,
      onProgress: progress,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(progress).toHaveBeenCalledTimes(1);
  expect(progress.mock.calls[0]).toEqual([0]);
});

it("samples only the moved source tile, reuses other sources and matches the full-grid oracle", async () => {
  const input: VisionScene = {
    ...scene,
    bounds: { minX: 0, minY: 0, maxX: 4096, maxY: 4096 },
    terrain: {
      cell: 64,
      width: 64,
      height: 64,
      origin: { x: 0, y: 0 },
      values: Array(4096).fill(0),
    },
  };
  const sample = createVisionSampler(input);
  const sources = [
    { id: "a", x: 256, y: 256, radius: 128 },
    { id: "b", x: 3000, y: 3000, radius: 128 },
  ];
  const control = { signal: new AbortController().signal, onProgress: vi.fn() };
  const first = await sample({ sources, options: {} }, control);
  expect(first.work).toEqual({ sampledCells: 50, reusedSources: 0 });
  const moved = [{ ...sources[0], x: 320 }, sources[1]];
  const second = await sample({ sources: moved, options: {} }, control);
  expect(second.work).toEqual({ sampledCells: 25, reusedSources: 1 });
  expect(second.cells).toEqual(
    sampleVision(createVisionSolver(input, moved), input.bounds).cells,
  );
  const cut = await sample(
    { sources: moved, options: { removedTreeIds: ["tree"] } },
    control,
  );
  // This tree does not block either small source tile: no cells need recomputing.
  expect(cut.work).toEqual({ sampledCells: 0, reusedSources: 2 });
  expect(cut.cells).toEqual(
    sampleVision(
      createVisionSolver(input, moved, { removedTreeIds: ["tree"] }),
      input.bounds,
    ).cells,
  );
  const heightSample = createVisionSampler(scene);
  const low = await heightSample(request, control);
  const highRequest = {
    ...request,
    sources: request.sources.map((s) => ({ ...s, z: 128 })),
  };
  const high = await heightSample(highRequest, control);
  expect(high.work?.reusedSources).toBe(0);
  expect(high.cells).not.toEqual(low.cells);
  expect(high.cells).toEqual(
    sampleVision(createVisionSolver(scene, highRequest.sources), scene.bounds)
      .cells,
  );
  expect((await heightSample(highRequest, control)).work?.reusedSources).toBe(
    1,
  );
  for (const terrain of [
    null,
    {
      ...scene.terrain!,
      values: scene.terrain!.values.map((v, i) => (i % 3 ? v : null)),
    },
  ]) {
    const mixed = { ...scene, terrain };
    const overlapping = [
      request.sources[0],
      { id: "b", x: 480, y: 256, radius: 180 },
    ];
    const result = await createVisionSampler(mixed)(
      { sources: overlapping, options: {} },
      control,
    );
    expect(result.cells).toEqual(
      sampleVision(createVisionSolver(mixed, overlapping), mixed.bounds).cells,
    );
  }
});

it("persists defaults across samplers and applies only tree deltas without changing oracle cells", async () => {
  const saved = new Map<string, unknown>();
  const store = {
    get: async (key: string) => saved.get(key),
    put: (key: string, tile: unknown) => {
      saved.set(key, structuredClone(tile));
    },
  };
  const control = { signal: new AbortController().signal, onProgress: vi.fn() };
  for (const terrain of [
    scene.terrain,
    null,
    {
      ...scene.terrain!,
      values: scene.terrain!.values.map((v, i) => (i % 7 ? v : null)),
    },
  ]) {
    saved.clear();
    const input = {
      ...scene,
      trees: [...scene.trees, { id: "second", x: 380, y: 256, z: 0 }],
      terrain,
    };
    const sample = createVisionSampler(input, store);
    const original = await sample(request, control);
    const restoredSampler = createVisionSampler(input, store);
    const renamed = {
      ...request,
      sources: request.sources.map((s) => ({ ...s, id: "placed" })),
    };
    const loaded = await restoredSampler(renamed, control);
    expect(loaded.work).toEqual({ sampledCells: 0, reusedSources: 1 });
    expect(loaded.cells).toEqual(original.cells);
    for (const removedTreeIds of [
      ["tree"],
      ["second"],
      ["tree", "second"],
      [],
    ]) {
      const next = { ...renamed, options: { removedTreeIds } };
      const actual = await restoredSampler(next, control);
      expect(actual.cells).toEqual(
        sampleVision(
          createVisionSolver(input, next.sources, next.options),
          input.bounds,
        ).cells,
      );
      expect(actual.work!.sampledCells).toBeLessThanOrEqual(
        original.work!.sampledCells,
      );
      if (terrain === scene.terrain && removedTreeIds.length === 1) {
        expect(actual.work!.sampledCells).toBeLessThan(
          original.work!.sampledCells,
        );
      }
    }
    // Corrupt shape must be ignored; option and Z changes cannot share defaults.
    saved.set([...saved.keys()][0], { cells: new Uint8Array([99]) });
    expect(
      (await createVisionSampler(input, store)(request, control)).cells,
    ).toEqual(original.cells);
    const changed = { ...request, options: { treeRadius: 32 } };
    const result = await restoredSampler(changed, control);
    expect(result.work!.sampledCells).toBeGreaterThan(0);
    expect(result.cells).toEqual(
      sampleVision(
        createVisionSolver(input, changed.sources, changed.options),
        input.bounds,
      ).cells,
    );
  }
});
