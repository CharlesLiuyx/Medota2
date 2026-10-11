import {
  ResourceCache,
  ResourceScheduler,
  type ResourcePriority,
} from "@/lib/resource-cache";

export const browserResources = new ResourceCache<unknown>({
  entries: 128,
  bytes: 48 * 1024 * 1024,
});
export const resourceScheduler = new ResourceScheduler();

export function browserScope() {
  const root = document.documentElement;
  if (root.dataset.environmentVerification !== "verified")
    throw new Error("资料连接尚未验证。");
  return JSON.stringify([
    root.dataset.environment,
    root.dataset.dataClass,
    root.dataset.environmentRun,
    root.dataset.environmentFingerprint,
  ]);
}

export function resourceKey(parts: readonly unknown[]) {
  return `${browserScope()}:${JSON.stringify(parts)}`;
}

export function verifyResourceResponse(response: Response) {
  const root = document.documentElement;
  if (
    response.headers.get("x-medota2-environment-verification") !== "verified" ||
    response.headers.get("x-medota2-environment") !==
      root.dataset.environment ||
    response.headers.get("x-medota2-data-class") !== root.dataset.dataClass ||
    (response.headers.get("x-medota2-run-id") ?? "none") !==
      root.dataset.environmentRun ||
    (root.dataset.environmentFingerprint &&
      response.headers.get("x-medota2-database-fingerprint") !==
        root.dataset.environmentFingerprint)
  )
    throw new Error("资料连接身份不匹配。");
}

export function canPrefetch() {
  if (!navigator.onLine || document.visibilityState === "hidden") return false;
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  return !connection?.saveData && !connection?.effectiveType?.includes("2g");
}

export function loadBrowserResource<T>(
  key: string,
  load: () => Promise<T>,
  priority: ResourcePriority = "foreground",
  ttl = Infinity,
): Promise<T> {
  if (priority === "foreground") resourceScheduler.promote(key);
  return browserResources.get(
    key,
    () => resourceScheduler.schedule(key, priority, load),
    ttl,
  ) as Promise<T>;
}
