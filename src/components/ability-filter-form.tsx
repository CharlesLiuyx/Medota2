import Link from "next/link";
import { Filter, Search, X } from "lucide-react";
import type { AbilityFilters } from "@/server/services/ability-filters";

export function AbilityFilterForm({ filters }: { filters: AbilityFilters }) {
  return (
    <form
      action="/abilities"
      className="border border-[var(--border-default)] bg-[var(--surface-overlay)] p-4 shadow-[var(--shadow-elevated)] backdrop-blur"
    >
      <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_repeat(5,minmax(120px,auto))_auto]">
        <label className="relative">
          <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <span className="sr-only">搜索 Ability</span>
          <input
            name="q"
            defaultValue={filters.q}
            maxLength={100}
            placeholder="名称或 internal name…"
            className="h-[var(--control-height)] w-full border border-[var(--border-default)] bg-[var(--surface-sunken)] pl-11 pr-4 text-sm outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)]"
          />
        </label>
        <Select name="status" label="状态" value={filters.status}>
          <option value="current">Current</option>
          <option value="indirect">Indirect</option>
          <option value="defined_unbound">Defined / unbound</option>
          <option value="template">Template</option>
          <option value="deprecated">Deprecated</option>
          <option value="all">All</option>
        </Select>
        <Select name="relation" label="关系" value={filters.relation}>
          <option value="all">全部关系</option>
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
            <option key={value}>{value}</option>
          ))}
        </Select>
        <Select name="upgrade" label="升级" value={filters.upgrade}>
          <option value="all">全部</option>
          <option value="scepter">Scepter</option>
          <option value="shard">Shard</option>
          <option value="granted">Upgrade granted</option>
        </Select>
        <label className="grid h-[var(--control-height)] grid-cols-[auto_1fr] items-center gap-2 border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          Hero
          <input
            name="hero"
            defaultValue={filters.hero}
            placeholder="slug"
            className="min-w-0 bg-transparent text-xs normal-case tracking-normal text-[var(--text-primary)] outline-none"
          />
        </label>
        <Select name="lang" label="语言" value={filters.lang}>
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
        </Select>
        <button className="flex h-[var(--control-height)] items-center justify-center gap-2 bg-[var(--accent-primary)] px-5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]">
          <Filter className="size-4" /> 应用
        </button>
      </div>
      {(filters.q ||
        filters.status !== "current" ||
        filters.hero ||
        filters.relation !== "all" ||
        filters.upgrade !== "all" ||
        filters.lang !== "zh-CN") && (
        <div className="mt-3 flex justify-end border-t border-[var(--border-subtle)] pt-3">
          <Link
            href="/abilities"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="size-3.5" /> 清除全部
          </Link>
        </div>
      )}
    </form>
  );
}

function Select({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid h-[var(--control-height)] grid-cols-[auto_1fr] items-center gap-2 border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
      {label}
      <select
        name={name}
        defaultValue={value}
        className="min-w-0 bg-transparent text-xs normal-case tracking-normal text-[var(--text-primary)] outline-none"
      >
        {children}
      </select>
    </label>
  );
}
