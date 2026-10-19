"use client";
import styles from "./hero-inventory.module.css";
import {
  HeroStatusPicker,
  HeroStatusIcon,
  HeroStatusDetails,
} from "./hero-status-picker";

import {
  memo,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { Coins, Info, Plus, RotateCcw, Search, X } from "lucide-react";
import type {
  InventoryItem,
  HeroStatusDefinition,
} from "@/domain/hero-inventory";
import { SourceText, useLocale, useTranslations } from "@/i18n/provider";
import { useHeroBuild } from "./hero-build-provider";
import { InventoryPickerPanel } from "./hero-inventory-picker-panel";
import {
  HeroStatRelation,
  SourceChanges,
  useSourceHighlight,
} from "./hero-stats-relations";
import { ItemIcon } from "./item-icon";
import { ItemSummary } from "./item-summary";
import { HoverTooltip } from "./ui/hover-tooltip";
import { PageInfoTooltip } from "./ui/page-info-tooltip";
import { CompactSelect } from "./ui/compact-select";
import { InfiniteList } from "./infinite-list";
import Link from "./version-link";

const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_'’\-]+/gu, "");
const emptyItems: InventoryItem[] = [];

export function HeroInventoryPanel() {
  const context = useHeroBuild();
  if (!context)
    throw new Error("HeroInventoryPanel requires HeroBuildProvider");
  const {
    inventory,
    inventoryCatalog: catalog,
    itemImageVersion: imageVersion,
    inventoryProjection: projection,
    inventoryDispatch: dispatch,
    reset,
    resetVersion,
  } = context;
  const t = useTranslations(),
    locale = useLocale();
  const en = locale === "en";
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const [lastReset, setLastReset] = useState(resetVersion);
  if (lastReset !== resetVersion) {
    setLastReset(resetVersion);
    setSelectedSlot(0);
    setPickerAnchor(null);
  }
  const search = useRef<HTMLInputElement>(null);
  const items = catalog?.items ?? emptyItems;
  const byId = useMemo(
    () => new Map(items.map((item) => [item.internalName, item])),
    [items],
  );
  const equip = useCallback(
    (item: string) => {
      dispatch({ type: "equip", slot: selectedSlot, item });
      const next = inventory.slots.findIndex(
        (slot, index) => index !== selectedSlot && !slot,
      );
      if (next >= 0 && !byId.get(item)?.automatic) setSelectedSlot(next);
    },
    [dispatch, selectedSlot, inventory.slots, byId],
  );
  const scepterMode = inventory.statuses.includes("scepter-gifted")
    ? "scepter-gifted"
    : inventory.statuses.includes("scepter-consumed")
      ? "scepter-consumed"
      : inventory.slots.some((slot) => slot?.item === "item_ultimate_scepter")
        ? "held"
        : "none";
  const statusToggle = (id: string) => {
    const enabled = !inventory.statuses.includes(id);
    const held = enabled
      ? inventory.slots.findIndex(
          (slot) => slot && byId.get(slot.item)?.consumeStatus === id,
        )
      : -1;
    dispatch(
      held >= 0
        ? { type: "consume", slot: held }
        : { type: "status", id, enabled },
    );
  };
  const price = (value: number) =>
    value.toLocaleString(locale, { maximumFractionDigits: 2 });
  return (
    <section
      id="inventory"
      className="dota-panel min-w-0 px-2!"
      aria-label={t("物品和状态")}
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-medium text-[#d8c49a]">
          {t("物品和状态")}
        </h2>
        <PageInfoTooltip label={t("物品模拟说明")}>
          <p>
            {t(
              "点装备槽搜索选装，属性即时更新。消耗效果列入状态，可单独移除。重置：回到1级，清空天赋、装备和状态，重置技能等级。",
            )}
          </p>
          <p className="mt-2">
            {t("临时状态需手动移除。攻击触发、目标和缺血效果见物品简介。")}
          </p>
        </PageInfoTooltip>
        <span
          className="ml-auto inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-[#e4c584]"
          title={t("装备价值")}
        >
          <Coins size={12} aria-hidden="true" />
          <span className="sr-only">{t("装备价值")}</span>
          <strong data-inventory-value>
            {price(projection?.inventoryValue ?? 0)}
          </strong>
        </span>
        <button
          type="button"
          title={t("重置")}
          onClick={reset}
          aria-label={t("重置全部模拟")}
          className="inline-flex items-center gap-1 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[#e4c584] active:bg-white/10"
        >
          <RotateCcw size={12} aria-hidden="true" />
          <span className="sr-only">{t("重置")}</span>
        </button>
      </div>
      {!catalog?.supported ? (
        <p role="status" className="text-xs text-[var(--text-secondary)]">
          {t("该版本的物品模拟资料尚未接入。")}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[max-content_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] items-start gap-x-1 gap-y-1">
            <div
              role="group"
              aria-label={t("装备槽")}
              className="col-start-1 row-span-2 row-start-1 grid grid-cols-[repeat(2,2.75rem)] content-start gap-x-0.5 gap-y-1"
            >
              {inventory.slots.map((slot, index) => {
                const item = slot ? byId.get(slot.item) : undefined;
                const name = item
                  ? en
                    ? item.enName
                    : item.zhName
                  : t("空装备槽 {slot}", { slot: index + 1 });
                return (
                  <HeroStatRelation key={index} field={`slot:${index}`}>
                    <div data-inventory-slot={index} className={styles.slot}>
                      <ItemSlotTrigger
                        item={item}
                        imageVersion={imageVersion}
                        sourceId={`slot:${index}`}
                        aria-pressed={selectedSlot === index}
                        aria-haspopup="dialog"
                        aria-expanded={
                          pickerAnchor !== null && selectedSlot === index
                        }
                        aria-label={t("选择装备槽 {slot}：{name}", {
                          slot: index + 1,
                          name,
                        })}
                        onClick={(event) => {
                          setSelectedSlot(index);
                          setPickerAnchor(event.currentTarget);
                        }}
                        className="flex h-12 w-full min-w-0 flex-col items-center justify-center gap-0.5 text-[var(--text-secondary)] hover:text-white aria-pressed:text-[#e4c584]"
                      >
                        <span className={styles.object}>
                          {item ? (
                            <ItemIcon
                              itemKey={item.internalName}
                              version={imageVersion}
                            />
                          ) : (
                            <Plus
                              size={20}
                              aria-hidden="true"
                              className="text-[var(--text-muted)]"
                            />
                          )}
                        </span>
                        <span className="w-full truncate text-center text-[10px] leading-3">
                          {item ? name : t("装备 {slot}", { slot: index + 1 })}
                          {slot && slot.charges > 1 ? ` ×${slot.charges}` : ""}
                        </span>
                      </ItemSlotTrigger>
                      {item && (
                        <>
                          <button
                            type="button"
                            aria-label={t("移除装备 {slot}", {
                              slot: index + 1,
                            })}
                            onClick={() =>
                              dispatch({ type: "remove", slot: index })
                            }
                            className={`${styles.action} absolute right-0 top-0 p-1 text-[var(--text-muted)] hover:bg-black/50 hover:text-white`}
                          >
                            <X size={12} />
                          </button>
                          <div
                            className={`${styles.action} absolute left-0 top-0`}
                          >
                            <ItemBrief
                              item={item}
                              imageVersion={imageVersion}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </HeroStatRelation>
                );
              })}
            </div>
            <NeutralInventory key={`neutral:${resetVersion}`}>
              <div
                className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] self-end gap-0.5 text-[10px]"
                data-upgrade-controls
              >
                <div className="col-span-2 flex min-w-0 items-center gap-0.5">
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-[var(--text-muted)]">
                    <span className="inline-flex [&>span]:h-4 [&>span]:w-5">
                      <ItemIcon
                        itemKey="item_ultimate_scepter"
                        version={imageVersion}
                      />
                    </span>
                    {t("神杖")}
                  </span>
                  <CompactSelect
                    className="min-w-0 max-w-full [&>summary]:gap-0.5! [&>summary]:px-0.5! [&>summary]:py-0.5! [&>summary]:text-[10px]!"
                    label={t("神杖配置")}
                    hideLabel
                    value={scepterMode}
                    onValueChange={(mode) => {
                      if (mode === "held") {
                        const empty = inventory.slots.findIndex(
                          (slot) => !slot,
                        );
                        dispatch({
                          type: "equip",
                          item: "item_ultimate_scepter",
                          slot: empty >= 0 ? empty : selectedSlot,
                        });
                      } else if (mode === "none") {
                        inventory.slots.forEach((slot, index) => {
                          if (slot?.item === "item_ultimate_scepter")
                            dispatch({ type: "remove", slot: index });
                        });
                        dispatch({
                          type: "status",
                          id: "scepter-consumed",
                          enabled: false,
                        });
                        dispatch({
                          type: "status",
                          id: "scepter-gifted",
                          enabled: false,
                        });
                      } else
                        dispatch({ type: "status", id: mode, enabled: true });
                    }}
                  >
                    <option value="none">{t("未配置")}</option>
                    <option value="held">{t("装备中")}</option>
                    <option value="scepter-consumed">{t("已吞服")}</option>
                    <option value="scepter-gifted">{t("炼金赠予")}</option>
                  </CompactSelect>
                </div>
                <button
                  type="button"
                  aria-pressed={inventory.statuses.includes("shard")}
                  onClick={() => statusToggle("shard")}
                  className={`inline-flex min-h-6 min-w-0 items-center gap-0.5 px-0.5 py-0.5 active:bg-white/10 ${inventory.statuses.includes("shard") ? "bg-[#75baff]/15 text-[#a5d3ff]" : "bg-black/20 text-[var(--text-secondary)]"}`}
                >
                  <span className="inline-flex shrink-0 [&>span]:h-4 [&>span]:w-4">
                    <ItemIcon
                      itemKey="item_aghanims_shard"
                      version={imageVersion}
                    />
                  </span>
                  <span className="min-w-0 truncate">{t("魔晶")}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={inventory.statuses.includes("moon-consumed")}
                  onClick={() => statusToggle("moon-consumed")}
                  className={`inline-flex min-h-6 min-w-0 items-center gap-0.5 px-0.5 py-0.5 active:bg-white/10 ${inventory.statuses.includes("moon-consumed") ? "bg-[#75baff]/15 text-[#a5d3ff]" : "bg-black/20 text-[var(--text-secondary)]"}`}
                >
                  <span className="inline-flex shrink-0 [&>span]:h-4 [&>span]:w-4">
                    <ItemIcon
                      itemKey="item_moon_shard"
                      version={imageVersion}
                    />
                  </span>
                  <span className="min-w-0 truncate">{t("银月祝福")}</span>
                </button>
              </div>
            </NeutralInventory>
          </div>
          {pickerAnchor && (
            <InventoryPickerPanel
              anchor={pickerAnchor}
              inputRef={search}
              title={t("装备 {slot}", { slot: selectedSlot + 1 })}
              onClose={() => setPickerAnchor(null)}
            >
              <ItemPicker
                items={items}
                imageVersion={imageVersion}
                inputRef={search}
                onEquip={(item) => {
                  equip(item);
                  setPickerAnchor(null);
                  pickerAnchor.focus({ preventScroll: true });
                }}
              />
            </InventoryPickerPanel>
          )}
          {(() => {
            const slot = inventory.slots[selectedSlot],
              item = slot ? byId.get(slot.item) : undefined;
            return item && slot ? (
              <div className="mt-2 flex min-h-7 flex-wrap items-center gap-2 text-[11px]">
                <span className="text-[var(--text-secondary)]">
                  {en ? item.enName : item.zhName}
                </span>
                {!!item.choices.length && (
                  <CompactSelect
                    label={t("装备模式")}
                    value={slot.choice}
                    onValueChange={(choice) =>
                      dispatch({ type: "choice", slot: selectedSlot, choice })
                    }
                  >
                    {item.choices.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {t(choice.label)}
                      </option>
                    ))}
                  </CompactSelect>
                )}
                {item.consumeStatus && !item.automatic && (
                  <button
                    type="button"
                    disabled={inventory.statuses.includes(item.consumeStatus)}
                    onClick={() =>
                      dispatch({ type: "consume", slot: selectedSlot })
                    }
                    className="ml-auto px-2 py-1 text-[#e4c584] hover:bg-white/5 disabled:opacity-40"
                  >
                    {item.internalName === "item_ultimate_scepter"
                      ? t("吞服 · 加购福佑图纸")
                      : t("使用／消耗")}
                  </button>
                )}
              </div>
            ) : null;
          })()}
          <div className="mt-3">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <div className="flex items-center gap-1">
                <h3 className="text-xs text-[#d8c49a]">{t("当前状态")}</h3>
                <HeroStatusPicker key={resetVersion} />
              </div>
              <span className="text-[10px] text-[var(--text-muted)]">
                {t("含消耗总价值")}{" "}
                <strong
                  data-configuration-value
                  className="tabular-nums text-[#d8c49a]"
                >
                  {price(projection?.configurationValue ?? 0)}
                </strong>
              </span>
            </div>
            <div
              aria-live="polite"
              className="flex min-h-8 flex-wrap items-start gap-2"
              data-hero-statuses
            >
              {scepterMode === "held" && (
                <StatusObject
                  sourceId={`slot:${inventory.slots.findIndex((slot) => slot?.item === "item_ultimate_scepter")}`}
                  name={t("神杖升级 · 装备中")}
                  item="item_ultimate_scepter"
                  imageVersion={imageVersion}
                >
                  {byId.get("item_ultimate_scepter") && (
                    <ItemSummary
                      item={byId.get("item_ultimate_scepter")!}
                      en={en}
                      compact
                    />
                  )}
                </StatusObject>
              )}
              {projection?.neutral && (
                <div data-neutral-state>
                  <StatusObject
                    sourceId="neutral"
                    name={`${en ? projection.neutral.enName : projection.neutral.zhName}${inventory.neutral?.choice ? ` · ${t(projection.neutral.choices.find((c) => c.id === inventory.neutral?.choice)?.label ?? "")}` : ""}${inventory.curio ? ` · ${t("珍品强化")}` : ""}`}
                    item={projection.neutral.internalName}
                    imageVersion={imageVersion}
                  >
                    <ItemSummary item={projection.neutral} en={en} compact />
                  </StatusObject>
                </div>
              )}
              {projection?.enchantment && (
                <div data-enchantment-state>
                  <StatusObject
                    sourceId="enchantment"
                    name={`${t("中立附魔")} · ${en ? projection.enchantment.enName : projection.enchantment.zhName}${projection.enchantmentMultiplier !== 1 ? ` ×${Number(projection.enchantmentMultiplier.toFixed(2))}` : ""}`}
                    item={projection.enchantment.internalName}
                    imageVersion={imageVersion}
                  >
                    <ItemSummary
                      item={projection.enchantment}
                      en={en}
                      compact
                    />
                  </StatusObject>
                </div>
              )}
              {projection?.statuses.map((status) => (
                <StatusChip
                  key={status.id}
                  status={status}
                  imageVersion={imageVersion}
                  onRemove={() =>
                    dispatch({ type: "status", id: status.id, enabled: false })
                  }
                />
              ))}
              {inventory.slots.flatMap((slot, index) => {
                const item = slot && byId.get(slot.item),
                  choice = item?.choices.find(
                    (choice) => choice.id === slot?.choice,
                  );
                return item && choice
                  ? [
                      <StatusObject
                        key={index}
                        sourceId={`slot:${index}`}
                        name={`${en ? item.enName : item.zhName} · ${t(choice.label)}`}
                        item={item.internalName}
                        imageVersion={imageVersion}
                      >
                        <ItemSummary item={item} en={en} compact />
                      </StatusObject>,
                    ]
                  : [];
              })}
              {scepterMode === "none" &&
                !projection?.statuses.length &&
                !projection?.neutral &&
                !projection?.enchantment &&
                !inventory.slots.some(
                  (slot) => slot && byId.get(slot.item)?.choices.length,
                ) && (
                  <p className="self-center text-[11px] text-[var(--text-muted)]">
                    {t("暂无额外状态")}
                  </p>
                )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function StatusObject({
  name,
  item,
  imageVersion,
  children,
  onRemove,
  sourceId,
  icon,
}: {
  sourceId?: string;
  icon?: ReactNode;
  name: string;
  item: string;
  imageVersion: string | null;
  children: ReactNode;
  onRemove?: () => void;
}) {
  const t = useTranslations();
  const highlight = useSourceHighlight();
  return (
    <HeroStatRelation field={sourceId ?? ""}>
      <div className="group/status relative size-8 shrink-0" data-status-object>
        <HoverTooltip
          buttonProps={{ "aria-label": name }}
          onOpenChange={(open) => highlight?.(open ? (sourceId ?? null) : null)}
          className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-[#75baff]/10 ring-1 ring-[#a5d3ff]/25 hover:ring-[#a5d3ff] focus-visible:ring-[#a5d3ff]"
          content={
            <div className="max-w-80 text-xs">
              <strong className="text-[#a5d3ff]">{name}</strong>
              <div className="mt-2">{children}</div>
              {sourceId && <SourceChanges sourceId={sourceId} />}
            </div>
          }
        >
          <span className="flex size-8 overflow-hidden rounded-full [&>span]:h-full [&>span]:w-full [&_img]:object-cover">
            {icon ?? <ItemIcon itemKey={item} version={imageVersion} />}
          </span>
          <span className="sr-only">{name}</span>
        </HoverTooltip>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t("移除状态：{name}", { name })}
            className="pointer-events-none absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-[#19232b] text-[#a5d3ff] opacity-0 group-hover/status:pointer-events-auto group-hover/status:opacity-100 group-focus-within/status:pointer-events-auto group-focus-within/status:opacity-100 hover:text-white"
          >
            <X size={10} />
          </button>
        )}
      </div>
    </HeroStatRelation>
  );
}

function StatusChip({
  status,
  imageVersion,
  onRemove,
}: {
  status: HeroStatusDefinition;
  imageVersion: string | null;
  onRemove: () => void;
}) {
  const t = useTranslations();
  const en = useLocale() === "en";
  const context = useHeroBuild();
  return (
    <div data-hero-status={status.id}>
      <StatusObject
        sourceId={`status:${status.id}`}
        name={en ? (status.enName ?? t(status.name)) : t(status.name)}
        icon={
          <HeroStatusIcon
            status={status}
            itemVersion={imageVersion}
            abilityVersion={context?.abilityImageVersion ?? null}
          />
        }
        item={status.item}
        imageVersion={imageVersion}
        onRemove={onRemove}
      >
        <HeroStatusDetails
          status={status}
          level={status.selectedLevel ?? 1}
          onLevel={(level) =>
            context?.inventoryDispatch({
              type: "status-level",
              id: status.id,
              level,
            })
          }
        />
        <ul className="mt-2 space-y-1">
          {status.effects.map((effect, index) => (
            <li key={index}>
              {t(statLabels[effect.stat] ?? effect.stat)}{" "}
              {effect.amount > 0 ? "+" : ""}
              {effect.amount}
              {effect.kind === "percent" || effect.kind === "resistance"
                ? "%"
                : ""}
            </li>
          ))}
        </ul>
      </StatusObject>
    </div>
  );
}
const statLabels: Record<string, string> = {
  strength: "力量",
  agility: "敏捷",
  intelligence: "智力",
  health: "生命值上限",
  mana: "魔法值上限",
  healthRegen: "生命恢复",
  manaRegen: "魔法恢复",
  attackSpeed: "攻击速度",
  attackDamage: "攻击力",
  nightVision: "夜间视野",
};

function ItemBrief({
  item,
  imageVersion,
}: {
  item: InventoryItem;
  imageVersion: string | null;
}) {
  const t = useTranslations(),
    en = useLocale() === "en";
  return (
    <HoverTooltip
      className="inline-flex h-5 w-5 items-center justify-center text-[var(--text-muted)] hover:text-white"
      content={
        <div className="text-xs">
          <div className="mb-2 flex items-center gap-2">
            <ItemIcon itemKey={item.internalName} version={imageVersion} />
            <strong>{en ? item.enName : item.zhName}</strong>
          </div>
          <ItemSummary item={item} en={en} compact />
          <Link
            href={`/items/${item.internalName}`}
            className="mt-2 inline-block text-xs text-[#e4c584]"
          >
            {t("查看完整物品资料")}
          </Link>
        </div>
      }
    >
      <Info size={12} aria-hidden="true" />
      <span className="sr-only">
        {t("物品简介：{name}", { name: en ? item.enName : item.zhName })}
      </span>
    </HoverTooltip>
  );
}

const ItemPicker = memo(function ItemPicker({
  items,
  imageVersion,
  onEquip,
  inputRef,
  label = "搜索并装备物品",
  showEffects = false,
  catalogKey = label,
}: {
  items: InventoryItem[];
  imageVersion: string | null;
  onEquip: (id: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  label?: string;
  showEffects?: boolean;
  catalogKey?: string;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    en = locale === "en";
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const terms = query.trim().split(/\s+/u).map(normalize).filter(Boolean);
    const aliases: Record<string, string> = {
      a杖: "item_ultimate_scepter",
      a帐: "item_ultimate_scepter",
      aghs: "item_ultimate_scepter",
      bkb: "item_black_king_bar",
      跳刀: "item_blink",
    };
    const exact = aliases[normalize(query)];
    return items.filter((item) =>
      exact
        ? item.internalName === exact
        : terms.every((term) => item.searchText.includes(term)),
    );
  }, [items, query]);
  return (
    <div className="relative">
      <label className="relative flex items-center bg-black/20">
        <Search
          size={14}
          aria-hidden="true"
          className="absolute left-2 text-[var(--text-muted)]"
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              filtered[0] &&
              !(event.nativeEvent as KeyboardEvent).isComposing
            ) {
              event.preventDefault();
              onEquip(filtered[0].internalName);
              setQuery("");
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              const input = event.currentTarget;
              requestAnimationFrame(() =>
                input
                  .closest("label")
                  ?.parentElement?.querySelector<HTMLButtonElement>(
                    "[data-equip-item]",
                  )
                  ?.focus(),
              );
            }
          }}
          aria-label={t(label)}
          placeholder={t("搜索物品、拼音或简称…")}
          autoComplete="off"
          maxLength={100}
          className="h-8 w-full min-w-0 pl-7 pr-7 text-xs"
        />
        {query && (
          <button
            type="button"
            aria-label={t("清除物品搜索")}
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute right-1 p-1 text-[var(--text-muted)]"
          >
            <X size={12} />
          </button>
        )}
      </label>
      {
        <div
          className="mt-1 max-h-[min(40rem,calc(100dvh-112px))] overflow-y-auto p-1"
          data-item-picker
        >
          <p
            role="status"
            className="px-1 pb-1 text-[10px] text-[var(--text-muted)]"
          >
            {t("{count} 件物品 · 点击装备", { count: filtered.length })}
          </p>
          {!filtered.length ? (
            <p className="p-3 text-xs text-[var(--text-secondary)]">
              {t("没有匹配的物品")}
            </p>
          ) : (
            <InfiniteList
              source={{
                kind: "local",
                items: filtered,
                chunkSize: 48,
                identity: `inventory:${catalogKey}:${query}:${locale}`,
              }}
              getKey={(item) => item.internalName}
              ariaLabel={t("可选物品")}
              chunkClassName={
                showEffects ? styles.effectPickerGrid : styles.pickerGrid
              }
              renderChunk={(chunk) =>
                chunk.map((item) => (
                  <div
                    key={item.internalName}
                    data-infinite-list-key={item.internalName}
                    className="flex min-w-0 items-center bg-black/15 hover:bg-white/5"
                  >
                    <button
                      type="button"
                      data-equip-item={item.internalName}
                      aria-label={t("装备：{name}", {
                        name: en ? item.enName : item.zhName,
                      })}
                      onClick={() => {
                        onEquip(item.internalName);
                        setQuery("");
                      }}
                      className={`flex min-w-0 flex-1 gap-1.5 p-1 text-left active:bg-white/10 ${showEffects ? "flex-col items-stretch" : "h-10 items-center"}`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ItemIcon
                          itemKey={item.internalName}
                          version={imageVersion}
                        />
                        <span className="min-w-0 text-[10px] leading-snug">
                          <span className="block truncate">
                            {en ? item.enName : item.zhName}
                          </span>
                          {!showEffects && (
                            <span className="text-[#d8c49a]">
                              {item.cost ?? "—"}
                            </span>
                          )}
                        </span>
                      </span>
                      {showEffects && (
                        <span
                          className="space-y-1 text-[10px] leading-snug"
                          data-item-effects
                        >
                          {!!item.stats.length && (
                            <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[#d8c49a]">
                              {item.stats
                                .filter(
                                  (stat) =>
                                    !/^[+-]?0(?:\.0+)?%?$/.test(
                                      stat.value.trim(),
                                    ),
                                )
                                .map((stat, index) => (
                                  <span key={`${stat.key}:${index}`}>
                                    {t(en ? stat.en : stat.zh)}{" "}
                                    <strong className="font-medium tabular-nums">
                                      {t(stat.value)}
                                    </strong>
                                  </span>
                                ))}
                            </span>
                          )}
                          <span className="line-clamp-2 text-[var(--text-secondary)]">
                            <SourceText
                              sourceLocale={
                                item.descriptionLocales?.[en ? "en" : "zh"]
                              }
                            >
                              {(
                                (en
                                  ? item.descriptions.en
                                  : item.descriptions.zh) ||
                                (!item.stats.length ? t("效果说明待补充") : "")
                              ).replace(/\s+/gu, " ")}
                            </SourceText>
                          </span>
                        </span>
                      )}
                    </button>
                    <ItemBrief item={item} imageVersion={imageVersion} />
                  </div>
                ))
              }
            />
          )}
        </div>
      }
    </div>
  );
});

function NeutralInventory({ children }: { children: ReactNode }) {
  const context = useHeroBuild()!;
  const {
    inventory,
    inventoryCatalog: catalog,
    inventoryDispatch: dispatch,
    inventoryProjection: projection,
    itemImageVersion: imageVersion,
  } = context;
  const t = useTranslations(),
    en = useLocale() === "en";
  const [target, setTarget] = useState<"neutral" | "enchantment" | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const tierGroup = useId();
  const tierControls = useRef<HTMLDivElement>(null);
  const tier = catalog?.neutralTiers.find(
    (t) => t.tier === inventory.neutralTier,
  );
  if (!tier)
    return (
      <div className="col-start-2 row-span-2 row-start-1 min-w-0">
        <p className="text-[10px] text-[var(--text-muted)]">
          {t("该版本暂无经核对的中立物品池。")}
        </p>
        {children}
      </div>
    );
  const selected = projection?.neutral;
  return (
    <div className="contents" data-neutral-inventory>
      <div
        className="col-start-2 row-start-1 flex min-w-0 items-center gap-0.5 [&>button]:h-5! [&>button]:w-5!"
        data-neutral-tier-controls
        ref={tierControls}
      >
        <fieldset
          aria-label={t("中立档位")}
          className="flex min-w-0 flex-1 gap-0.5"
        >
          {catalog!.neutralTiers.map((entry) => (
            <label key={entry.tier} className="relative min-w-0 flex-1">
              <input
                type="radio"
                name={tierGroup}
                value={entry.tier}
                aria-label={t("{tier} 级", { tier: entry.tier })}
                checked={inventory.neutralTier === entry.tier}
                onChange={() => {
                  dispatch({ type: "neutral-tier", tier: entry.tier });
                }}
                className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
              />
              <span className="flex h-6 items-center justify-center rounded-sm bg-white/5 text-[10px] tabular-nums text-[var(--text-secondary)] peer-hover:bg-white/10 peer-checked:bg-[#e4c584]/20 peer-checked:font-semibold peer-checked:text-[#f2d597] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#e4c584]">
                {entry.tier}
              </span>
            </label>
          ))}
        </fieldset>
        <PageInfoTooltip label={t("中立配置说明")}>
          {t(
            "候选随版本、主属性变化；附魔数值随档位变化。换档清空附魔，保留符合档位的物品。两者各占独立槽，不计金币；条件效果在下方配置。",
          )}
        </PageInfoTooltip>
      </div>

      <div className="col-start-2 row-start-2 grid min-w-0 grid-cols-2 grid-rows-[3rem_minmax(0,1fr)] self-stretch gap-x-0.5 gap-y-0.5">
        {(["neutral", "enchantment"] as const).map((kind) => {
          const item =
            kind === "neutral" ? projection?.neutral : projection?.enchantment;
          const label = t(kind === "neutral" ? "中立物品" : "中立附魔");
          return (
            <HeroStatRelation key={kind} field={kind}>
              <div
                data-neutral-slot={kind}
                className={`${styles.slot} ${styles.neutral}`}
              >
                <ItemSlotTrigger
                  item={item ?? undefined}
                  imageVersion={imageVersion}
                  sourceId={kind}
                  aria-label={t("配置：{name}", { name: label })}
                  aria-pressed={target === kind}
                  aria-haspopup="dialog"
                  aria-expanded={target === kind}
                  disabled={
                    kind === "enchantment" &&
                    selected?.internalName === "item_divine_regalia" &&
                    inventory.neutral?.choice === "dead"
                  }
                  onClick={(event) => {
                    setTarget(kind);
                    setPickerAnchor(event.currentTarget);
                  }}
                  className="flex h-12 w-full min-w-0 flex-col items-center justify-center gap-0.5 text-[var(--text-secondary)] hover:text-white aria-pressed:text-[#e4c584]"
                >
                  <span className={styles.object}>
                    {item ? (
                      <ItemIcon
                        itemKey={item.internalName}
                        version={imageVersion}
                      />
                    ) : (
                      <Plus
                        size={18}
                        className="shrink-0 text-[var(--text-muted)]"
                      />
                    )}
                  </span>
                  <span
                    title={
                      item
                        ? `${label}：${en ? item.enName : item.zhName}`
                        : label
                    }
                    className="w-full truncate text-center text-[10px] leading-3"
                  >
                    {item ? (en ? item.enName : item.zhName) : label}
                  </span>
                </ItemSlotTrigger>
                {item && (
                  <>
                    <button
                      type="button"
                      className={`${styles.action} absolute right-0 top-0 p-1 text-[var(--text-muted)] hover:bg-black/50 hover:text-white`}
                      aria-label={t("移除：{name}", { name: label })}
                      onClick={() =>
                        dispatch({
                          type: "neutral-equip",
                          target: kind,
                          item: null,
                        })
                      }
                    >
                      <X size={11} />
                    </button>
                    <div className={`${styles.action} absolute left-0 top-0`}>
                      <ItemBrief item={item} imageVersion={imageVersion} />
                    </div>
                  </>
                )}
              </div>
            </HeroStatRelation>
          );
        })}
        {children}
      </div>
      {target && pickerAnchor && (
        <InventoryPickerPanel
          anchor={pickerAnchor}
          inputRef={input}
          title={t(target === "neutral" ? "中立物品" : "中立附魔")}
          relatedControlsRef={tierControls}
          onClose={() => setTarget(null)}
        >
          <ItemPicker
            key={target}
            catalogKey={`${target}:${inventory.neutralTier}`}
            showEffects
            items={target === "neutral" ? tier.items : tier.enchantments}
            imageVersion={imageVersion}
            inputRef={input}
            label={target === "neutral" ? "搜索中立物品" : "搜索中立附魔"}
            onEquip={(item) => {
              dispatch({ type: "neutral-equip", target, item });
              setTarget(null);
              pickerAnchor.focus({ preventScroll: true });
            }}
          />
        </InventoryPickerPanel>
      )}
      {selected && (
        <div className="col-span-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-secondary)]">
          {!!selected.choices.length && (
            <CompactSelect
              label={t(
                selected.internalName === "item_occult_bracelet"
                  ? "受击层数"
                  : selected.internalName === "item_unrelenting_eye"
                    ? "附近敌方英雄数"
                    : "中立物品状态",
              )}
              value={inventory.neutral?.choice ?? ""}
              onValueChange={(value) =>
                dispatch({
                  type: "neutral-choice",
                  choice: value,
                })
              }
            >
              {selected.choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {t(c.label)}
                </option>
              ))}
            </CompactSelect>
          )}
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={inventory.curio}
              onChange={(e) =>
                dispatch({ type: "curio", enabled: e.target.checked })
              }
              className="accent-[#d8bc7f]"
            />
            {t("珍品强化")}
          </label>
          <PageInfoTooltip label={t("珍品强化说明")}>
            {t("持有休眠珍品打造：指定物品效果＋30%，附魔不变。")}
          </PageInfoTooltip>
          {selected.enchantmentAmplification && (
            <label className="flex items-center gap-1">
              {t("再次打造次数")}
              <input
                aria-label={t("再次打造次数")}
                type="number"
                min={0}
                max={100}
                value={inventory.baubleRecrafts}
                onChange={(e) =>
                  dispatch({
                    type: "bauble-recrafts",
                    count: Number(e.target.value),
                  })
                }
                className="w-12 bg-black/20 px-1 py-0.5"
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function ItemSlotTrigger({
  item,
  imageVersion,
  sourceId,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  item?: InventoryItem;
  imageVersion: string | null;
  sourceId: string;
}) {
  const highlight = useSourceHighlight();
  if (!item)
    return (
      <button type="button" {...props}>
        {children}
      </button>
    );
  return (
    <HoverTooltip
      className={props.className}
      buttonProps={props}
      openOnClick={false}
      onOpenChange={(open) => highlight?.(open ? sourceId : null)}
      content={
        <ItemDetailContent
          item={item}
          imageVersion={imageVersion}
          sourceId={sourceId}
        />
      }
    >
      {children}
    </HoverTooltip>
  );
}
function ItemDetailContent({
  item,
  imageVersion,
  sourceId,
}: {
  item: InventoryItem;
  imageVersion: string | null;
  sourceId?: string;
}) {
  const t = useTranslations(),
    en = useLocale() === "en";
  return (
    <div className="text-xs">
      <div className="mb-2 flex items-center gap-2">
        <ItemIcon itemKey={item.internalName} version={imageVersion} />
        <strong>{en ? item.enName : item.zhName}</strong>
      </div>
      <ItemSummary item={item} en={en} compact />
      {sourceId && <SourceChanges sourceId={sourceId} />}
      <Link
        href={`/items/${item.internalName}`}
        className="mt-2 inline-block text-xs text-[#e4c584]"
      >
        {t("查看完整物品资料")}
      </Link>
    </div>
  );
}
