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
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        {(compact ? item.stats.slice(0, 6) : item.stats).map((stat, index) => (
          <div
            key={index}
            className="flex flex-wrap justify-between gap-x-2 gap-y-1"
          >
            <dt className="text-[var(--text-muted)]">
              <AttributeLink
                kind="item"
                owner={item.internalName}
                field={stat.key}
                labelToken={stat.labelToken}
              >
                {t(en ? stat.en : stat.zh)}
              </AttributeLink>
            </dt>
            <dd className="tabular-nums">{t(stat.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
