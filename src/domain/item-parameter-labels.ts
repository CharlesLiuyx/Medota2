import resource from "@/data/item-parameters/supplement.v1.json";

type Label = { zh: string; en: string; unit: string };
type Evidence = {
  definitionLine: number;
  kind: string;
  token?: string;
  textLine?: number;
  commentedLabel?: string;
};
const parameters: Record<string, Label> = resource.parameters;
const snapshots: Array<{
  source_commit: string;
  evidence: Record<string, Evidence>;
}> = resource.snapshots;

export function itemParameterLabel(
  sourceCommit: string | undefined,
  owner: string,
  field: string,
) {
  const id = `${owner}.${field}`;
  const evidence = snapshots.find((s) => s.source_commit === sourceCommit)
    ?.evidence[id];
  const label = parameters[id];
  if (!evidence || !label) return undefined;
  const unitZh =
    label.unit === "s" ? "（秒）" : label.unit === "min" ? "（分钟）" : "";
  const unitEn =
    label.unit === "s" ? " (s)" : label.unit === "min" ? " (min)" : "";
  const note =
    evidence.kind === "definition"
      ? {
          zh: "名称依据同版本字段定义补充；实际机制、适用条件与结算方式待核验。",
          en: "Label derived from the same-version field definition; mechanics, conditions and calculation remain unverified.",
        }
      : evidence.kind === "commented-label"
        ? {
            zh: "名称参考同版本注释标签，经项目审阅补充；注释不作为当前数值或机制依据。",
            en: "Project-reviewed label informed by a same-version commented label; comments do not establish current values or mechanics.",
          }
        : {
            zh: "名称依据同版本效果说明，经项目审阅补充。",
            en: "Project-reviewed label based on the same-version effect description.",
          };
  return { ...label, zh: label.zh + unitZh, en: label.en + unitEn, note };
}

export function itemParameterProvenance(sourceCommit: string) {
  const snapshot = resource.snapshots.find(
    (s) => s.source_commit === sourceCommit,
  );
  return snapshot
    ? {
        id: resource.id,
        content_sha256: resource.contentSha256,
        source_repository: resource.source_repository,
        source_commit: sourceCommit,
        client_version: snapshot.client_version,
        imported_at: resource.imported_at,
        importer_version: resource.importer_version,
        schema_version: resource.schema_version,
        files: snapshot.files,
      }
    : null;
}
