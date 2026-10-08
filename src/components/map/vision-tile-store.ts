import {
  VISION_ALGORITHM,
  VISION_SCENE_FORMAT,
  type VisionDefaultTile,
  type VisionTileStore,
} from "@/domain/map/vision";

/** Reproducible browser cache only. Global FIFO ceiling bounds disk usage across
 * revisions; data/algorithm/schema identities prevent cross-version reuse. */
export function createVisionTileStore(revision: string): VisionTileStore {
  const namespace = `${revision}:${VISION_SCENE_FORMAT}:${VISION_ALGORITHM}:default-tiles/1`;
  let opening: Promise<IDBDatabase | null> | undefined;
  const open = () =>
    (opening ??= new Promise((resolve) => {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open("medota2-vision-defaults", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("tiles", {
          keyPath: "key",
        });
        store.createIndex("savedAt", "savedAt");
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => {
        request.onsuccess = () => request.result.close();
        resolve(null);
      };
    }));
  return {
    async get(key) {
      const db = await open();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const request = db
            .transaction("tiles")
            .objectStore("tiles")
            .get(`${namespace}:${key}`);
          request.onsuccess = () => resolve(request.result?.tile ?? null);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    },
    put(key, tile: VisionDefaultTile) {
      // Avoid storing unusually large custom radii; 2048 × 32 KiB <= 64 MiB
      // of typed arrays, plus small record/index overhead.
      if (tile.cells.byteLength + tile.blockers.byteLength > 32 * 1024) return;
      void open()
        .then((db) => {
          if (!db) return;
          try {
            const tx = db.transaction("tiles", "readwrite");
            tx.onerror = () => {}; // Quota/private-mode failure is a cache miss.
            const store = tx.objectStore("tiles");
            store.put({
              key: `${namespace}:${key}`,
              tile,
              savedAt: Date.now(),
            });
            const count = store.count();
            count.onsuccess = () => {
              let excess = count.result - 2048;
              if (excess <= 0) return;
              const oldest = store.index("savedAt").openCursor();
              oldest.onsuccess = () => {
                const cursor = oldest.result;
                if (!cursor || excess-- <= 0) return;
                cursor.delete();
                cursor.continue();
              };
            };
          } catch {
            /* The calculation already completed without persistence. */
          }
        })
        .catch(() => {});
    },
  };
}
