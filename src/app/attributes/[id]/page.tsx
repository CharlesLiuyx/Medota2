import { notFound } from "next/navigation";
import { getTranslations, getRequestGameLocale } from "@/i18n/server";
import { resolvePageRelease } from "@/server/services/releases";
import { MissingReleaseCoverage } from "@/components/release-navigation";
import { getAttributeOverview } from "@/server/repositories/attributes";
import { AttributeRelations } from "@/components/attribute-catalog";
import { AttributeText } from "@/components/attribute-text";
import { AttributeCalculator } from "@/components/attribute-calculator";
import { attributeDefinition } from "@/domain/attributes";
import {
  attributeEvidence,
  attributeFormula,
} from "@/domain/attribute-mechanics";
import { gameText } from "@/presentation/dota";
import Link from "@/components/version-link";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("属性详情") };
}
export default async function AttributePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<import("@/server/services/hero-filters").SearchParams>;
}) {
  const [{ id }, query, t, locale] = await Promise.all([
    params,
    searchParams,
    getTranslations(),
    getRequestGameLocale(),
  ]);
  const selected = await resolvePageRelease(
    `/attributes/${encodeURIComponent(id)}`,
    query,
  );
  if (selected && !selected.catalogId)
    return <MissingReleaseCoverage kind={t("属性")} />;
  const { meta, snapshot } = await getAttributeOverview(
    selected?.catalogId ?? undefined,
  );
  if (!meta || !snapshot) return <MissingReleaseCoverage kind={t("属性")} />;
  const entry = snapshot.entries.find((e) => e.id === id);
  if (!entry) {
    if (snapshot.missing.length)
      return (
        <MissingReleaseCoverage
          kind={t("属性")}
          reason={t("部分关联来源缺失，暂时无法确认该属性。")}
        />
      );
    notFound();
  }
  const textAttributes = snapshot.entries.filter(
    (attribute) => !attribute.id.includes("~"),
  );
  const describe = (text: string) => (
    <AttributeText text={text} locale={locale} attributes={textAttributes} />
  );
  const evidence = attributeEvidence(meta.sourceCommit, entry, locale);
  const formula = attributeFormula(id, meta.sourceCommit);
  const ownerScoped = id.includes("~"),
    first = entry.relations[0];
  return (
    <main className="mx-auto min-h-[70vh] max-w-[var(--content-max)] space-y-5 px-4 py-4 sm:px-6">
      <Link href="/attributes" className="text-xs text-[var(--text-muted)]">
        {t("← 属性图鉴")}
      </Link>
      <header>
        <h1 className="text-xl font-semibold">
          {locale === "en" ? entry.en : entry.zh}
        </h1>
        <p className="mt-1 text-xs text-[#c4a16a]">
          {ownerScoped
            ? locale === "en"
              ? first.en
              : first.zh
            : t("通用属性")}{" "}
          · {t(entry.unit)}
        </p>
      </header>
      {snapshot.missing.length > 0 && (
        <p role="status">
          {t("部分关联来源缺失：{value0}", {
            value0: snapshot.missing.map((s) => t(s)).join("、"),
          })}
        </p>
      )}
      <section className="max-w-4xl space-y-3 bg-[#182127]/65 p-4 text-sm leading-relaxed">
        <h2 className="font-semibold">{t("含义与适用范围")}</h2>
        <p>{describe(t(entry.summary))}</p>
        <p className="text-[var(--text-secondary)]">
          {describe(t(entry.scope))}
        </p>
        {ownerScoped && (
          <>
            <h3 className="text-xs font-semibold">{t("所属对象的效果说明")}</h3>
            <p className="whitespace-pre-line text-xs">
              {describe(
                (locale === "en" ? first.descriptionEn : first.descriptionZh) ||
                  t("来源未提供完整效果说明，单位与结算机制待核验。"),
              )}
            </p>
          </>
        )}
        {entry.related.length > 0 && (
          <div className="flex flex-wrap gap-3 text-xs">
            {entry.related
              .filter((key) => snapshot.entries.some((e) => e.id === key))
              .map((key) => (
                <Link
                  key={key}
                  href={`/attributes/${key}`}
                  className="text-[#c4a16a]"
                >
                  {locale === "en"
                    ? attributeDefinition(key)?.en
                    : attributeDefinition(key)?.zh}
                </Link>
              ))}
          </div>
        )}
      </section>
      {entry.enumValues && (
        <section className="max-w-4xl space-y-3 text-xs">
          <h2 className="text-sm font-semibold">{t("枚举值")}</h2>
          <p className="text-[var(--text-muted)]">
            {t(
              entry.valueType === "flags"
                ? "可组合多个枚举值；缺失字段不等于任何默认值。"
                : "取一个枚举值；缺失字段不等于任何默认值。",
            )}
          </p>
          <dl className="grid gap-2 sm:grid-cols-2">
            {entry.enumValues.map((value) => (
              <div key={value.value} className="space-y-2 bg-[#182127]/65 p-3">
                <dt className="font-semibold text-[#c4a16a]">
                  {locale === "en" ? value.en : value.zh}
                </dt>
                <dd className="break-all font-data text-[var(--text-muted)]">
                  {value.value}
                </dd>
                {value.summary && <dd>{describe(t(value.summary))}</dd>}
                <dd>
                  {t("{value0} 条关联", {
                    value0: entry.relations.filter((r) =>
                      r.value
                        .split("|")
                        .map((v) => v.trim())
                        .includes(value.value),
                    ).length,
                  })}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section className="max-w-4xl space-y-3 bg-[#182127]/65 p-4 text-sm">
        <h2 className="font-semibold">{t("机制与计算")}</h2>
        {entry.enumValues ? (
          <p className="text-xs">
            {t(
              "枚举属性按各取值解释行为；不进行数值相加。具体效果与例外仍以所属对象说明为准。",
            )}
          </p>
        ) : formula ? (
          <>
            <p className="text-xs text-[#c4a16a]">{t(formula.basis)}</p>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words bg-black/15 p-3 font-data text-xs">
              {formula.expression}
            </pre>
            <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
              {describe(t(formula.note))}
            </p>
            {formula.url && (
              <a
                href={formula.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#c4a16a]"
              >
                {t("社区机制参考（查阅于 2026-10-07）")}
              </a>
            )}
            {id === "armor" && <AttributeCalculator />}
          </>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">
            {t(
              "当前证据不足以给出通用结算公式。保留来源数值和条件；需要同版本 Windows 客户端继续核验。",
            )}
          </p>
        )}
      </section>
      {["attack-backswing", "cast-backswing"].includes(id) && (
        <a
          className="block text-xs text-[#c4a16a]"
          href={`https://liquipedia.net/dota2/${id === "attack-backswing" ? "Attack_Animation" : "Cast_Animation"}`}
          target="_blank"
          rel="noreferrer"
        >
          {t("社区机制参考（查阅于 2026-10-07）")}
        </a>
      )}
      <section className="max-w-4xl space-y-3 text-xs">
        <h2 className="text-sm font-semibold">{t("VPK 证据与版本")}</h2>
        <p className="text-[var(--text-muted)]">
          {t("客户端版本 {value0}", { value0: meta.clientVersion })} ·{" "}
          {t("原生定义与本地化文本；文本说明不等于引擎执行验证。")}
        </p>
        {evidence.tokens.map((token) => (
          <div key={token.token} className="space-y-2 bg-[#182127]/65 p-3">
            <p className="text-[#c4a16a]">
              {t(
                token.token.endsWith(".AbilityBehavior")
                  ? "同版行为定义"
                  : token.token.includes("StatTooltip")
                    ? "旧提示文本（存在冲突，不用于公式）"
                    : token.token.startsWith("DOTA_Glossary")
                      ? "游戏术语说明"
                      : token.token.startsWith("DOTA_ToolTip_Dispellable") ||
                          token.token.startsWith("dota_ability_variable") ||
                          token.token.includes("special_bonus_")
                        ? "官方名称依据"
                        : token.token.includes("HeroStats")
                          ? "英雄面板说明"
                          : "所属对象的效果说明",
              )}
            </p>
            <p className="whitespace-pre-line">
              {describe(gameText(token.text, undefined, locale))}
            </p>
            <a
              className="break-all text-[var(--text-muted)]"
              href={`${evidence.snapshot!.source_repository}/blob/${meta.sourceCommit}/${token.source_path}#L${token.line}`}
              target="_blank"
              rel="noreferrer"
            >
              {token.token}
            </a>
          </div>
        ))}
        {!evidence.tokens.length && (
          <p className="text-[var(--text-muted)]">
            {t(
              "该属性暂无已审阅的独立 VPK 机制文本；对象字段与条件见下方关联。",
            )}
          </p>
        )}
        <details>
          <summary className="cursor-pointer text-[var(--text-muted)]">
            {t("查看来源记录")}
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10px]">
            {JSON.stringify(
              {
                source_repository: meta.sourceRepository,
                source_commit: meta.sourceCommit,
                client_version: meta.clientVersion,
                schema_version: snapshot.provenance.schema_version,
                importer_version: snapshot.provenance.importer_version,
                imported_at: snapshot.provenance.imported_at,
                evidence: evidence.file
                  ? {
                      source_path: evidence.file.source_path,
                      raw_sha256: evidence.file.raw_sha256,
                    }
                  : null,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </section>
      <AttributeRelations
        enumValues={entry.enumValues}
        relations={entry.relations.map((r) => ({
          ...r,
          descriptionZh: "",
          descriptionEn: "",
        }))}
        version={`${meta.datasetVersionId}:${id}`}
      />
    </main>
  );
}
