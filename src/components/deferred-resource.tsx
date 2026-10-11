"use client";
import { useEffect, useState, type ReactNode } from "react";
import {
  loadBrowserResource,
  resourceKey,
  verifyResourceResponse,
} from "@/browser/resources";
import { useTranslations } from "@/i18n/provider";
import { useRouter } from "next/navigation";
/** Mount inside an opened tooltip/details so unopened evidence never requests or renders. */
export function DeferredResource<T>({
  url,
  children,
}: {
  url: string;
  children: (value: T) => ReactNode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [result, setResult] = useState<{ url: string; data: T }>();
  const [failed, setFailed] = useState(false);
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const data = await loadBrowserResource<T>(
        resourceKey(["change-resource/1", url]),
        async () => {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(30_000),
          });
          if (response.status === 409) throw new StaleResourceError();
          if (!response.ok) throw new Error("Evidence request failed");
          verifyResourceResponse(response);
          return response.json() as Promise<T>;
        },
      );
      if (!disposed) {
        setResult({ url, data });
        setFailed(false);
        setStale(false);
      }
    };
    void load().catch((error) => {
      if (!disposed) {
        setFailed(true);
        setStale(error instanceof StaleResourceError);
      }
    });
    return () => {
      disposed = true;
    };
  }, [url, attempt]);
  if (result?.url === url) return children(result.data);
  return (
    <p role={failed ? "alert" : "status"}>
      {t(
        stale
          ? "资料版本已更新，请刷新页面。"
          : failed
            ? "资料加载失败。"
            : "正在加载资料…",
      )}
      {failed && (
        <button
          className="ml-2 underline"
          onClick={() => {
            if (stale) {
              router.refresh();
              return;
            }
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          {t(stale ? "刷新页面" : "重试")}
        </button>
      )}
    </p>
  );
}
class StaleResourceError extends Error {}
