import { describe, expect, it, vi } from "vitest";
import { ResourceCache, ResourceScheduler } from "@/lib/resource-cache";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe("shared version resources", () => {
  it("deduplicates readers, isolates versions and permits retry after a failed request", async () => {
    const cache = new ResourceCache<string>({ entries: 2, bytes: 100 });
    const work = deferred<string>();
    const load = vi.fn(() => work.promise);
    const first = cache.get("env-a:version-1", load);
    const second = cache.get("env-a:version-1", load);
    expect(first).toBe(second);
    expect(await cache.get("env-b:version-1", async () => "other")).toBe(
      "other",
    );
    work.reject(new Error("offline"));
    await expect(first).rejects.toThrow("offline");
    expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.get("env-a:version-1", async () => "recovered")).toBe(
      "recovered",
    );
    expect(cache.peek("env-b:version-1")).toBe("other");
  });
  it("evicts by bytes and recent use, expires mutable descriptors, and does not retain oversized values", async () => {
    const cache = new ResourceCache<string>({ entries: 2, bytes: 16 });
    cache.set("a", "aaa");
    cache.set("b", "bbb");
    cache.peek("a");
    cache.set("c", "ccc");
    expect(cache.peek("b")).toBeUndefined();
    expect(cache.peek("a")).toBe("aaa");
    cache.set("large", "x".repeat(20));
    expect(cache.peek("large")).toBeUndefined();
    cache.set("head", "old", 0);
    expect(cache.peek("head")).toBeUndefined();
    expect(await cache.get("head", async () => "new")).toBe("new");
  });
  it("keeps an interaction slot available and promotes queued speculative work", async () => {
    const scheduler = new ResourceScheduler();
    const first = deferred<string>(),
      second = deferred<string>();
    const started: string[] = [];
    const a = scheduler.schedule("a", "background", () => {
      started.push("a");
      return first.promise;
    });
    const b = scheduler.schedule("b", "background", async () => {
      started.push("b");
      return "b";
    });
    const c = scheduler.schedule("c", "background", () => {
      started.push("c");
      return second.promise;
    });
    scheduler.promote("c");
    await Promise.resolve();
    expect(started).toEqual(["a", "c"]);
    second.resolve("c");
    await c;
    expect(started).not.toContain("b");
    first.resolve("a");
    expect(await Promise.all([a, b])).toEqual(["a", "b"]);
  });
});
