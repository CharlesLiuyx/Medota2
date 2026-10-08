import labels from "@/data/attribute-parameters/field-labels.v1.json";
import inventory from "@/data/attribute-parameters/field-bindings.v1.json";
import type { AttributeRelation } from "./attributes";

type Label = { zh: string; confidence: string; rationale: string };
type Binding = { kind: string; field: string; owners: string[] };
const vocabulary: Record<string, Label> = labels.labels;
const snapshots: Array<{
  source_commit: string;
  bindings: Record<string, Binding>;
}> = inventory.snapshots;
const ownersByCommit = new Map(
  snapshots.map((snapshot) => [
    snapshot.source_commit,
    new Map(
      Object.entries(snapshot.bindings).map(([key, binding]) => [
        key,
        new Set(binding.owners),
      ]),
    ),
  ]),
);

/** Explicit field vocabulary, fixed source commit and audited owner membership. */
export function attributeFieldLabel(
  sourceCommit: string,
  kind: AttributeRelation["kind"],
  owner: string,
  field: string,
) {
  const bindings = ownersByCommit.get(sourceCommit);
  const key = [`${kind}.${owner}.${field}`, `${kind}.${field}`].find(
    (candidate) => bindings?.get(candidate)?.has(owner),
  );
  if (!key) return undefined;
  const label = vocabulary[key];
  if (!label) return undefined;
  const confidence = (
    { high: "高", medium: "中", low: "低" } as Record<string, string>
  )[label.confidence];
  return {
    zh: label.zh,
    note: {
      zh: `中文名称由GPT-6-Luna结合原变量名、同版本字段与对象语境推定；把握程度：${confidence}。${label.rationale} 名称释义不证明当前效果、单位或引擎机制。`,
      en: `Chinese name inferred by GPT-6-Luna from the original variable and same-version field/object context; confidence: ${label.confidence}. Naming does not verify current effects, units or engine mechanics.`,
    },
  };
}

export function attributeFieldLabelProvenance(sourceCommit: string) {
  const snapshot = labels.snapshots.find(
    (row) => row.source_commit === sourceCommit,
  );
  return snapshot
    ? {
        source_repository: labels.source_repository,
        source_commit: sourceCommit,
        client_version: snapshot.client_version,
        imported_at: labels.imported_at,
        importer_version: labels.importer_version,
        schema_version: labels.schema_version,
        content_sha256: labels.contentSha256,
        bindings_sha256: labels.bindingsSha256,
        raw_title_count: snapshot.rawTitleCount,
        raw_relation_count: snapshot.rawRelationCount,
        verified_bindings: snapshot.verifiedBindings,
        source_files: snapshot.sourceFiles,
      }
    : null;
}
