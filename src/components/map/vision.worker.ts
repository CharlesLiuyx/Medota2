import {
  createVisionSampler,
  type VisionScene,
  type VisionRequest,
  type VisionSamples,
} from "@/domain/map/vision";

import { createVisionTileStore } from "./vision-tile-store";

export type WorkerRequest =
  | { type: "init"; source: VisionScene; revision: string }
  | { type: "run"; id: number; request: VisionRequest }
  | { type: "cancel"; id: number };
export type WorkerResponse =
  | { type: "progress"; id: number; progress: number }
  | { type: "result"; id: number; result: VisionSamples; elapsedMs: number }
  | { type: "error"; id: number; error: string };

let sample: ReturnType<typeof createVisionSampler> | null = null;
let scene: VisionScene | null = null;
let current: { id: number; abort: AbortController } | null = null;
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "init") {
    current?.abort.abort();
    scene = message.source;
    sample = createVisionSampler(
      message.source,
      createVisionTileStore(message.revision),
    );
    return;
  }
  if (message.type === "cancel") {
    if (current?.id === message.id) current.abort.abort();
    return;
  }
  current?.abort.abort();
  const task = { id: message.id, abort: new AbortController() };
  current = task;
  const send = (response: WorkerResponse) => {
    if (current === task && !task.abort.signal.aborted)
      self.postMessage(response);
  };
  const started = performance.now();
  let delivered = false;
  try {
    if (!sample) throw new Error("Vision scene unavailable");
    const result = await sample(message.request, {
      signal: task.abort.signal,
      onProgress: (progress) =>
        send({ type: "progress", id: task.id, progress }),
    });
    send({
      type: "result",
      id: task.id,
      result,
      elapsedMs: performance.now() - started,
    });
    delivered = true;
    // Warm the eight neighboring grid origins only while the pointer is idle.
    // Foreground requests abort this task before starting; partial tiles are never saved.
    const source =
      message.request.sources.find((s) => s.id === "cursor") ??
      message.request.sources.at(-1);
    await new Promise<void>((resolve) => setTimeout(resolve, 32));
    if (source && scene)
      for (const [dx, dy] of [
        [64, 0],
        [-64, 0],
        [0, 64],
        [0, -64],
        [64, 64],
        [-64, 64],
        [64, -64],
        [-64, -64],
      ]) {
        if (current !== task || task.abort.signal.aborted) break;
        const x = source.x + dx,
          y = source.y + dy;
        if (
          x < scene.bounds.minX ||
          x >= scene.bounds.maxX ||
          y < scene.bounds.minY ||
          y >= scene.bounds.maxY
        )
          continue;
        await sample(
          {
            sources: [{ ...source, x, y }],
            options: { ...message.request.options, removedTreeIds: [] },
          },
          {
            signal: task.abort.signal,
            onProgress: () => {},
          },
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
  } catch (error) {
    if (!delivered && !task.abort.signal.aborted)
      send({
        type: "error",
        id: task.id,
        error:
          error instanceof Error ? error.message : "Vision calculation failed",
      });
  }
};
