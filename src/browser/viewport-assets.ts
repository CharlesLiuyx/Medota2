import { getImageProps } from "next/image";
import valveAssetImageLoader from "@/components/valve-asset-image-loader";
import type { ViewportAsset } from "@/domain/viewport-assets";
import { ResourceCache } from "@/lib/resource-cache";
import { browserScope, canPrefetch } from "./resources";

// Reserve first-screen capacity so a long catalog's onLoad events cannot evict
// the other tabs before the user visits them. Combined budget stays 512 / 24 MiB.
const decoded = new ResourceCache<HTMLImageElement>({
  entries: 384,
  bytes: 20 * 1024 * 1024,
  sizeOf: (img) => img.naturalWidth * img.naturalHeight * 4,
});
const encountered = new ResourceCache<HTMLImageElement>({
  entries: 128,
  bytes: 4 * 1024 * 1024,
  sizeOf: (img) => img.naturalWidth * img.naturalHeight * 4,
});
function key(asset: ViewportAsset) {
  return JSON.stringify([
    browserScope(),
    asset.src,
    asset.sizes,
    window.innerWidth,
    window.devicePixelRatio,
  ]);
}
export function isViewportAssetReady(src: string, sizes: string) {
  if (typeof window === "undefined") return false;
  try {
    const assetKey = key({ src, sizes });
    return Boolean(decoded.peek(assetKey) || encountered.peek(assetKey));
  } catch {
    return false;
  }
}
export function rememberViewportAsset(
  asset: ViewportAsset,
  img: HTMLImageElement,
) {
  if (!img.complete || !img.naturalWidth) return;
  try {
    const assetKey = key(asset);
    if (decoded.has(assetKey)) return;
    // Never retain a React-owned DOM node: its fiber can retain the entire old page.
    // A detached Image shares HTTP bytes without keeping component state alive.
    void encountered
      .get(assetKey, () => decodeViewportAsset(asset))
      .catch(() => {});
  } catch {
    // An unverified page can display images without admitting them to the cache.
  }
}
export async function warmViewportAsset(asset: ViewportAsset) {
  const assetKey = key(asset);
  await decoded.get(assetKey, async () => {
    const ready = encountered.peek(assetKey);
    if (ready) {
      encountered.delete(assetKey);
      return ready;
    }
    return decodeViewportAsset(asset);
  });
}
async function decodeViewportAsset(asset: ViewportAsset) {
  const img = new Image();
  const { props } = getImageProps({
    ...asset,
    alt: "",
    fill: true,
    loader: valveAssetImageLoader,
  });
  img.fetchPriority = "low";
  img.decoding = "async";
  // Match Next/Image's candidate selection, including DPR; never fetch its oversized fallback first.
  img.sizes = props.sizes ?? "";
  img.srcset = props.srcSet ?? "";
  img.src = props.src;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      img.decode(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Image prefetch timed out")),
          8000,
        );
      }),
    ]);
    // The cache key already includes viewport and DPR. Keep the selected
    // resource, not a responsive listener that outlives cache eviction.
    img.src = img.currentSrc || img.src;
    return img;
  } catch (error) {
    img.removeAttribute("src");
    throw error;
  } finally {
    clearTimeout(timeout);
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
  }
}

/** Yield between small batches; cancel queued work on release/locale changes. */
export function backgroundTurn(signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (idle !== undefined) window.cancelIdleCallback(idle);
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve(!signal.aborted && canPrefetch());
    };
    signal.addEventListener("abort", finish, { once: true });
    if (window.requestIdleCallback)
      idle = window.requestIdleCallback(finish, { timeout: 1500 });
    else timer = setTimeout(finish, 100);
  });
}
