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
      className="border border-white/10 bg-[#111317]/85 p-4 shadow-2xl shadow-black/20 backdrop-blur sm:p-5"
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
            className="h-12 w-full border border-white/10 bg-black/30 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-[#d85a3a]/70"
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
          <label className="flex h-12 items-center border border-white/10 bg-black/20 px-3 text-xs text-zinc-400 focus-within:border-white/25">
            <span className="mr-2 shrink-0">CM</span>
            <select
              name="cm"
              defaultValue={filters.cm}
              className="min-w-0 flex-1 bg-transparent text-white outline-none"
            >
              <option value="all">全部</option>
              <option value="true">启用</option>
              <option value="false">未启用</option>
            </select>
          </label>
        </div>
        <button className="flex h-12 items-center justify-center gap-2 bg-[#c94f32] px-6 text-sm font-semibold text-white hover:bg-[#df6041]">
          <Filter className="size-4" /> 应用筛选
        </button>
      </div>
      {(filters.q || activeCount > 0) && (
        <div className="mt-3 flex items-center justify-between border-t border-white/8 pt-3 text-xs text-zinc-500">
          <span>{activeCount + (filters.q ? 1 : 0)} 项查询条件</span>
          <Link
            href="/heroes"
            className="flex items-center gap-1.5 text-zinc-400 hover:text-white"
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
      <summary className="flex h-12 cursor-pointer list-none items-center justify-between gap-3 border border-white/10 bg-black/20 px-4 text-xs text-zinc-300 hover:border-white/20 [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span className="min-w-4 text-right text-[#e26a4c]">
          {count || "·"}
        </span>
      </summary>
      <div className="absolute right-0 z-20 mt-2 grid min-w-44 gap-1 border border-white/12 bg-[#15171b] p-2 shadow-2xl shadow-black/60">
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
    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-xs text-zinc-300 hover:bg-white/5">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={selected}
        className="accent-[#d85a3a]"
      />
      {label}
    </label>
  );
}
