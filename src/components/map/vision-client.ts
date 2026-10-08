import {
  createVisionSampler,
  VISION_ALGORITHM,
  type VisionSamples,
} from "@/domain/map/vision";
import type { WorkerRequest, WorkerResponse } from "./vision.worker";

import type { VisionRequest, VisionScene } from "@/domain/map/vision";
type VisionProgress = number;
type Result = { result: VisionSamples; elapsedMs: number };
type Pending = {
  id: number;
  request: VisionRequest;
  onProgress(progress: VisionProgress): void;
  resolve(result: Result): void;
  reject(error: Error): void;
  abort: AbortController;
};

/** One worker per dataset, one current job. Superseded replies can never replace a new selection. */
export class VisionClient {
  private worker: Worker | null = null;
  private unavailable = false;
  private pending: Pending | null = null;
  private sequence = 0;
  private saved = new Map<string, Result>();
  private sample: ReturnType<typeof createVisionSampler> | null = null;
  constructor(
    private source: VisionScene,
    private revision: string,
  ) {}
  private send(message: WorkerRequest) {
    this.worker?.postMessage(message);
  }
  private fallback(task: Pending) {
    const started = performance.now();
    this.sample ??= createVisionSampler(this.source);
    void this.sample(task.request, {
      signal: task.abort.signal,
      onProgress: task.onProgress,
    })
      .then((result) => {
        if (this.pending !== task) return;
        this.pending = null;
        task.resolve({ result, elapsedMs: performance.now() - started });
      })
      .catch((error) => {
        if (this.pending !== task) return;
        this.pending = null;
        task.reject(error);
      });
  }
  run(
    request: VisionRequest,
    onProgress: (progress: VisionProgress) => void,
  ): Promise<Result> {
    this.cancel();
    const key = JSON.stringify([this.revision, VISION_ALGORITHM, request]);
    const cached = this.saved.get(key);
    if (cached) return Promise.resolve(cached);
    return new Promise<Result>((resolve, reject) => {
      const task: Pending = {
        id: ++this.sequence,
        request,
        onProgress,
        resolve: (result) => {
          if (this.saved.size >= 4)
            this.saved.delete(this.saved.keys().next().value!);
          this.saved.set(key, result);
          resolve(result);
        },
        reject,
        abort: new AbortController(),
      };
      this.pending = task;
      if (typeof Worker === "undefined" || this.unavailable) {
        this.fallback(task);
        return;
      }
      try {
        if (!this.worker) {
          this.worker = new Worker(
            new URL("./vision.worker.ts", import.meta.url),
            { type: "module" },
          );
          this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const message = event.data,
              pending = this.pending;
            if (!pending || pending.id !== message.id) return;
            if (message.type === "progress")
              pending.onProgress(message.progress);
            else {
              this.pending = null;
              if (message.type === "result") pending.resolve(message);
              else pending.reject(new Error(message.error));
            }
          };
          this.worker.onerror = (event) => {
            event.preventDefault();
            this.worker?.terminate();
            this.worker = null;
            this.unavailable = true;
            if (this.pending) this.fallback(this.pending);
          };
          this.send({
            type: "init",
            source: this.source,
            revision: this.revision,
          });
        }
        this.send({ type: "run", id: task.id, request });
      } catch {
        this.worker?.terminate();
        this.worker = null;
        this.unavailable = true;
        this.fallback(task);
      }
    });
  }
  cancel() {
    const task = this.pending;
    if (!task) {
      this.send({ type: "cancel", id: this.sequence });
      return;
    }
    this.pending = null;
    task.abort.abort();
    this.send({ type: "cancel", id: task.id });
    task.reject(new DOMException("Vision cancelled", "AbortError"));
  }
  dispose() {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    this.saved.clear();
  }
}
