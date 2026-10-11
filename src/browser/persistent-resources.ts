/** Optional content storage. Metadata scans never deserialize resource payloads. */
interface StoredResource {
  key: string;
  value: unknown;
  checksum: string;
}
interface ResourceMeta {
  key: string;
  family: string;
  savedAt: number;
  bytes: number;
}
let database: Promise<IDBDatabase | null> | undefined;
function open() {
  return (database ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open("medota2-resources", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("values", { keyPath: "key" });
        request.result.createObjectStore("metadata", { keyPath: "key" });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
      request.onerror = request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}
async function digest(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function readPersistentResource<T>(
  key: string,
): Promise<T | undefined> {
  const db = await open();
  if (!db) return;
  const entry = await new Promise<StoredResource | undefined>((resolve) => {
    try {
      const request = db.transaction("values").objectStore("values").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  if (!entry) return;
  try {
    if ((await digest(JSON.stringify(entry.value))) === entry.checksum)
      return entry.value as T;
  } catch {
    /* Corrupt or unavailable storage falls back to the network. */
  }
}
export async function persistResource(
  key: string,
  family: string,
  value: unknown,
) {
  try {
    const text = JSON.stringify(value),
      bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > 32 * 1024 * 1024) return;
    const checksum = await digest(text),
      db = await open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(["values", "metadata"], "readwrite");
      const values = tx.objectStore("values"),
        metadata = tx.objectStore("metadata");
      values.put({ key, value, checksum });
      metadata.put({ key, family, savedAt: Date.now(), bytes });
      const request = metadata.getAll();
      request.onsuccess = () => {
        const entries = (request.result as ResourceMeta[]).sort(
          (a, b) => b.savedAt - a.savedAt,
        );
        const families = new Map<string, number>();
        let total = 0,
          count = 0;
        for (const entry of entries) {
          const versions = (families.get(entry.family) ?? 0) + 1;
          families.set(entry.family, versions);
          if (
            versions > 2 ||
            count >= 128 ||
            total + entry.bytes > 32 * 1024 * 1024
          ) {
            values.delete(entry.key);
            metadata.delete(entry.key);
          } else {
            total += entry.bytes;
            count++;
          }
        }
      };
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    });
  } catch {
    /* Private browsing and quota failures preserve the memory path. */
  }
}
