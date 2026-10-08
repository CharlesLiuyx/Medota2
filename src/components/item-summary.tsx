"use client";
import { SourceText, useTranslations } from "@/i18n/provider";
import { AttributeLink } from "./attribute-link";
import { ITEM_CATEGORIES, type ItemDefinition } from "@/domain/items";
export function ItemSummary({
  item,
  en = false,
  compact = false,
}: {
  item: ItemDefinition;
  en?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations();
  return (
    <div className="space-y-3">
      <p className="text-xs text-[#c4a16a]">
        {t(ITEM_CATEGORIES[item.category])} ·{" "}
        {item.cost === null
          ? t("价格未提供")
          : t("{value0} 金币", {
              value0: item.cost,
            })}
      </p>
      {item.behavior.length > 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          {item.behavior.map((value) => t(value)).join(" · ")}
        </p>
      )}
      <p
        className={`${compact ? "line-clamp-6 text-xs" : "text-sm"} whitespace-pre-line leading-relaxed text-[var(--text-secondary)]`}
      >
        <SourceText sourceLocale={item.descriptionLocales?.[en ? "en" : "zh"]}>
          {(en ? item.descriptions.en : item.descriptions.zh) ||
            t("效果说明待补充")}
        </SourceText>
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {(compact ? item.stats.slice(0, 6) : item.stats).map((stat, index) => (
          <div
            key={index}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_max-content] items-start gap-x-2"
          >
            <dt
              className="min-w-0 [overflow-wrap:anywhere] text-[var(--text-muted)]"
              title={stat.labelNote?.[en ? "en" : "zh"]}
            >
              <AttributeLink
                kind="item"
                owner={item.internalName}
                field={stat.key}
                labelToken={stat.labelToken}
              >
                {t(en ? stat.en : stat.zh)}
              </AttributeLink>
            </dt>
            <dd className="text-right tabular-nums">{t(stat.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
