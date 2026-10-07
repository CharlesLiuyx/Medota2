import { canonicalJson } from "@/lib/hash";
export const ENTITY_DIFF_VERSION = "entity-diff-v1";
export const ENTITY_KINDS = [
  "hero",
  "ability",
  "facet",
  "unit",
  "map_object",
  "map_region",
  "relation",
  "mechanism",
  "localization",
  "asset_binding",
  "source_structure",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
export interface SourceEvidence {
  repository: string;
  commit: string | null;
  path: string;
  line: number | null;
  sha256: string | null;
  clientVersion: string | null;
}
export interface EntityVersionState {
  key: string;
  fields: Record<string, unknown>;
  sources: SourceEvidence[];
  review?: string;
}
export interface EntityCoverage {
  status: "complete" | "partial" | "unavailable";
  reason: string | null;
  identityScheme: string;
  entities: EntityVersionState[];
}
export interface EntityVersionSnapshot {
  version: string;
  implementation: Record<string, string>;
  groups: Partial<Record<EntityKind, EntityCoverage>>;
}
export type DiffValue =
  { status: "absent" } | { status: "value"; value: unknown };
export interface EntityVersionChange {
  entityType: EntityKind;
  entityKey: string;
  category:
    "entity" | "property" | "relation" | "mechanism" | "source_structure";
  operation: "added" | "removed" | "modified";
  path: string;
  before: DiffValue;
  after: DiffValue;
  beforeSources: SourceEvidence[];
  afterSources: SourceEvidence[];
  review: string | null;
}
export interface EntityVersionDiff {
  fromVersion: string;
  toVersion: string;
  diffVersion: typeof ENTITY_DIFF_VERSION;
  status: "changed" | "unchanged" | "partial" | "incomparable";
  implementationChanges: {
    before: Record<string, string>;
    after: Record<string, string>;
  } | null;
  coverage: Array<{
    entityType: EntityKind;
    status: "comparable" | "partial" | "incomparable";
    reason: string | null;
  }>;
  changes: EntityVersionChange[];
  unresolved: Array<{
    entityType: EntityKind;
    entityKey: string;
    reason: string;
    sources: SourceEvidence[];
  }>;
}
const sortKeys = (values: Iterable<string>) => [...new Set(values)].sort();
function indexEntities(group: EntityCoverage) {
  const index = new Map<string, EntityVersionState>();
  for (const entity of group.entities) {
    if (index.has(entity.key))
      throw new Error(`Duplicate entity identity: ${entity.key}`);
    index.set(entity.key, entity);
  }
  return index;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const absent: DiffValue = { status: "absent" };
const value = (v: unknown): DiffValue => ({ status: "value", value: v });
/** Endpoint comparison; intermediate additions/reversions never leak into A → C. */
export function compareEntityVersions(
  from: EntityVersionSnapshot,
  to: EntityVersionSnapshot,
): EntityVersionDiff {
  const implementationChanges =
    canonicalJson(from.implementation) === canonicalJson(to.implementation)
      ? null
      : { before: from.implementation, after: to.implementation };
  const result: EntityVersionDiff = {
    fromVersion: from.version,
    toVersion: to.version,
    diffVersion: ENTITY_DIFF_VERSION,
    status: "unchanged",
    implementationChanges,
    coverage: [],
    changes: [],
    unresolved: [],
  };
  for (const kind of ENTITY_KINDS) {
    const a = from.groups[kind],
      b = to.groups[kind];
    // Validate identities even if the other side has no coverage.
    const before = a ? indexEntities(a) : new Map<string, EntityVersionState>();
    const after = b ? indexEntities(b) : new Map<string, EntityVersionState>();
    for (const state of [...before.values(), ...after.values()])
      if (state.review)
        result.unresolved.push({
          entityType: kind,
          entityKey: state.key,
          reason: state.review,
          sources: state.sources,
        });
    if (
      !a ||
      !b ||
      a.status === "unavailable" ||
      b.status === "unavailable" ||
      a.identityScheme !== b.identityScheme
    ) {
      result.coverage.push({
        entityType: kind,
        status: "incomparable",
        reason:
          a?.identityScheme !== b?.identityScheme && a && b
            ? "跨版本身份规则不同，需核对对应关系。"
            : [...new Set([a?.reason, b?.reason].filter(Boolean))].join("；") ||
              "版本没有共同资料覆盖。",
      });
      continue;
    }
    const partial = a.status !== "complete" || b.status !== "complete";
    result.coverage.push({
      entityType: kind,
      status: partial ? "partial" : "comparable",
      reason: partial
        ? [...new Set([a.reason, b.reason].filter(Boolean))].join("；")
        : null,
    });
    for (const key of sortKeys([...before.keys(), ...after.keys()])) {
      const left = before.get(key),
        right = after.get(key);
      const category =
        kind === "relation" ||
        kind === "mechanism" ||
        kind === "source_structure"
          ? kind
          : "property";
      const emit = (
        path: string,
        old: DiffValue,
        next: DiffValue,
        whole = false,
      ) =>
        result.changes.push({
          entityType: kind,
          entityKey: key,
          category: whole && category === "property" ? "entity" : category,
          operation:
            old.status === "absent"
              ? "added"
              : next.status === "absent"
                ? "removed"
                : "modified",
          path,
          before: old,
          after: next,
          beforeSources: left?.sources ?? [],
          afterSources: right?.sources ?? [],
          review:
            left?.review ||
            right?.review ||
            (implementationChanges
              ? "解析／模型实现已变化，需确认是否为游戏变化。"
              : null),
        });
      if (!left || !right) {
        if (partial) {
          result.unresolved.push({
            entityType: kind,
            entityKey: key,
            reason: "覆盖不完整，无法确认实体新增或删除。",
            sources: left?.sources ?? right?.sources ?? [],
          });
          continue;
        }
        emit(
          "",
          left ? value(left.fields) : absent,
          right ? value(right.fields) : absent,
          true,
        );
        continue;
      }
      const walk = (
        old: Record<string, unknown>,
        next: Record<string, unknown>,
        path: string,
      ) => {
        for (const field of sortKeys([
          ...Object.keys(old),
          ...Object.keys(next),
        ])) {
          const p = `${path}/${field.replace(/~/gu, "~0").replace(/\//gu, "~1")}`;
          const hasOld = Object.hasOwn(old, field),
            hasNext = Object.hasOwn(next, field);
          if (!hasOld || !hasNext)
            emit(
              p,
              hasOld ? value(old[field]) : absent,
              hasNext ? value(next[field]) : absent,
            );
          else if (object(old[field]) && object(next[field]))
            walk(old[field], next[field], p);
          else if (canonicalJson(old[field]) !== canonicalJson(next[field]))
            emit(p, value(old[field]), value(next[field]));
        }
      };
      walk(left.fields, right.fields, "");
    }
  }
  result.unresolved = [
    ...new Map(
      result.unresolved.map((u) => [
        JSON.stringify([u.entityType, u.entityKey, u.reason, u.sources]),
        u,
      ]),
    ).values(),
  ].sort((a, b) =>
    `${a.entityType}:${a.entityKey}:${a.reason}`.localeCompare(
      `${b.entityType}:${b.entityKey}:${b.reason}`,
    ),
  );
  const common = result.coverage.filter((c) => c.status !== "incomparable");
  result.status =
    common.length === 0
      ? "incomparable"
      : result.coverage.some((c) => c.status !== "comparable") ||
          result.unresolved.length > 0 ||
          implementationChanges
        ? "partial"
        : result.changes.length
          ? "changed"
          : "unchanged";
  return result;
}
