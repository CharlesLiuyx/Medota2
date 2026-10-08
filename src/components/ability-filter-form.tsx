"use client";
import type { ReactNode } from "react";
import { useLocale } from "@/i18n/provider";
import { useTranslations } from "@/i18n/provider";
import { CompactSelect } from "./ui/compact-select";
import { relationLabel } from "@/presentation/dota";
import { useFilterEvents } from "./use-live-catalog";
import { Search, X } from "lucide-react";
import type { AbilityFilters } from "@/server/services/ability-filters";
export function AbilityFilterForm({
  filters,
  status,
  onChange,
  onClear,
  heroes = [],
}: {
  status?: ReactNode;
  filters: AbilityFilters;
  onChange: (data: FormData, composing: boolean) => void;
  onClear: () => void;
  heroes?: Array<{
    slug: string;
    zhName: string;
    enName: string;
  }>;
}) {
  const locale = useLocale();
  const t = useTranslations();
  const events = useFilterEvents(onChange);
  return (
    <form
      autoComplete="off"
      onCompositionStart={events.onCompositionStart}
      onCompositionEnd={events.onCompositionEnd}
      onSubmit={events.onSubmit}
      action="/abilities"
      className="flex flex-wrap items-center gap-1.5"
    >
      <div className="contents">
        <input type="hidden" name="lang" value={locale} />
        <input type="hidden" name="behavior" value={filters.behavior} />
        <input type="hidden" name="damage" value={filters.damage} />
        <label className="relative min-w-0 basis-full sm:w-60 sm:flex-none sm:basis-auto">
          <Search className="absolute left-1.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <span className="sr-only">{t("搜索技能")}</span>
          <input
            name="q"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={filters.q}
            onChange={events.onFieldChange}
            maxLength={100}
            placeholder={t("搜索技能名称、拼音或别称…")}
            className="h-8 w-full bg-transparent pl-7 pr-2 text-xs placeholder:text-[var(--text-muted)]"
          />
        </label>
        {status}
        <CompactSelect
          onChange={onChange}
          name="status"
          label={t("状态")}
          value={filters.status}
        >
          <option value="current">{t("当前技能")}</option>
          <option value="indirect">{t("关联技能")}</option>
          <option value="defined_unbound">{t("其他技能")}</option>
          <option value="template">{t("技能模板")}</option>
          <option value="deprecated">{t("历史技能")}</option>
          <option value="all">{t("全部")}</option>
        </CompactSelect>
        <CompactSelect
          onChange={onChange}
          name="relation"
          label={t("关系")}
          value={filters.relation}
        >
          <option value="all">{t("全部关系")}</option>
          {[
            "loadout",
            "talent",
            "draft",
            "facet",
            "linked",
            "sub_ability",
            "upgrade_granted",
            "declared_in_hero_file",
          ].map((value) => (
            <option key={value} value={value}>
              {relationLabel(value, locale)}
            </option>
          ))}
        </CompactSelect>
        <CompactSelect
          onChange={onChange}
          name="upgrade"
          label={t("升级")}
          value={filters.upgrade}
        >
          <option value="all">{t("全部")}</option>
          <option value="scepter">{t("阿哈利姆神杖")}</option>
          <option value="shard">{t("阿哈利姆魔晶")}</option>
          <option value="granted">{t("升级解锁技能")}</option>
        </CompactSelect>
        <CompactSelect
          onChange={onChange}
          name="hero"
          label={t("英雄")}
          value={filters.hero}
        >
          <option value="">{t("全部英雄")}</option>
          {heroes.map((hero) => (
            <option key={hero.slug} value={hero.slug}>
              {filters.lang === "en" ? hero.enName : hero.zhName}
            </option>
          ))}
        </CompactSelect>
      </div>
      {(filters.q ||
        filters.status !== "current" ||
        filters.hero ||
        filters.behavior ||
        filters.damage ||
        filters.relation !== "all" ||
        filters.upgrade !== "all") && (
        <div className="flex h-7 items-center px-1.5">
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="size-3.5" /> {t("清除全部")}
          </button>
        </div>
      )}
    </form>
  );
}
