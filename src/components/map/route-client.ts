import {
  calculateRoutesAsync,
  type RoutingProgress,
  type RoutingResult,
} from "@/domain/map/routing";
import type {
  RoutingRequest,
  RoutingSource,
  WorkerRequest,
  WorkerResponse,
} from "./routing.worker";

type Result = { result: RoutingResult; elapsedMs: number };
type Pending = {
  id: number;
  request: RoutingRequest;
  onProgress(progress: RoutingProgress): void;
  resolve(result: Result): void;
  reject(error: Error): void;
  abort: AbortController;
};

/** One worker per dataset, one current job. Superseded replies can never replace a new selection. */
export class RouteClient {
  private worker: Worker | null = null;
  private unavailable = false;
  private pending: Pending | null = null;
  private sequence = 0;
  private saved = new Map<string, Result>();
  readonly results = {
    get: (key: string) => this.saved.get(key),
    has: (key: string) => this.saved.has(key),
    set: (key: string, value: Result) => {
      this.saved.set(key, value);
    },
    removeRoute: (id: number) => {
      for (const key of this.saved.keys())
        if (key.startsWith(`${id}:`)) this.saved.delete(key);
    },
  };
  constructor(private source: RoutingSource) {}
  private send(message: WorkerRequest) {
    this.worker?.postMessage(message);
  }
  private fallback(task: Pending) {
    const started = performance.now();
    void calculateRoutesAsync(
      { ...this.source, ...task.request },
      { signal: task.abort.signal, onProgress: task.onProgress },
    )
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
    request: RoutingRequest,
    onProgress: (progress: RoutingProgress) => void,
  ): Promise<Result> {
    this.cancel();
    return new Promise((resolve, reject) => {
      const task: Pending = {
        id: ++this.sequence,
        request,
        onProgress,
        resolve,
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
            new URL("./routing.worker.ts", import.meta.url),
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
          this.send({ type: "init", source: this.source });
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
    if (!task) return;
    this.pending = null;
    task.abort.abort();
    this.send({ type: "cancel", id: task.id });
    task.reject(new DOMException("Routing cancelled", "AbortError"));
  }
  dispose() {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}
