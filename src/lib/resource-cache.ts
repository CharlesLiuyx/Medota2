/** Bounded completed values; concurrent readers share work and failures are retryable. */
export class ResourceCache<T> {
  private values = new Map<
    string,
    { value: T; bytes: number; expires: number }
  >();
  private pending = new Map<string, Promise<T>>();
  private bytes = 0;
  constructor(
    private readonly limits: {
      entries: number;
      bytes: number;
      sizeOf?: (value: T) => number;
    },
  ) {}
  has(key: string) {
    return this.pending.has(key) || this.peek(key) !== undefined;
  }

  peek(key: string): T | undefined {
    const entry = this.values.get(key);
    if (!entry) return;
    this.values.delete(key);
    if (entry.expires <= Date.now()) {
      this.bytes -= entry.bytes;
      return;
    }
    this.values.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttl = Infinity): T {
    const bytes =
      this.limits.sizeOf?.(value) ??
      new TextEncoder().encode(JSON.stringify(value)).byteLength;
    this.delete(key);
    if (bytes > this.limits.bytes) return value;
    this.values.set(key, { value, bytes, expires: Date.now() + ttl });
    this.bytes += bytes;
    while (
      this.values.size > this.limits.entries ||
      this.bytes > this.limits.bytes
    )
      this.delete(this.values.keys().next().value!);
    return value;
  }

  delete(key: string) {
    this.bytes -= this.values.get(key)?.bytes ?? 0;
    this.values.delete(key);
  }

  get(key: string, load: () => Promise<T>, ttl = Infinity): Promise<T> {
    const value = this.peek(key);
    if (value !== undefined) return Promise.resolve(value);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = Promise.resolve()
      .then(load)
      .then((result) => this.set(key, result, ttl));
    this.pending.set(key, promise);
    void promise.then(
      () => this.pending.delete(key),
      () => this.pending.delete(key),
    );
    return promise;
  }
}

export type ResourcePriority = "foreground" | "background";
type Job = { key: string; priority: ResourcePriority; run: () => void };
/** Reserve one of two network slots for interaction; speculative work never fills both. */
export class ResourceScheduler {
  private jobs: Job[] = [];
  private active = 0;
  private background = 0;
  promote(key: string) {
    const job = this.jobs.find((entry) => entry.key === key);
    if (job) job.priority = "foreground";
    this.drain();
  }
  schedule<T>(
    key: string,
    priority: ResourcePriority,
    load: () => Promise<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.jobs.length >= 64 && priority === "background") {
        reject(new Error("Speculative resource queue is full"));
        return;
      }
      const job: Job = {
        key,
        priority,
        run: () => {
          const background = job.priority === "background";
          this.active++;
          if (background) this.background++;
          void Promise.resolve()
            .then(load)
            .then(resolve, reject)
            .finally(() => {
              this.active--;
              if (background) this.background--;
              this.drain();
            });
        },
      };
      this.jobs.push(job);
      this.drain();
    });
  }
  private drain() {
    while (this.active < 2) {
      let index = this.jobs.findIndex((job) => job.priority === "foreground");
      if (index < 0 && this.background === 0) index = 0;
      if (index < 0 || !this.jobs[index]) return;
      this.jobs.splice(index, 1)[0].run();
    }
  }
}
