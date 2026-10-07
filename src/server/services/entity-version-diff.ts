import { withoutSourceLayout } from "@/importers/keyvalues/data";
import "server-only";
import { cache } from "react";
import {
  compareEntityVersions,
  type EntityCoverage,
  type EntityKind,
  type EntityVersionSnapshot,
  type EntityVersionState,
  type SourceEvidence,
} from "@/domain/entity-version-diff";
import { getWebDatabase } from "@/server/db/client";
import { getCatalogMeta } from "@/server/repositories/heroes";
import { readUnitSnapshot } from "@/server/repositories/units";
import { readMapPackage } from "@/server/map/store";
import { getReleaseIndex } from "./releases";
import { canonicalJsonSha256 } from "@/lib/hash";
import { UNIT_ADAPTER_VERSION } from "@/importers/dota-vpk/unit-adapter";

type Row = Record<string, unknown>;
const omit = (row: Row, keys: string[]) =>
  Object.fromEntries(
    Object.entries(row).filter(([key]) => !keys.includes(key)),
  );
const group = (
  identityScheme: string,
  entities: EntityVersionState[],
  reason: string | null = null,
): EntityCoverage => ({
  identityScheme,
  entities,
  status: reason ? "partial" : "complete",
  reason,
});

export const readEntityVersion = cache(async function readEntityVersion(
  id: string,
): Promise<EntityVersionSnapshot> {
  const release = (await getReleaseIndex()).releases.find((r) => r.id === id);
  if (!release) throw new Error("版本未收录或未获准浏览。");
  const snapshot: EntityVersionSnapshot = {
    version: id,
    implementation: { projection: "entity-projection-v3" },
    groups: {},
  };
  const meta = release.catalogId
    ? await getCatalogMeta(release.catalogId)
    : null;
  if (meta) {
    const db = await getWebDatabase();
    snapshot.implementation.catalogImporter = meta.importerVersion;
    snapshot.implementation.catalogSchema = meta.schemaVersion;
    const specs: Array<{
      kind: EntityKind;
      table: string;
      identity: (r: Row) => string;
      omit?: string[];
      path?: string;
    }> = [
      {
        kind: "hero",
        table: "heroes",
        identity: (r) => String(r.internal_name),
        path: "scripts/npc/npc_heroes.txt",
      },
      {
        kind: "ability",
        table: "abilities",
        identity: (r) => String(r.internal_name),
        omit: ["raw_sha256", "resolved_sha256", "unknown_fields"],
      },
      {
        kind: "facet",
        table: "facets",
        identity: (r) => `${r.hero_id}:${r.facet_key}`,
      },
      {
        kind: "relation",
        table: "hero_ability_bindings",
        identity: (r) =>
          `hero-ability:${r.hero_id}:${r.relation_kind}:${r.relation_kind === "declared_in_hero_file" ? "declaration" : r.source_slot}:${r.ability_internal_name}`,
        // Binding ordinal is a slot number or a source line; source_slot carries the actual slot identity.
        omit: ["derivation_version", "ordinal"],
      },
      {
        kind: "relation",
        table: "facet_ability_bindings",
        identity: (r) =>
          `facet-ability:${r.hero_id}:${r.facet_key}:${r.ability_internal_name}`,
      },
      {
        kind: "relation",
        table: "ability_id_mappings",
        identity: (r) => `ability-id:${r.internal_name}:${r.ability_id}`,
        omit: ["id"],
      },
      {
        kind: "relation",
        table: "hero_roles",
        identity: (r) => `hero-role:${r.hero_id}:${r.role}`,
        path: "scripts/npc/npc_heroes.txt",
      },
      {
        kind: "localization",
        table: "hero_localizations",
        identity: (r) => `hero:${r.hero_id}:${r.locale}`,
      },
      {
        kind: "localization",
        table: "ability_localizations",
        identity: (r) => `ability:${r.ability_internal_name}:${r.locale}`,
      },
    ];
    const [tables, sourceRows, files, values, assets] = await Promise.all([
      Promise.all(
        specs.map((s) =>
          db.query<Row>(
            `SELECT * FROM ${s.table} WHERE dataset_version_id=$1`,
            [meta.datasetVersionId],
          ),
        ),
      ),
      db.query<Row>(
        "SELECT * FROM entity_source_records WHERE dataset_version_id=$1 ORDER BY occurrence_ordinal",
        [meta.datasetVersionId],
      ),
      db.query<{ source_path: string; raw_sha256: string }>(
        "SELECT f.source_path,f.raw_sha256 FROM source_snapshot_files f JOIN hero_catalog_dataset_versions v ON v.source_snapshot_id=f.source_snapshot_id WHERE v.id=$1",
        [meta.datasetVersionId],
      ),
      db.query<Row>(
        "SELECT * FROM ability_values WHERE dataset_version_id=$1 ORDER BY ability_internal_name,ordinal",
        [meta.datasetVersionId],
      ),
      db.query<Row>(
        "SELECT b.*, o.logical_path, o.source_repository, o.source_commit, o.client_version, o.source_content_sha256, o.original_blob_sha256 FROM entity_asset_bindings b JOIN asset_objects o ON o.id=b.asset_object_id WHERE b.asset_dataset_version_id=$1",
        [meta.assetDatasetVersionId],
      ),
    ]);
    const evidence = (row: Row, path?: string): SourceEvidence => {
      const sourcePath =
        path ??
        String(
          row.source_path ??
            row.name_source_path ??
            "scripts/npc/npc_abilities.txt",
        );
      return {
        repository: meta.sourceRepository,
        commit: meta.sourceCommit,
        path: sourcePath,
        line: typeof row.source_line === "number" ? row.source_line : null,
        sha256:
          files.rows.find((f) => f.source_path === sourcePath)?.raw_sha256 ??
          null,
        clientVersion: meta.clientVersion,
      };
    };
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const entities = tables[i].rows.map((row) => {
        const sources =
          spec.kind === "hero" || spec.kind === "ability"
            ? sourceRows.rows.filter(
                (s) =>
                  s.entity_type === spec.kind &&
                  s.entity_key === row.internal_name,
              )
            : [];
        return {
          key: spec.identity(row),
          fields: withoutSourceLayout(
            omit(row, [
              "dataset_version_id",
              "source_path",
              "source_line",
              ...(spec.omit ?? []),
              ...(spec.table === "hero_ability_bindings" &&
              row.relation_kind === "declared_in_hero_file"
                ? ["source_slot", "ordinal"]
                : []),
            ]),
          ) as Row,
          sources: sources.length
            ? sources.map((s) => evidence(s))
            : [evidence(row, spec.path)],
        };
      });
      const old = snapshot.groups[spec.kind]?.entities ?? [];
      snapshot.groups[spec.kind] = group(`${spec.kind}-source-identity-v1`, [
        ...old,
        ...entities,
      ]);
    }
    const abilityGroup = snapshot.groups.ability!;
    for (const entity of abilityGroup.entities) {
      entity.fields.values = Object.fromEntries(
        values.rows
          .filter((v) => v.ability_internal_name === entity.key)
          .map((v) => [
            `${v.ordinal}:${v.value_key}`,
            withoutSourceLayout(
              omit(v, [
                "dataset_version_id",
                "ability_internal_name",
                "raw_value",
              ]),
            ),
          ]),
      );
    }
    // Unknown raw structures are review records, never claims of a new engine mechanic.
    snapshot.groups.source_structure = group(
      "catalog-occurrence-v1",
      sourceRows.rows.map((r) => ({
        key: `${r.entity_type}:${r.entity_key}:${r.occurrence_ordinal}`,
        fields: {
          unknownFields: r.unknown_fields,
          raw: withoutSourceLayout(
            r.entity_type === "hero"
              ? omit(r.raw_definition as Row, ["sourcePath", "sourceLine"])
              : r.raw_definition,
          ),
        },
        sources: [evidence(r)],
        review: (r.unknown_fields as string[]).length
          ? "来源含未解释字段，需核对其游戏含义。"
          : undefined,
      })),
    );
    snapshot.groups.mechanism = group(
      "ability-modifier-v1",
      values.rows
        .filter((v) => Array.isArray(v.modifiers) && v.modifiers.length > 0)
        .map((v) => ({
          key: `ability-modifier:${v.ability_internal_name}:${v.ordinal}:${v.value_key}`,
          fields: {
            ability: v.ability_internal_name,
            valueKey: v.value_key,
            modifiers: withoutSourceLayout(v.modifiers),
          },
          sources: sourceRows.rows
            .filter(
              (r) =>
                r.entity_type === "ability" &&
                r.entity_key === v.ability_internal_name,
            )
            .map((r) => evidence(r)),
        })),
      "仅覆盖已解析技能数值修饰条件；完整引擎／脚本机制未建模。",
    );
    snapshot.groups.asset_binding = group(
      "catalog-asset-binding-v1",
      assets.rows.map((r) => ({
        key: `${r.entity_type}:${r.entity_key}:${r.asset_kind}`,
        fields: omit(r, [
          "asset_dataset_version_id",
          "asset_object_id",
          "source_repository",
          "source_commit",
          "client_version",
        ]),
        sources: [
          {
            repository: String(r.source_repository ?? "unknown"),
            commit: r.source_commit as string | null,
            path: String(r.logical_path),
            line: null,
            sha256: (r.source_content_sha256 ??
              r.original_blob_sha256) as string,
            clientVersion: r.client_version as string | null,
          },
        ],
      })),
      "图片绑定为独立资料变化；原始图片版本不代表游戏构建。",
    );
    const units = await readUnitSnapshot(meta);
    if (units) {
      snapshot.implementation.unitAdapter = UNIT_ADAPTER_VERSION;
      const p = units.provenance as {
        files: Array<{ source_path: string; raw_sha256: string }>;
      };
      snapshot.groups.unit = group(
        "unit-internal-name-v1",
        units.units.map((u) => ({
          key: u.internalName,
          fields: { ...u },
          sources: p.files.map((f) => ({
            ...evidence({ source_path: f.source_path }),
            sha256: f.raw_sha256,
          })),
        })),
      );
      // Preserve the full KV document, including fields unsupported by the read model.
      snapshot.groups.source_structure.entities.push({
        key: "unit:raw-definitions",
        fields: { raw: units.raw },
        sources: p.files.map((f) => ({
          ...evidence({ source_path: f.source_path }),
          sha256: f.raw_sha256,
        })),
        review: "单位原始定义保留；未解析规则需要人工解释。",
      });
    } else
      snapshot.groups.unit = {
        status: "unavailable",
        reason: "该Catalog的固定单位来源未接入。",
        identityScheme: "unit-internal-name-v1",
        entities: [],
      };
  }
  if (release.mapId) {
    const pkg = await readMapPackage(release.mapId);
    if (!pkg) throw new Error("所选地图包不可用。");
    const p = pkg.map.provenance;
    snapshot.implementation.mapImporter = p.importer_version;
    snapshot.implementation.mapSchema = p.schema_version;
    const sources: SourceEvidence[] = p.source_path.map((path) => ({
      repository: p.source_repository,
      commit: p.source_commit,
      path,
      line: null,
      sha256: p.files.find((f) => f.path === path)?.sha256 ?? null,
      clientVersion: p.client_version,
    }));
    const counts = new Map<string, number>();
    for (const point of pkg.map.points) {
      const name = point.properties.targetname || point.properties.volumename;
      if (name)
        counts.set(
          `${point.sourceClass}:${name}`,
          (counts.get(`${point.sourceClass}:${name}`) ?? 0) + 1,
        );
    }
    snapshot.groups.map_object = group(
      "map-targetname-v1",
      pkg.map.points.flatMap((point) => {
        const name = point.properties.targetname || point.properties.volumename;
        const key = `${point.sourceClass}:${name}`;
        if (!name || counts.get(key) !== 1) return [];
        return [
          {
            key,
            fields: omit(point as unknown as Row, ["id", "sourcePath"]),
            sources: sources.map((s) => ({ ...s, path: point.sourcePath })),
          },
        ];
      }),
      "仅匹配唯一类名＋来源targetname/volumename；匿名、重复及跨来源身份待核对，不能据此判定增删。",
    );
    snapshot.groups.map_region = {
      status: "unavailable",
      reason: "当前区域ID依赖提取顺序，跨版本稳定身份未核验。",
      identityScheme: "map-region-pending",
      entities: [],
    };
    // Keep unsupported map structure observable without inventing instance identity.
    const rawMap = {
      points: pkg.map.points,
      zones: pkg.map.zones,
      bounds: pkg.map.bounds,
    };
    const mapRecord = {
      key: "map:raw-structure",
      fields: { sha256: canonicalJsonSha256(rawMap), ...rawMap },
      sources,
      review: "地图原始点位与区域变化保留，实例对应关系待核对。",
    };
    const structures = snapshot.groups.source_structure?.entities ?? [];
    snapshot.groups.source_structure = group("catalog-occurrence-v1", [
      ...structures,
      mapRecord,
    ]);
    if (pkg.map.economy) {
      const e = pkg.map.economy;
      snapshot.implementation.economyRules = e.rulesVersion;
      const mechanisms = snapshot.groups.mechanism?.entities ?? [];
      snapshot.groups.mechanism = group(
        "ability-modifier-v1",
        [
          ...mechanisms,
          {
            key: "map:economy-upgrades",
            fields: {
              neutralUpgrade: e.neutralUpgrade,
              laneUpgrade: e.laneUpgrade ?? null,
            },
            sources: e.sources.map((s) => ({
              repository: s.url,
              commit: null,
              path: s.label,
              line: null,
              sha256: null,
              clientVersion: e.clientVersion,
            })),
          },
        ],
        "仅覆盖已解析技能修饰条件和地图经济成长规则，完整引擎机制未建模。",
      );
    }
  }
  if (snapshot.groups.source_structure) {
    snapshot.groups.source_structure.status = "partial";
    snapshot.groups.source_structure.reason =
      "原始结构范围随Catalog／地图覆盖变化；缺少一侧来源不能判作删除。";
  }
  return snapshot;
});
export async function getEntityVersionDiff(from: string, to: string) {
  const snapshots = await Promise.all([
    readEntityVersion(from),
    readEntityVersion(to),
  ]);
  return compareEntityVersions(snapshots[0], snapshots[1]);
}
