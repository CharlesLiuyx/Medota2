"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "@/i18n/provider";
import type { EntityPreview } from "@/presentation/entity-preview";
interface Details {
  release: string;
  id: string;
  datasetVersionId: string;
  summary: string;
  scope: string;
  unit: string;
  formula: {
    expression: string;
    basis: string;
    note: string;
    url?: string;
  } | null;
  effects: Array<{ label: string; unit: string; expression: string }>;
}
const formulas: Record<string, string> = {
  strength: "每点力量增加 22 点生命上限和 0.1 点/秒生命恢复。",
  agility: "每点敏捷增加 0.16 点护甲和 1 点攻击速度。",
  intelligence:
    "每点智力增加 12 点魔法上限、0.05 点/秒魔法恢复和 0.1 个百分点基础魔法抗性。",
  health: "生命上限 = 基础生命 + 22 × 力量 + 固定生命加成",
  "health-regen": "生命恢复 = 基础生命恢复 + 0.1 × 力量 + 固定生命恢复加成",
  mana: "魔法上限 = 基础魔法 + 12 × 智力 + 固定魔法加成",
  "mana-regen": "魔法恢复 = 基础魔法恢复 + 0.05 × 智力 + 固定魔法恢复加成",
};
export function AttributeSummaryDetails({ entity }: { entity: EntityPreview }) {
  const params = useSearchParams();
  const release =
    new URL(entity.href ?? "", "http://localhost").searchParams.get(
      "release",
    ) ?? params.get("release");
  const t = useTranslations();
  const [attempt, setAttempt] = useState(0);
  const key = `${release}:${entity.key}:${entity.attributeValue ?? ""}`;
  const [result, setResult] = useState<{
    key: string;
    data?: Details;
    error?: boolean;
  }>();
  useEffect(() => {
    if (!release) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ release, id: entity.key });
    if (entity.attributeValue) query.set("value", entity.attributeValue);
    void fetch(`/api/attributes/preview?${query}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as Details;
        if (
          !response.ok ||
          data.release !== release ||
          data.id !== entity.key ||
          (release.startsWith("c:") &&
            data.datasetVersionId !== release.slice(2))
        )
          throw new Error("Invalid attribute preview");
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, error: true });
      });
    return () => controller.abort();
  }, [release, entity.key, entity.attributeValue, key, attempt]);
  const current = result?.key === key ? result : undefined;
  if (!release || current?.error)
    return (
      <p className="mt-2 text-[var(--text-muted)]" role="status">
        {t("属性计算说明暂不可用。")}
        {release && (
          <button
            className="ml-2 underline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("重试")}
          </button>
        )}
      </p>
    );
  if (!current?.data)
    return (
      <p className="mt-2 text-[var(--text-muted)]" role="status">
        {t("正在加载计算说明…")}
      </p>
    );
  const data = current.data;
  const growth = /gain|growth/iu.test(entity.attributeField ?? "");
  return (
    <div
      className="mt-3 space-y-2 border-t border-white/10 pt-2"
      data-attribute-calculation
    >
      {!entity.description && <p>{t(data.summary)}</p>}
      {data.formula ? (
        <>
          <div>
            <strong>{t("计算公式")}</strong>
            {formulas[entity.key] && (
              <p className="mt-1">{t(formulas[entity.key])}</p>
            )}
            <p className="mt-1 break-words font-mono text-[11px] text-[var(--text-secondary)]">
              {data.formula.expression}
            </p>
          </div>
          {!!data.effects.length && (
            <div>
              <strong>
                {t(growth ? "每级成长的基础贡献" : "当前数值的基础贡献")}
              </strong>
              <dl className="mt-1">
                {data.effects.map((effect) => (
                  <div
                    key={effect.label}
                    className="flex flex-wrap justify-between gap-x-3"
                  >
                    <dt>{t(effect.label)}</dt>
                    <dd className="tabular-nums">
                      {effect.expression} {t(effect.unit)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <p className="text-[11px] text-[var(--text-muted)]">
            {t(data.formula.note)}
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">
            {t(data.formula.basis)}
          </p>
        </>
      ) : (
        <p className="text-[var(--text-muted)]">
          {t("当前版本暂无已核对的计算公式。")}
        </p>
      )}
      {data.scope && (
        <p className="text-[11px] text-[var(--text-secondary)]">
          {t(data.scope)}
        </p>
      )}
    </div>
  );
}
