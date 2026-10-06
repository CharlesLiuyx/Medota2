import {
  calculateRoutesAsync,
  type RoutingInput,
  type RoutingProgress,
  type RoutingResult,
} from "@/domain/map/routing";

export type RoutingSource = Pick<
  RoutingInput,
  "grid" | "gate" | "gates" | "currents"
>;
export type RoutingRequest = Pick<
  RoutingInput,
  "start" | "end" | "flying" | "speed" | "useCurrent" | "allModes"
>;
export type WorkerRequest =
  | { type: "init"; source: RoutingSource }
  | { type: "run"; id: number; request: RoutingRequest }
  | { type: "cancel"; id: number };
export type WorkerResponse =
  | { type: "progress"; id: number; progress: RoutingProgress }
  | { type: "result"; id: number; result: RoutingResult; elapsedMs: number }
  | { type: "error"; id: number; error: string };

let source: RoutingSource | null = null;
let current: { id: number; abort: AbortController } | null = null;
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "init") {
    current?.abort.abort();
    source = message.source;
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
  try {
    if (!source) throw new Error("导航尚未准备完成");
    const result = await calculateRoutesAsync(
      { ...source, ...message.request },
      {
        signal: task.abort.signal,
        onProgress: (progress) =>
          send({ type: "progress", id: task.id, progress }),
      },
    );
    send({
      type: "result",
      id: task.id,
      result,
      elapsedMs: performance.now() - started,
    });
  } catch (error) {
    if (!task.abort.signal.aborted)
      send({
        type: "error",
        id: task.id,
        error: error instanceof Error ? error.message : "寻路计算失败",
      });
  }
};
