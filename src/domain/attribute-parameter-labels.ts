import resource from "@/data/attribute-parameters/supplement.v1.json";
import audit from "@/data/attribute-parameters/unresolved.v1.json";

type Label = { zh: string; en: string };
type Evidence = {
  definition: { sourcePath: string; line: number };
  kind: string;
  labels: Array<{ sourcePath: string; line: number; token: string }>;
  references: Array<{ sourcePath: string; line: number; token: string }>;
  context?: { model: string; confidence: string; rationale: string };
};
const parameters: Record<string, Label> = resource.parameters;
const snapshots: Array<{
  source_commit: string;
  evidence: Record<string, Evidence | undefined>;
}> = resource.snapshots;
const byCommit = new Map(snapshots.map((s) => [s.source_commit, s]));
const audits: Array<{
  source_commit: string;
  unresolved: Array<{
    owner: string;
    field: string;
    definition: Evidence["definition"];
  }>;
}> = audit.snapshots;
const unresolved = new Map(
  audits.map((snapshot) => [
    snapshot.source_commit,
    new Map(
      snapshot.unresolved.map((row) => [
        `${row.owner}.${row.field}`,
        row.definition,
      ]),
    ),
  ]),
);

export function unresolvedAttributeParameter(
  sourceCommit: string,
  owner: string,
  field: string,
) {
  const definition = unresolved.get(sourceCommit)?.get(`${owner}.${field}`);
  if (!definition) return undefined;
  const location = `${definition.sourcePath}:${definition.line}`;
  return {
    definition,
    note: {
      zh: `已逐项查询同版本VPK字段定义、中英参数标签、注释和效果说明，尚无足够依据确认精准名称，保留待核验。\n${location}`,
      en: `Searched the same-version VPK definition, English/Chinese labels, comments and effect descriptions. Evidence is insufficient for a precise name; verification remains pending.\n${location}`,
    },
  };
}

/** Only reviewed exact commit/owner/field bindings can supply a missing name. */
export function attributeParameterLabel(
  sourceCommit: string,
  owner: string,
  field: string,
) {
  const key = `${owner}.${field}`;
  const evidence = byCommit.get(sourceCommit)?.evidence[key];
  const label = parameters[key];
  if (!evidence || !label) return undefined;
  const basis =
    evidence.labels[0] ?? evidence.references[0] ?? evidence.definition;
  const location = `${basis.sourcePath}:${basis.line}${"token" in basis ? ` · ${basis.token}` : ""}`;
  const note =
    evidence.kind === "context-inference" && evidence.context
      ? {
          zh: `名称由GPT-6-Luna结合变量名与同版本技能上下文推定；把握程度：${({ high: "高", medium: "中", low: "低" } as Record<string, string>)[evidence.context.confidence]}。${evidence.context.rationale} 实际机制、适用条件、单位与结算方式仍以核验结果为准。`,
          en: `Name inferred by GPT-6-Luna from the variable and same-version ability context; confidence: ${evidence.context.confidence}. Mechanics, conditions, units and calculation require verification.`,
        }
      : evidence.kind === "commented-label"
        ? {
            zh: "名称参考同版本官方注释标签，经项目审阅补充；注释不作为当前数值或机制依据。",
            en: "Project-reviewed name based on a same-version commented label; comments do not establish current values or mechanics.",
          }
        : evidence.kind === "description"
          ? {
              zh: "名称依据同版本效果说明，经项目审阅补充。",
              en: "Project-reviewed name based on the same-version effect description.",
            }
          : evidence.kind === "official-label"
            ? {
                zh: "名称依据同版本官方参数标签。",
                en: "Name based on the same-version official parameter label.",
              }
            : {
                zh: "名称依据同版本字段定义补充；实际机制、适用条件、单位与结算方式待核验。",
                en: "Name derived from the same-version field definition; mechanics, conditions, units and calculation remain unverified.",
              };
  return {
    ...label,
    definition: evidence.definition,
    note: { zh: `${note.zh}\n${location}`, en: `${note.en}\n${location}` },
  };
}
export function attributeParameterProvenance(sourceCommit: string) {
  const snapshot = resource.snapshots.find(
    (s) => s.source_commit === sourceCommit,
  );
  return snapshot
    ? {
        source_repository: resource.source_repository,
        source_commit: sourceCommit,
        client_version: snapshot.client_version,
        imported_at: resource.imported_at,
        importer_version: resource.importer_version,
        schema_version: resource.schema_version,
        content_sha256: resource.contentSha256,
        missing_before: snapshot.missingBefore,
        named: snapshot.named,
        unresolved: snapshot.unresolved,
        files: snapshot.files,
      }
    : null;
}
