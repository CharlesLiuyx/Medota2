import type { Metadata } from "next";
import { HoverTooltip } from "@/components/ui/hover-tooltip";
import { MapHeaderStatus } from "@/components/map/header-status";
import { MapVersionSelect } from "@/components/map/version-select";
import { notFound, redirect } from "next/navigation";
import { MapViewer } from "@/components/map/map-viewer";
import { getMapPageData, getMapVersions } from "@/server/map/store";
export const metadata: Metadata = { title: "地图" };
export const dynamic = "force-dynamic";
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ version?: string | string[] }>;
}) {
  const query = await searchParams,
    collection = await getMapVersions();
  if (Array.isArray(query.version)) notFound();
  if (collection && !query.version)
    redirect(`/map?version=${encodeURIComponent(collection.defaultVersion)}`);
  if (
    query.version &&
    (!collection || !collection.versions.some((v) => v.id === query.version))
  )
    notFound();
  const result = await getMapPageData(query.version),
    { data, error } = result;
  const provenance = "provenance" in result ? result.provenance : null;
  const source = provenance?.public_source,
    native = provenance?.native_source,
    render = provenance?.render_source;
  const image = "image" in result ? result.image : null;
  const sourceUrl = render
    ? `${render.repository}/tree/${render.commit}`
    : provenance?.source_commit
      ? `${provenance.source_repository}/tree/${provenance.source_commit}`
      : null;
  const versionControls = (
    <div
      key="map-version-controls"
      className="ml-auto flex min-w-0 items-center justify-end gap-2"
    >
      {source && provenance && (
        <HoverTooltip
          className="grid size-6 shrink-0 place-items-center rounded-full border border-white/25 text-xs text-[#c9d7e2] hover:border-white/60 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#a4c5bc]"
          content={
            <div className="text-[11px] leading-5">
              <h2 className="font-semibold text-[#edf5fc]">
                版本与来源 · {image?.width} × {image?.height} ·{" "}
                {native ? "本机游戏实体 / Sloppy 底图" : "Sloppy / Valve"}
              </h2>
              <div className="mt-2 space-y-1 break-words leading-5">
                <p>
                  {native
                    ? `本机客户端 ${provenance.client_version} 的地图字节已核对，与来源标注的 ${source.patch} 地图哈希相同。点位、营地几何和地形图层由本机提取；高清底图采用该版本的固定 SFM 渲染。补丁名来自来源索引，未以安装日期推断版本。`
                    : `地图与点位均由来源标注为 ${source.patch}。已核对版本索引、地图哈希声明与实体声明；本机没有该版本的原始 VPK 独立校验，客户端构建号未知。`}
                </p>
                {"catalogPatch" in result && result.catalogPatch && (
                  <p>
                    图鉴：{result.catalogPatch} / 客户端 {result.catalogClient}
                    ；地图版本独立选择。
                  </p>
                )}
                <p>
                  来源索引：Steam depot {source.steam_depot} · manifest{" "}
                  {source.steam_manifest}（不是本机安装 manifest 的声明）
                </p>
                {native && (
                  <p>
                    客户端 SourceRevision {native.source_revision} · 初始实体层{" "}
                    {native.active_layers.length} · 未激活层{" "}
                    {native.inactive_layers.length}
                  </p>
                )}
                <p className="font-mono text-[10px]">
                  地图 SHA-1 {source.map_sha1}
                </p>
                <p>
                  {sourceUrl && (
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      版本索引、底图来源与署名
                    </a>
                  )}{" "}
                  · {source.attribution}
                </p>
                <p>
                  各版本拥有独立资源、坐标和校验值。链接可收藏；同名点位在不同版本中不自动视为同一状态。
                </p>
              </div>
            </div>
          }
        >
          <span aria-hidden="true">?</span>
          <span className="sr-only">地图版本与来源说明</span>
        </HoverTooltip>
      )}
      {collection && (
        <MapVersionSelect
          versions={collection.versions}
          selected={query.version ?? collection.defaultVersion}
        />
      )}
    </div>
  );
  return (
    <main className="map-page mx-auto max-w-[var(--content-max)] px-4 py-2 sm:px-6">
      <h1 className="sr-only">地图</h1>
      {source && <MapHeaderStatus patch={source.patch} verified={!!native} />}
      {data ? (
        <MapViewer
          key={
            "revision" in result ? result.revision : (query.version ?? "map")
          }
          data={data}
          versionControls={versionControls}
        />
      ) : (
        <>
          {versionControls}
          <section className="grid min-h-[60vh] place-content-center gap-3 bg-[#101a22] p-8 text-center">
            <h2 className="text-base">地图资料尚未接入</h2>
            <p role="status" className="text-sm text-[var(--text-muted)]">
              {error ?? "接入对应版本的地图资源后，可浏览地形与关键点位。"}
            </p>
          </section>
        </>
      )}
    </main>
  );
}
