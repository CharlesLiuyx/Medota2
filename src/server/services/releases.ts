import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { ReleaseIndex, ReleaseOption } from "@/domain/releases";
import { canonicalReleaseId, readReleaseParameter } from "@/domain/releases";
import { getWebDatabase } from "@/server/db/client";
import { getMapVersions } from "@/server/map/store";
import { getGameplayVersion } from "./gameplay-version";
import type { SearchParams } from "./hero-filters";

export const getReleaseIndex = cache(
  async function getReleaseIndex(): Promise<ReleaseIndex> {
    const maps = await getMapVersions();
    const mapOnly = process.env.MEDOTA2_WORKBENCH_MAPS_ONLY === "1";
    const catalogs = mapOnly
      ? []
      : (
          await (
            await getWebDatabase()
          ).query<{
            id: string;
            client: string;
            commit: string;
            current: boolean;
            imported_at: Date;
          }>(`SELECT v.id, s.client_version AS client, s.source_commit AS commit, s.imported_at,
       EXISTS (SELECT 1 FROM dataset_heads h WHERE h.dataset_key='hero_catalog' AND h.catalog_dataset_version_id=v.id) AS current
     FROM hero_catalog_dataset_versions v JOIN source_snapshots s ON s.id=v.source_snapshot_id
     WHERE v.promoted_at IS NOT NULL AND v.gate_status <> 'red'
       AND v.review_status IN ('not_required','approved')
     ORDER BY v.promoted_at DESC, v.id`)
        ).rows;
    const releases: ReleaseOption[] = await Promise.all(
      catalogs.map(async (catalog) => {
        const patch = await getGameplayVersion(catalog.id, catalog.commit);
        const matching = patch
          ? (maps?.versions.filter((m) => m.patch === patch) ?? [])
          : [];
        const map = matching.length === 1 ? matching[0] : null;
        return {
          id: `c:${catalog.id}`,
          patch,
          label: `${patch ?? "补丁未知"} · ${catalog.client}`,
          catalogId: catalog.id,
          mapId: map?.id ?? null,
          catalogClient: catalog.client,
          mapClient: map?.clientVersion ?? null,
          sourceCommit: catalog.commit,
          mapReason: map
            ? null
            : matching.length > 1
              ? "该补丁有多份地图，关联待核对。"
              : "该版本的地图资料未收录或补丁关联未知。",
        };
      }),
    );
    for (const release of releases) {
      if (
        releases.filter(
          (r) =>
            r.patch === release.patch &&
            r.catalogClient === release.catalogClient,
        ).length > 1
      ) {
        const catalog = catalogs.find((c) => c.id === release.catalogId)!;
        release.label += ` · ${catalog.imported_at.toISOString()}`;
      }
    }
    const aliases: Record<string, string> = {};
    for (const map of maps?.versions ?? []) {
      const matching = releases.filter((release) => release.mapId === map.id);
      if (matching.length === 1) aliases[`m:${map.id}`] = matching[0].id;
      // A deliberately isolated map workbench is separate from product releases.
      if (mapOnly)
        releases.push({
          id: `m:${map.id}`,
          patch: map.patch,
          label: `${map.patch}${map.clientVersion ? ` · ${map.clientVersion}` : ""}`,
          catalogId: null,
          mapId: map.id,
          catalogClient: null,
          mapClient: map.clientVersion,
          sourceCommit: null,
          mapReason: null,
        });
    }
    const current = catalogs.find((c) => c.current);
    return {
      defaultRelease: current
        ? `c:${current.id}`
        : (releases.find((r) => r.mapId === maps?.defaultVersion)?.id ?? null),
      releases,
      aliases,
    };
  },
);

export async function resolveRelease(
  value: string | string[] | undefined,
): Promise<ReleaseOption | null> {
  let id: string | undefined;
  try {
    id = readReleaseParameter(value);
  } catch {
    notFound();
  }
  const index = await getReleaseIndex();
  const selected = index.releases.find(
    (r) => r.id === (id ? canonicalReleaseId(index, id) : index.defaultRelease),
  );
  if (id && !selected) notFound();
  return selected ?? null;
}

/** Canonical URLs pin the read context before any entity query. */
export async function resolvePageRelease(path: string, params: SearchParams) {
  const selected = await resolveRelease(params.release);
  if (selected && params.release !== selected.id) {
    const query = new URLSearchParams(
      Object.entries(params).flatMap(([k, v]) =>
        v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((s) => [k, s]),
      ),
    );
    query.set("release", selected.id);
    redirect(`${path}?${query}`);
  }
  return selected;
}
