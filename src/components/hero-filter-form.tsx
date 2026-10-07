"use client";
import { useFilterEvents } from "./use-live-catalog";
import { Search, X } from "lucide-react";
import type { HeroFilters } from "@/server/services/hero-filters";
import { useLocale, useTranslations } from "@/i18n/provider";
import { CompactSelect } from "./ui/compact-select";
import { CompactFilterMenu } from "./ui/compact-filter-menu";

const attributes = [
  ["strength", "力量"],
  ["agility", "敏捷"],
  ["intelligence", "智力"],
  ["universal", "全才"],
] as const;
const roles = [
  ["carry", "核心"],
  ["disabler", "控制"],
  ["durable", "耐久"],
  ["escape", "逃生"],
  ["initiator", "先手"],
  ["nuker", "爆发"],
  ["pusher", "推进"],
  ["support", "辅助"],
] as const;
const attacks = [
  ["melee", "近战"],
  ["ranged", "远程"],
] as const;

export function HeroFilterForm({
  filters,
  onChange,
  onClear,
}: {
  filters: HeroFilters;
  onChange: (data: FormData, composing: boolean) => void;
  onClear: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const events = useFilterEvents(onChange);
  const activeCount =
    filters.attributes.length +
    filters.roles.length +
    filters.attacks.length +
    (filters.cm === "all" ? 0 : 1);
  return (
    <form
      autoComplete="off"
      onCompositionStart={events.onCompositionStart}
      onCompositionEnd={events.onCompositionEnd}
      onSubmit={events.onSubmit}
      method="get"
      action="/heroes"
      className="flex flex-wrap items-center gap-1.5"
    >
      <input type="hidden" name="lang" value={locale} />
      <label className="relative min-w-0 basis-full sm:min-w-44 sm:flex-1 sm:basis-44">
        <Search className="absolute left-1.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
        <span className="sr-only">{t("搜索英雄")}</span>
        <input
          name="q"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          value={filters.q}
          onChange={events.onFieldChange}
          maxLength={100}
          placeholder={t("搜索英雄名称、拼音或别称…")}
          className="h-8 w-full bg-transparent pl-7 pr-2 text-xs placeholder:text-[var(--text-muted)] "
        />
      </label>
      <CompactFilterMenu title={t("主属性")} count={filters.attributes.length}>
        {attributes.map(([value, label]) => (
          <FilterOption
            key={value}
            name="attribute"
            value={value}
            label={t(label)}
            onChange={events.onFieldChange}
            selected={filters.attributes.includes(value)}
          />
        ))}
      </CompactFilterMenu>
      <CompactFilterMenu title={t("角色")} count={filters.roles.length}>
        {roles.map(([value, label]) => (
          <FilterOption
            key={value}
            name="role"
            value={value}
            label={t(label)}
            onChange={events.onFieldChange}
            selected={filters.roles.includes(value)}
          />
        ))}
      </CompactFilterMenu>
      <CompactFilterMenu title={t("攻击")} count={filters.attacks.length}>
        {attacks.map(([value, label]) => (
          <FilterOption
            key={value}
            name="attack"
            value={value}
            label={t(label)}
            onChange={events.onFieldChange}
            selected={filters.attacks.includes(value)}
          />
        ))}
      </CompactFilterMenu>
      <CompactSelect
        name="cm"
        label={t("队长模式")}
        value={filters.cm}
        onChange={onChange}
      >
        <option value="all">{t("全部")}</option>
        <option value="true">{t("启用")}</option>
        <option value="false">{t("未启用")}</option>
      </CompactSelect>

      {(filters.q || activeCount > 0) && (
        <button
          type="button"
          onClick={onClear}
          className="flex h-7 items-center gap-1 px-1.5 text-[11px] text-[var(--text-secondary)] hover:text-white"
        >
          <X className="size-3" />
          {t("清除")} {activeCount + (filters.q ? 1 : 0)}
        </button>
      )}
    </form>
  );
}
function FilterOption({
  name,
  value,
  label,
  selected,
  onChange,
}: {
  name: string;
  value: string;
  label: string;
  selected: boolean;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
}) {
  return (
    <label className="compact-menu-option" data-selected={selected}>
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={selected}
        onChange={onChange}
        className="compact-menu-checkbox"
      />
      {label}
    </label>
  );
}
