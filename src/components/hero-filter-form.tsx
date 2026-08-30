import Link from "next/link";
import { Filter, Search, X } from "lucide-react";
import type { HeroFilters } from "@/server/services/hero-filters";

const attributes = [
  ["agility", "敏捷"],
  ["intelligence", "智力"],
  ["strength", "力量"],
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

export function HeroFilterForm({ filters }: { filters: HeroFilters }) {
  const activeCount =
    filters.attributes.length +
    filters.roles.length +
    filters.attacks.length +
    (filters.cm === "all" ? 0 : 1);
  return (
    <form
      method="get"
      action="/heroes"
      className="border border-[var(--border-default)] bg-[var(--surface-overlay)] p-4 shadow-[var(--shadow-elevated)] backdrop-blur sm:p-5"
    >
      <div className="flex flex-col gap-3 lg:flex-row">
        <label className="relative min-w-0 flex-1">
          <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <span className="sr-only">搜索英雄</span>
          <input
            name="q"
            defaultValue={filters.q}
            maxLength={100}
            placeholder="搜索中文名、英文名或内部名称…"
            className="h-[var(--control-height)] w-full border border-[var(--border-default)] bg-[var(--surface-sunken)] pl-11 pr-4 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)]"
          />
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex">
          <FilterGroup title="主属性" count={filters.attributes.length}>
            {attributes.map(([value, label]) => (
              <FilterOption
                key={value}
                name="attribute"
                value={value}
                label={label}
                selected={filters.attributes.includes(value)}
              />
            ))}
          </FilterGroup>
          <FilterGroup title="角色" count={filters.roles.length}>
            {roles.map(([value, label]) => (
              <FilterOption
                key={value}
                name="role"
                value={value}
                label={label}
                selected={filters.roles.includes(value)}
              />
            ))}
          </FilterGroup>
          <FilterGroup title="攻击" count={filters.attacks.length}>
            {attacks.map(([value, label]) => (
              <FilterOption
                key={value}
                name="attack"
                value={value}
                label={label}
                selected={filters.attacks.includes(value)}
              />
            ))}
          </FilterGroup>
          <label className="flex h-[var(--control-height)] items-center border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 text-xs text-[var(--text-secondary)] focus-within:border-[var(--border-strong)]">
            <span className="mr-2 shrink-0">CM</span>
            <select
              name="cm"
              defaultValue={filters.cm}
              className="min-w-0 flex-1 bg-transparent text-[var(--text-primary)] outline-none"
            >
              <option value="all">全部</option>
              <option value="true">启用</option>
              <option value="false">未启用</option>
            </select>
          </label>
        </div>
        <button className="flex h-[var(--control-height)] items-center justify-center gap-2 bg-[var(--accent-primary)] px-6 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]">
          <Filter className="size-4" /> 应用筛选
        </button>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-xs">
        <label className="text-[var(--text-muted)]" htmlFor="hero-language">
          Language
        </label>
        <select
          id="hero-language"
          name="lang"
          defaultValue={filters.lang}
          className="border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-[var(--text-primary)]"
        >
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
        </select>
      </div>
      {(filters.q || activeCount > 0) && (
        <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 text-xs text-[var(--text-muted)]">
          <span>{activeCount + (filters.q ? 1 : 0)} 项查询条件</span>
          <Link
            href="/heroes"
            className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <X className="size-3.5" /> 清除全部
          </Link>
        </div>
      )}
    </form>
  );
}

function FilterGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <details className="group relative">
      <summary className="flex h-[var(--control-height)] cursor-pointer list-none items-center justify-between gap-3 border border-[var(--border-default)] bg-[var(--surface-sunken)] px-4 text-xs text-[var(--text-secondary)] hover:border-[var(--border-strong)] [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span className="min-w-4 text-right text-[var(--accent-hover)]">
          {count || "·"}
        </span>
      </summary>
      <div className="absolute right-0 z-20 mt-2 grid min-w-44 gap-1 border border-[var(--border-default)] bg-[var(--surface-elevated)] p-2 shadow-[var(--shadow-elevated)]">
        {children}
      </div>
    </details>
  );
}

function FilterOption({
  name,
  value,
  label,
  selected,
}: {
  name: string;
  value: string;
  label: string;
  selected: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={selected}
        className="accent-[var(--accent-primary)]"
      />
      {label}
    </label>
  );
}
