import {
  REPLICA_SCHEMA,
  REPLICA_BUCKETS,
  type CatalogReplica,
  type ReplicaIdentity,
} from "@/domain/catalog-replica";

interface StoredReplica {
  key: string;
  family: string;
  savedAt: number;
  replica: CatalogReplica;
}
const memory = new Map<string, Promise<CatalogReplica>>();
let database: Promise<IDBDatabase | null> | undefined;
function scope(): string {
  const root = document.documentElement;
  if (root.dataset.environmentVerification !== "verified")
    throw new Error("资料连接尚未验证。");
  return [
    root.dataset.environment,
    root.dataset.dataClass,
    root.dataset.environmentRun,
  ].join(":");
}
function family(id: ReplicaIdentity) {
  return `${scope()}:${REPLICA_SCHEMA}:${id.entity}:${id.locale}`;
}
function key(id: ReplicaIdentity) {
  return `${family(id)}:${id.datasetVersionId}:${id.assetDatasetVersionId}`;
}
function openDatabase(): Promise<IDBDatabase | null> {
  database ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open("medota2-catalog", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("snapshots", { keyPath: "key" });
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          database = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return database;
}
async function stored(): Promise<StoredReplica[]> {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const request = db
        .transaction("snapshots")
        .objectStore("snapshots")
        .getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}
async function persist(record: StoredReplica): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction("snapshots", "readwrite"),
        store = tx.objectStore("snapshots");
      store.put(record);
      const all = store.getAll();
      all.onsuccess = () => {
        // Two versions per entity/language, eight snapshots total; all changes
        // commit atomically so interrupted writes never publish a partial replica.
        const records = (all.result as StoredReplica[]).sort(
          (a, b) => b.savedAt - a.savedAt,
        );
        const counts = new Map<string, number>();
        records.forEach((entry, index) => {
          const n = (counts.get(entry.family) ?? 0) + 1;
          counts.set(entry.family, n);
          if (n > 2 || index >= 8) store.delete(entry.key);
        });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
async function checksum(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function valid(
  replica: CatalogReplica,
  id: ReplicaIdentity,
): Promise<boolean> {
  try {
    const m = replica.manifest;
    if (
      m.schema !== REPLICA_SCHEMA ||
      m.entity !== id.entity ||
      m.locale !== id.locale ||
      m.datasetVersionId !== id.datasetVersionId ||
      m.assetDatasetVersionId !== id.assetDatasetVersionId ||
      m.hashes.length !== REPLICA_BUCKETS
    )
      return false;
    let count = 0;
    for (const hash of m.hashes) {
      const block = replica.blocks[hash];
      if (!Array.isArray(block) || (await checksum(block)) !== hash)
        return false;
      count += block.length;
    }
    return count === m.total;
  } catch {
    return false;
  }
}
function verifyResponse(response: Response) {
  const root = document.documentElement;
  if (
    response.headers.get("x-medota2-environment-verification") !== "verified" ||
    response.headers.get("x-medota2-environment") !==
      root.dataset.environment ||
    response.headers.get("x-medota2-data-class") !== root.dataset.dataClass ||
    (response.headers.get("x-medota2-run-id") ?? "none") !==
      root.dataset.environmentRun
  )
    throw new Error("资料连接身份不匹配。");
}
export function getBrowserReplica(
  id: ReplicaIdentity,
): Promise<CatalogReplica> {
  const cacheKey = key(id);
  let pending = memory.get(cacheKey);
  if (!pending) {
    pending = load(id);
    memory.set(cacheKey, pending);
    if (memory.size > 8) memory.delete(memory.keys().next().value!);
    void pending.catch(() => {
      if (memory.get(cacheKey) === pending) memory.delete(cacheKey);
    });
  }
  return pending;
}
async function load(id: ReplicaIdentity): Promise<CatalogReplica> {
  const snapshots = await stored();
  const exact = snapshots.find((item) => item.key === key(id));
  if (exact && (await valid(exact.replica, id))) return exact.replica;
  const previous = snapshots
    .filter((item) => item.family === family(id))
    .sort((a, b) => b.savedAt - a.savedAt)[0];
  const reusable =
    previous && (await valid(previous.replica, previous.replica.manifest))
      ? previous.replica.blocks
      : {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch("/api/catalog/replica", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...id, known: Object.keys(reusable) }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("本机资料准备失败，继续使用在线查询。");
    verifyResponse(response);
    const delta = (await response.json()) as CatalogReplica;
    const blocks = Object.fromEntries(
      delta.manifest.hashes.map((hash) => [
        hash,
        delta.blocks[hash] ?? reusable[hash],
      ]),
    );
    const replica = { manifest: delta.manifest, blocks };
    if (!(await valid(replica, id))) throw new Error("本机资料校验失败。");
    await persist({
      key: key(id),
      family: family(id),
      savedAt: Date.now(),
      replica,
    });
    return replica;
  } finally {
    clearTimeout(timeout);
  }
}
export function prefetchSibling(id: ReplicaIdentity) {
  if (!navigator.onLine) return;
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (connection?.saveData || connection?.effectiveType?.includes("2g")) return;
  const other = {
    ...id,
    entity:
      id.entity === "heroes" ? ("abilities" as const) : ("heroes" as const),
  };
  void getBrowserReplica(other).catch(() => {});
}
let lastHeadCheck = 0;
let checking:
  | Promise<
      | Pick<ReplicaIdentity, "datasetVersionId" | "assetDatasetVersionId">
      | null
      | undefined
    >
  | undefined;
export async function checkCatalogHead(id: ReplicaIdentity) {
  if (checking) return checking;
  if (Date.now() - lastHeadCheck < 60_000) return undefined;
  lastHeadCheck = Date.now();
  checking = (async () => {
    const response = await fetch("/api/catalog/head", {
      headers: {
        "If-None-Match": `"catalog:${REPLICA_SCHEMA}:${id.datasetVersionId}:${id.assetDatasetVersionId}"`,
      },
      signal: AbortSignal.timeout(5000),
    });
    verifyResponse(response);
    if (response.status === 304) return undefined;
    if (!response.ok) throw new Error("版本检查失败。");
    return (await response.json()) as Pick<
      ReplicaIdentity,
      "datasetVersionId" | "assetDatasetVersionId"
    > | null;
  })();
  try {
    return await checking;
  } finally {
    checking = undefined;
  }
}
