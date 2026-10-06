import { afterEach, expect, it, vi } from "vitest";
import { RouteClient } from "@/components/map/route-client";
import type {
  WorkerRequest,
  WorkerResponse,
} from "@/components/map/routing.worker";
afterEach(() => vi.unstubAllGlobals());
it("ignores stale worker results after replacement and handles cancellation", async () => {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    messages: WorkerRequest[] = [];
    constructor() {
      workers.push(this);
    }
    postMessage(m: WorkerRequest) {
      this.messages.push(m);
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", FakeWorker);
  const client = new RouteClient({ grid: null, gate: null, gates: [] });
  const request = {
    start: { x: 0, y: 0 },
    end: { x: 300, y: 0 },
    speed: 1,
    flying: true,
  };
  const first = client.run(request, () => {});
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const second = client.run({ ...request, end: { x: 600, y: 0 } }, () => {});
  await rejected;
  const jobs = workers[0].messages.filter((m) => m.type === "run");
  const result = { routes: [], error: null, close: false };
  workers[0].onmessage?.({
    data: { type: "result", id: jobs[0].id, result, elapsedMs: 1 },
  } as unknown as MessageEvent<WorkerResponse>);
  let done = false;
  void second.then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  workers[0].onmessage?.({
    data: { type: "result", id: jobs[1].id, result, elapsedMs: 2 },
  } as unknown as MessageEvent<WorkerResponse>);
  expect((await second).elapsedMs).toBe(2);
  expect(workers).toHaveLength(1);
  client.dispose();
});
it("provides the same result without Worker support", async () => {
  vi.stubGlobal("Worker", undefined);
  const client = new RouteClient({ grid: null, gate: null, gates: [] });
  const { result } = await client.run(
    { start: { x: 0, y: 0 }, end: { x: 600, y: 0 }, speed: 300, flying: true },
    () => {},
  );
  expect(result.routes[0].seconds).toBe(2);
  client.dispose();
});
