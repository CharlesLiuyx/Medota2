import { getTranslations } from "@/i18n/server";
import { Message } from "@/i18n/provider";
import { getRequestLocale } from "@/i18n/server";
import { withLocale } from "@/i18n/locale";
import type { Metadata } from "next";
import { HoverTooltip } from "@/components/ui/hover-tooltip";
import { MapHeaderStatus } from "@/components/map/header-status";
import {
  getReleaseIndex,
  resolvePageRelease,
} from "@/server/services/releases";
import { MissingReleaseCoverage } from "@/components/release-navigation";
import { notFound, redirect } from "next/navigation";
import { MapViewer } from "@/components/map/map-viewer";
import { getMapPageData } from "@/server/map/store";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("地图") };
}
export const dynamic = "force-dynamic";
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{
    version?: string | string[];
    release?: string | string[];
  }>;
}) {
  const t = await getTranslations();
  const query = await searchParams;
  if (Array.isArray(query.version)) notFound();
  if (query.version && !query.release) {
    const index = await getReleaseIndex();
    const legacy = index.releases.find((r) => r.mapId === query.version);
    if (!legacy) notFound();
    redirect(
      withLocale(
        `/map?release=${encodeURIComponent(legacy.id)}`,
        await getRequestLocale(),
      ),
    );
  }
  const selected = await resolvePageRelease("/map", query);
  if (query.version && query.version !== selected?.mapId) notFound();
  if (selected && !selected.mapId)
    return (
      <MissingReleaseCoverage kind={t("地图")} reason={selected.mapReason} />
    );
  const result = await getMapPageData(
      selected?.mapId ?? undefined,
      selected?.catalogId,
    ),
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
                <Message
                  id="版本与来源 · {value0} × {value1} · {value2}"
                  values={{
                    value0: image?.width,
                    value1: image?.height,
                    value2: native
                      ? t("本机游戏实体 / Sloppy 底图")
                      : "Sloppy / Valve",
                  }}
                />
              </h2>
              <div className="mt-2 space-y-1 break-words leading-5">
                <p>
                  {native
                    ? t(
                        "本机客户端 {value0} 的地图字节已核对，与来源标注的 {value1} 地图哈希相同。点位、营地几何和地形图层由本机提取；高清底图采用该版本的固定 SFM 渲染。补丁名来自来源索引，未以安装日期推断版本。",
                        {
                          value0: provenance.client_version,
                          value1: source.patch,
                        },
                      )
                    : t(
                        "地图与点位均由来源标注为 {value0}。已核对版本索引、地图哈希声明与实体声明；本机没有该版本的原始 VPK 独立校验，客户端构建号未知。",
                        {
                          value0: source.patch,
                        },
                      )}
                </p>
                {"catalogPatch" in result && result.catalogPatch && (
                  <p>
                    <Message
                      id="图鉴：{value0} / 客户端 {value1}；地图与图鉴构建号分别记录。"
                      values={{
                        value0: result.catalogPatch,
                        value1: result.catalogClient,
                      }}
                    />
                  </p>
                )}
                <p>
                  <Message
                    id="来源索引：Steam depot {value0} · manifest {value1}（不是本机安装 manifest 的声明）"
                    values={{
                      value0: source.steam_depot,
                      value1: source.steam_manifest,
                    }}
                  />
                </p>
                {native && (
                  <p>
                    <Message
                      id="客户端 SourceRevision {value0} · 初始实体层 {value1} · 未激活层 {value2}"
                      values={{
                        value0: native.source_revision,
                        value1: native.active_layers.length,
                        value2: native.inactive_layers.length,
                      }}
                    />
                  </p>
                )}
                <p className="font-mono text-[10px]">
                  <Message
                    id="地图 SHA-1 {value0}"
                    values={{
                      value0: source.map_sha1,
                    }}
                  />
                </p>
                <p>
                  {sourceUrl && (
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {t("版本索引、底图来源与署名")}
                    </a>
                  )}{" "}
                  · {source.attribution}
                </p>
                <p>
                  {t(
                    "各版本拥有独立资源、坐标和校验值。链接可收藏；同名点位在不同版本中不自动视为同一状态。",
                  )}
                </p>
              </div>
            </div>
          }
        >
          <span aria-hidden="true">?</span>
          <span className="sr-only">{t("地图版本与来源说明")}</span>
        </HoverTooltip>
      )}
    </div>
  );
  return (
    <main className="map-page mx-auto max-w-[var(--content-max)] px-4 py-2 sm:px-6">
      <h1 className="sr-only">{t("地图")}</h1>
      {source && <MapHeaderStatus patch={source.patch} verified={!!native} />}
      {data ? (
        <MapViewer
          key={`${"revision" in result ? result.revision : (query.version ?? "map")}:${selected?.catalogId ?? "none"}`}
          data={data}
          versionControls={versionControls}
        />
      ) : (
        <>
          {versionControls}
          <section className="grid min-h-[60vh] place-content-center gap-3 bg-[#101a22] p-8 text-center">
            <h2 className="text-base">{t("地图资料尚未接入")}</h2>
            <p role="status" className="text-sm text-[var(--text-muted)]">
              {error ?? t("接入对应版本的地图资源后，可浏览地形与关键点位。")}
            </p>
          </section>
        </>
      )}
    </main>
  );
}
