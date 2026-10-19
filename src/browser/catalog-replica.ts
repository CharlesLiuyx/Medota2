import {
  browserScope,
  browserResources,
  canPrefetch,
  loadBrowserResource,
  verifyResourceResponse,
} from "./resources";
import type { ResourcePriority } from "@/lib/resource-cache";
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
  bytes: number;
}
let database: Promise<IDBDatabase | null> | undefined;
function family(id: ReplicaIdentity) {
  return `${browserScope()}:${REPLICA_SCHEMA}:${id.entity}:${id.locale}`;
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
      const request = indexedDB.open("medota2-catalog", 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        const snapshots = db.objectStoreNames.contains("snapshots")
          ? request.transaction!.objectStore("snapshots")
          : db.createObjectStore("snapshots", { keyPath: "key" });
        if (!snapshots.indexNames.contains("family"))
          snapshots.createIndex("family", "family");
        const metadata = db.createObjectStore("metadata", { keyPath: "key" });
        const cursor = snapshots.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          const { replica, ...meta } = entry.value as StoredReplica;
          metadata.put({
            ...meta,
            bytes: new TextEncoder().encode(JSON.stringify(replica)).byteLength,
          });
          entry.continue();
        };
      };
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
async function stored(
  id: ReplicaIdentity,
  exact: boolean,
): Promise<StoredReplica[]> {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const store = db.transaction("snapshots").objectStore("snapshots");
      const request = exact
        ? store.get(key(id))
        : store.index("family").getAll(family(id), 2);
      request.onsuccess = () =>
        resolve(
          exact ? (request.result ? [request.result] : []) : request.result,
        );
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
      const tx = db.transaction(["snapshots", "metadata"], "readwrite"),
        store = tx.objectStore("snapshots");
      store.put(record);
      const metadata = tx.objectStore("metadata");
      metadata.put({
        key: record.key,
        family: record.family,
        savedAt: record.savedAt,
        bytes: record.bytes,
      });
      const all = metadata.getAll();
      all.onsuccess = () => {
        // Two versions per entity/language, eight snapshots total; all changes
        // commit atomically so interrupted writes never publish a partial replica.
        const records = (all.result as StoredReplica[]).sort(
          (a, b) => b.savedAt - a.savedAt,
        );
        const counts = new Map<string, number>();
        let bytes = 0;
        records.forEach((entry, index) => {
          bytes += entry.bytes;
          const n = (counts.get(entry.family) ?? 0) + 1;
          counts.set(entry.family, n);
          if (n > 2 || index >= 8 || bytes > 48 * 1024 * 1024) {
            store.delete(entry.key);
            metadata.delete(entry.key);
          }
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
/** Only completed, identity-verified replicas can seed a client navigation. */
export function peekBrowserReplica(
  id: ReplicaIdentity,
): CatalogReplica | undefined {
  try {
    return browserResources.peek(key(id)) as CatalogReplica | undefined;
  } catch {
    return undefined;
  }
}
export function getBrowserReplica(
  id: ReplicaIdentity,
  priority: ResourcePriority = "foreground",
): Promise<CatalogReplica> {
  return loadBrowserResource(key(id), () => load(id), priority);
}
async function load(id: ReplicaIdentity): Promise<CatalogReplica> {
  const exact = (await stored(id, true))[0];
  if (exact && (await valid(exact.replica, id))) return exact.replica;
  const previous = (await stored(id, false))
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
    verifyResourceResponse(response);
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
      bytes: new TextEncoder().encode(JSON.stringify(replica)).byteLength,
    });
    return replica;
  } finally {
    clearTimeout(timeout);
  }
}
export function prefetchSibling(id: ReplicaIdentity) {
  if (!canPrefetch()) return;
  const other = {
    ...id,
    entity:
      id.entity === "heroes" ? ("abilities" as const) : ("heroes" as const),
  };
  void getBrowserReplica(other, "background").catch(() => {});
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
    verifyResourceResponse(response);
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
