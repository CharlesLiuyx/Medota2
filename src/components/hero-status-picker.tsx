"use client";
import { useMemo, useRef, useState } from "react";
import { Plus, Search, ShieldPlus } from "lucide-react";
import { useLocale, useTranslations } from "@/i18n/provider";
import type { HeroStatusDefinition } from "@/domain/hero-inventory";
import {
  groupStatusResults,
  statusAtLevel,
  type StatusProviderKind,
} from "@/domain/hero-status-catalog";
import { useHeroBuild } from "./hero-build-provider";
import { InventoryPickerPanel } from "./hero-inventory-picker-panel";
import { InfiniteList } from "./infinite-list";
import { HoverTooltip } from "./ui/hover-tooltip";
import { PageInfoTooltip } from "./ui/page-info-tooltip";
import { AbilityIcon } from "./ability-icon";
import { ItemIcon } from "./item-icon";
import Link from "./version-link";

export function HeroStatusIcon({
  status,
  itemVersion,
  abilityVersion,
}: {
  status: HeroStatusDefinition;
  itemVersion: string | null;
  abilityVersion: string | null;
}) {
  return (
    <span className="inline-flex size-8 shrink-0 overflow-hidden rounded-full [&>span]:h-full [&>span]:w-full">
      {status.item ? (
        <ItemIcon itemKey={status.item} version={itemVersion} />
      ) : status.sourceAbility && abilityVersion ? (
        <AbilityIcon
          internalName={status.sourceAbility.id}
          name={status.name}
          assetVersion={abilityVersion}
          compact
        />
      ) : (
        <ShieldPlus className="size-6 text-[#a5d3ff]" />
      )}
    </span>
  );
}
function readable(text: string) {
  return text
    .replace(/%[df]?MODIFIER_PROPERTY_[A-Z_]+%(?:%%)?/giu, "—")
    .replace(/%[a-z_][a-z0-9_]*%/giu, "—")
    .replace(/<[^>]*>/gu, "");
}
export function HeroStatusDetails({
  status,
  level = 1,
  onLevel,
}: {
  status: HeroStatusDefinition;
  level?: number;
  onLevel?: (level: number) => void;
}) {
  const en = useLocale() === "en",
    t = useTranslations();
  const effective = statusAtLevel(status, level);
  return (
    <div className="space-y-2 text-xs">
      {status.provider && (
        <p className="flex flex-wrap gap-x-1 text-[#d8c49a]">
          <Link href={status.provider.href}>
            {en ? status.provider.enName : status.provider.name}
          </Link>
          {status.sourceAbility && (
            <>
              <span>›</span>
              <Link href={`/abilities/${status.sourceAbility.id}`}>
                {en ? status.sourceAbility.enName : status.sourceAbility.name}
              </Link>
            </>
          )}
        </p>
      )}
      <p className="leading-relaxed">
        {readable(
          en
            ? (status.enDescription ?? t(status.description))
            : t(status.description),
        )}
      </p>
      {status.levels && (
        <StatusLevels status={status} level={level} onLevel={onLevel} />
      )}
      {effective.duration !== null && (
        <p>
          {t("游戏内持续 {seconds} 秒；模拟保持到手动移除。", {
            seconds: effective.duration,
          })}
        </p>
      )}
      {status.coverage && (
        <p className="text-[var(--text-muted)]">
          {t(
            status.coverage === "unmodeled"
              ? "此状态尚未计入属性。"
              : "仅已列出的面板贡献计入属性；其他效果见来源。",
          )}
        </p>
      )}
      {!!status.parameters?.length && (
        <details>
          <summary className="cursor-pointer text-[var(--text-muted)]">
            {t("来源技能参数")}
          </summary>
          <dl className="mt-1 max-h-48 space-y-1 overflow-auto">
            {status.parameters
              .filter((p) => p.values.length)
              .map((p) => (
                <div className="flex justify-between gap-3" key={p.field}>
                  <dt className="break-words">
                    {readable(en ? p.enName : p.name)}
                  </dt>
                  <dd className="shrink-0 tabular-nums">
                    {p.values.length > (status.levels?.length ?? 1)
                      ? p.values.join(" / ")
                      : p.values[Math.min(level - 1, p.values.length - 1)]}
                  </dd>
                </div>
              ))}
          </dl>
        </details>
      )}
      {status.mapping === "prefix" && (
        <p className="text-[10px] text-[var(--text-muted)]">
          {t("来源按同版状态名关联，适用目标与触发条件见技能说明。")}
        </p>
      )}
      {status.sourceModifier && (
        <p className="break-all text-[10px] text-[var(--text-muted)]">
          {status.sourceModifier}
        </p>
      )}
    </div>
  );
}
function StatusLevels({
  status,
  level,
  onLevel,
}: {
  status: HeroStatusDefinition;
  level: number;
  onLevel?: (n: number) => void;
}) {
  const t = useTranslations();
  const en = useLocale() === "en";
  if (!status.levels || status.levels.length <= 1) return null;
  return (
    <div
      role="group"
      aria-label={t("状态等级：{name}", {
        name: en ? (status.enName ?? t(status.name)) : t(status.name),
      })}
      className="flex flex-wrap items-center gap-1"
    >
      <span className="text-[10px] text-[var(--text-muted)]">
        {t("当前等级")}
      </span>
      {status.levels.map((_, i) => (
        <button
          key={i}
          type="button"
          aria-pressed={level === i + 1}
          disabled={!onLevel}
          onClick={() => onLevel?.(i + 1)}
          className="h-6 min-w-6 rounded-sm bg-white/5 px-1 text-[10px] aria-pressed:bg-[#e4c584]/20 aria-pressed:text-[#f2d597]"
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}
const filters: Array<[StatusProviderKind | "all", string]> = [
  ["all", "全部来源"],
  ["item", "物品"],
  ["hero", "英雄"],
  ["neutral", "中立生物"],
  ["building", "建筑"],
  ["unit", "其他单位"],
];
export function HeroStatusPicker() {
  const context = useHeroBuild(),
    t = useTranslations(),
    en = useLocale() === "en";
  const [anchor, setAnchor] = useState<HTMLElement | null>(null),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState<StatusProviderKind | "all">("all");
  const input = useRef<HTMLInputElement>(null);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const catalog = context?.inventoryCatalog;
  const statuses = useMemo(
    () =>
      catalog?.statuses.map((status) => {
        if (status.provider) return status;
        const item = catalog.items.find((i) => i.internalName === status.item);
        return {
          ...status,
          provider: {
            id: status.item,
            kind: "item" as const,
            name: item?.zhName ?? t(status.name),
            enName: item?.enName ?? t(status.name),
            href: `/items/${status.item}`,
          },
        };
      }) ?? [],
    [catalog, t],
  );
  const groups = useMemo(
    () => groupStatusResults(statuses, query, kind),
    [statuses, query, kind],
  );
  const rows = useMemo(
    () =>
      groups.flatMap((g) =>
        g.statuses.map((status, i) => ({
          status,
          provider: i === 0 ? g.provider : null,
        })),
      ),
    [groups],
  );
  if (!context) return null;
  const {
    inventory,
    inventoryDispatch,
    loadStatusCatalog,
    statusCatalogLoaded,
    statusCatalogLoading,
    statusCatalogError,
    itemImageVersion,
    abilityImageVersion,
  } = context;
  const add = (status: HeroStatusDefinition) => {
    inventoryDispatch({ type: "status", id: status.id, enabled: true });
    if (status.levels)
      inventoryDispatch({
        type: "status-level",
        id: status.id,
        level: levels[status.id] ?? inventory.statusLevels?.[status.id] ?? 1,
      });
  };
  return (
    <>
      <button
        type="button"
        aria-label={t("添加状态")}
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => {
          setAnchor(e.currentTarget);
          if (!statusCatalogLoaded) void loadStatusCatalog();
        }}
        className="inline-flex h-6 items-center gap-0.5 px-1 text-[10px] text-[#d8c49a] hover:bg-white/10"
      >
        <Plus size={12} />
        {t("添加")}
      </button>
      {anchor && (
        <InventoryPickerPanel
          anchor={anchor}
          inputRef={input}
          title={t("添加状态")}
          onClose={() => setAnchor(null)}
        >
          <div
            className="mb-1 flex min-w-0 items-center gap-2 overflow-x-auto pb-1"
            data-status-toolbar
          >
            <div className="relative flex min-w-40 flex-1 items-center bg-black/20">
              <Search
                size={14}
                className="absolute left-2 text-[var(--text-muted)]"
              />
              <input
                ref={input}
                aria-label={t("搜索状态或提供方")}
                placeholder={t("搜索状态、物品、技能或提供方…")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.nativeEvent.isComposing &&
                    rows[0]
                  ) {
                    e.preventDefault();
                    add(rows[0].status);
                  }
                }}
                className="h-8 w-full pl-7 pr-2 text-xs"
                maxLength={100}
              />
            </div>
            <div
              className="flex shrink-0 items-center gap-1"
              role="group"
              aria-label={t("状态来源筛选")}
            >
              {filters.map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed={kind === id}
                  onClick={() => setKind(id)}
                  className="h-6 whitespace-nowrap rounded-sm bg-white/5 px-1.5 text-[10px] aria-pressed:bg-[#e4c584]/20 aria-pressed:text-[#f2d597]"
                >
                  {t(label)}
                </button>
              ))}
              <PageInfoTooltip label={t("状态目录说明")}>
                {t(
                  "按当前版本的提供方聚合；包含来源定义中的状态，不等同于当前对局可触发清单。添加后保持到移除；等级取提供方技能，未建模效果不改变属性。",
                )}
              </PageInfoTooltip>
            </div>
            <p
              role="status"
              className="shrink-0 whitespace-nowrap text-[10px] tabular-nums text-[var(--text-muted)]"
            >
              {t("{providers} 个提供方 · {count} 个状态", {
                providers: groups.length,
                count: rows.length,
              })}
            </p>
          </div>
          {statusCatalogLoading && (
            <p role="status" className="py-1 text-xs">
              {t("正在读取状态来源…")}
            </p>
          )}
          {statusCatalogError && (
            <div role="alert" className="flex items-center gap-2 py-1 text-xs">
              {t("状态来源暂不可用")}
              <button
                onClick={() => void loadStatusCatalog()}
                className="text-[#e4c584]"
              >
                {t("重试")}
              </button>
            </div>
          )}
          <div
            className="max-h-[min(36rem,calc(100dvh-180px))] overflow-y-auto"
            data-status-picker
          >
            {!rows.length && (
              <p className="p-3 text-xs">{t("没有匹配的状态")}</p>
            )}
            <InfiniteList
              source={{
                kind: "local",
                items: rows,
                chunkSize: 32,
                identity: `statuses:${query}:${kind}:${en}:${statusCatalogLoaded}`,
              }}
              getKey={(row) => row.status.id}
              ariaLabel={t("可选状态")}
              renderChunk={(chunk) =>
                chunk.map(({ status, provider }) => {
                  const name = en
                      ? (status.enName ?? t(status.name))
                      : t(status.name),
                    level =
                      levels[status.id] ??
                      inventory.statusLevels?.[status.id] ??
                      1,
                    selected = inventory.statuses.includes(status.id);
                  return (
                    <div key={status.id} data-infinite-list-key={status.id}>
                      {provider && (
                        <h4 className="sticky top-0 z-10 bg-[#19232b] px-1 py-2 text-xs font-semibold text-[#d8c49a]">
                          <Link href={provider.href}>
                            {en ? provider.enName : provider.name}
                          </Link>
                        </h4>
                      )}
                      <div
                        className="mb-1 flex flex-wrap items-center gap-2 bg-black/15 px-2 py-1"
                        data-status-result={status.id}
                      >
                        <HoverTooltip
                          openOnClick={false}
                          buttonProps={{
                            "aria-label": t(
                              selected
                                ? "已添加状态：{name}"
                                : "添加状态：{name}",
                              { name },
                            ),
                            onClick: () => add(status),
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-[#e4c584]"
                          content={
                            <HeroStatusDetails status={status} level={level} />
                          }
                        >
                          <HeroStatusIcon
                            status={status}
                            itemVersion={itemImageVersion}
                            abilityVersion={abilityImageVersion}
                          />
                          <span className="min-w-0">
                            <strong className="block text-xs">
                              {name}
                              {selected ? " ✓" : ""}
                            </strong>
                            <span className="block text-[10px] text-[var(--text-muted)]">
                              {en
                                ? status.provider?.enName
                                : status.provider?.name}
                              {status.sourceAbility
                                ? ` · ${en ? status.sourceAbility.enName : status.sourceAbility.name}`
                                : ""}
                            </span>
                          </span>
                        </HoverTooltip>
                        <StatusLevels
                          status={status}
                          level={level}
                          onLevel={(n) => {
                            setLevels((old) => ({ ...old, [status.id]: n }));
                            if (selected)
                              inventoryDispatch({
                                type: "status-level",
                                id: status.id,
                                level: n,
                              });
                          }}
                        />
                        {status.coverage === "unmodeled" && (
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {t("未计入属性")}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              }
            />
          </div>
        </InventoryPickerPanel>
      )}
    </>
  );
}
