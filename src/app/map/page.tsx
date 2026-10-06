import type { Metadata } from "next";
import { MapViewer } from "@/components/map/map-viewer";
import { getMapPageData } from "@/server/map/store";
export const metadata: Metadata = { title: "地图" };
export const dynamic = "force-dynamic";
export default async function MapPage() {
  const result = await getMapPageData();
  const { data, error } = result;
  const provenance = "provenance" in result ? result.provenance : null;
  const source = provenance?.public_source;
  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-4 sm:px-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-wide">地图</h1>
        {data && (
          <span className="text-[11px] text-[var(--text-muted)]">
            {source
              ? `地图 ${source.patch} · 来源标注`
              : `客户端 ${data.clientVersion}`}{" "}
            · {data.imageUrl ? "游戏俯视图" : "地图资源待接入"}
          </span>
        )}
      </div>
      {source && provenance && (
        <details className="mb-3 rounded bg-white/[0.025] px-3 py-2 text-[11px] text-[var(--text-muted)]">
          <summary className="cursor-pointer">
            版本与来源 · 4096 × 4096 · Sloppy / Valve
            {"catalogPatch" in result &&
            result.catalogPatch &&
            result.catalogPatch !== source.patch
              ? ` · 注意：图鉴为 ${result.catalogPatch}`
              : ""}
          </summary>
          <div className="mt-2 space-y-1 break-words leading-5">
            <p>
              地图与点位均由来源标注为 {source.patch}
              。已核对其版本索引、地图哈希声明与实体文件声明一致；本机尚未取得原始
              VPK 独立验证。客户端构建号未提供。
            </p>
            {"catalogPatch" in result && (
              <p>
                当前图鉴：{result.catalogPatch ?? "补丁待确认"} / 客户端{" "}
                {result.catalogClient}；地图版本独立记录。
              </p>
            )}
            <p>
              Steam depot {source.steam_depot} · manifest{" "}
              {source.steam_manifest}
            </p>
            <p className="font-mono text-[10px]">
              地图 SHA-1 {source.map_sha1}
            </p>
            <p>
              <a
                className="underline"
                href={`${provenance.source_repository}/tree/${provenance.source_commit}`}
                target="_blank"
                rel="noreferrer"
              >
                来源快照与署名
              </a>{" "}
              · {source.attribution}
            </p>
          </div>
        </details>
      )}
      {data ? (
        <MapViewer data={data} />
      ) : (
        <section className="grid min-h-[60vh] place-content-center gap-3 bg-[#101a22] p-8 text-center">
          <h2 className="text-base">地图资料尚未接入</h2>
          <p role="status" className="text-sm text-[var(--text-muted)]">
            {error ?? "接入对应版本的地图资源后，可浏览地形与关键点位。"}
          </p>
        </section>
      )}
    </main>
  );
}
