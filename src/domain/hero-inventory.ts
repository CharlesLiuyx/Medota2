import { statusAtLevel, type StatusProvider } from "./hero-status-catalog";
import type { HeroStatModifier } from "./hero-build";
import type { ItemCatalogRow } from "./items";

export type InventoryEffect = HeroStatModifier & {
  /** Effects in one group use their strongest value, not their sum. */
  group?: string;
  attackType?: "melee" | "ranged";
  field: string;
  curio?: boolean;
};
export interface InventoryItem extends ItemCatalogRow {
  searchText: string;
  effects: InventoryEffect[];
  choices: Array<{ id: string; label: string; effects: InventoryEffect[] }>;
  initialCharges: number;
  enchantmentAmplification?: { base: number; growth: number };
  consumeStatus?: string;
  automatic?: boolean;
  /** Explicitly unprojected combat/conditional behavior remains readable. */
  hasCombatEffects: boolean;
}
export interface HeroStatusDefinition {
  id: string;
  name: string;
  description: string;
  item: string;
  group?: string;
  enName?: string;
  enDescription?: string;
  provider?: StatusProvider;
  sourceAbility?: { id: string; name: string; enName: string };
  searchText?: string;
  mapping?: "reviewed" | "prefix";
  coverage?: "partial" | "unmodeled";
  parameters?: Array<{
    field: string;
    name: string;
    enName: string;
    values: string[];
  }>;
  levels?: Array<{ effects: InventoryEffect[]; duration: number | null }>;
  selectedLevel?: number;
  effects: InventoryEffect[];
  upgrade?: "scepter" | "shard";
  duration: number | null;
  cost: number;
  /** Identity in the pinned VPK localization, when Valve exposes one. */
  sourceModifier: string | null;
  sourceFields: string[];
  sourcePaths?: string[];
}
export interface InventoryCatalog {
  items: InventoryItem[];
  statuses: HeroStatusDefinition[];
  neutralTiers: Array<{
    tier: number;
    items: InventoryItem[];
    enchantments: InventoryItem[];
  }>;
  supported: boolean;
  provenance?: object;
  source: {
    repository: string;
    commit: string;
    path: string;
    clientVersion: string;
    adapterVersion: string;
  };
}
export interface InventorySlot {
  item: string;
  choice: string;
  charges: number;
  tier?: number;
}
export interface HeroInventory {
  slots: Array<InventorySlot | null>;
  statuses: string[];
  statusLevels?: Record<string, number>;
  neutralTier: number;
  neutral: InventorySlot | null;
  enchantment: InventorySlot | null;
  curio: boolean;
  baubleRecrafts: number;
}
export type InventoryAction =
  | { type: "equip"; item: string; slot: number }
  | { type: "remove"; slot: number }
  | { type: "choice"; slot: number; choice: string }
  | { type: "consume"; slot: number }
  | { type: "status"; id: string; enabled: boolean }
  | { type: "status-level"; id: string; level: number }
  | { type: "neutral-tier"; tier: number }
  | {
      type: "neutral-equip";
      target: "neutral" | "enchantment";
      item: string | null;
    }
  | { type: "neutral-choice"; choice: string }
  | { type: "curio"; enabled: boolean }
  | { type: "bauble-recrafts"; count: number }
  | { type: "reset" };
export const emptyInventory = (): HeroInventory => ({
  slots: Array.from({ length: 6 }, () => null),
  statuses: [],
  neutralTier: 1,
  neutral: null,
  enchantment: null,
  curio: false,
  baubleRecrafts: 0,
});
const scepters = new Set(["item_ultimate_scepter", "item_ultimate_scepter_2"]);

/** Local build choices only; no purchases, game time or database mutations. */
export function updateInventory(
  state: HeroInventory,
  action: InventoryAction,
  catalog: InventoryCatalog,
): HeroInventory {
  if (action.type === "reset") return emptyInventory();
  if (!catalog.supported) return state;
  if (action.type === "status-level") {
    const definition = catalog.statuses.find((s) => s.id === action.id);
    if (
      !state.statuses.includes(action.id) ||
      !definition?.levels ||
      !Number.isInteger(action.level) ||
      action.level < 1 ||
      action.level > definition.levels.length
    )
      return state;
    return {
      ...state,
      statusLevels: { ...state.statusLevels, [action.id]: action.level },
    };
  }
  const tier = catalog.neutralTiers.find((t) => t.tier === state.neutralTier);
  if (action.type === "neutral-tier") {
    if (!catalog.neutralTiers.some((t) => t.tier === action.tier)) return state;
    if (action.tier === state.neutralTier) return state;
    return {
      ...state,
      neutralTier: action.tier,
      neutral:
        state.neutral &&
        (state.neutral.tier ?? state.neutralTier) <= action.tier
          ? state.neutral
          : null,
      enchantment: null,
      curio:
        state.neutral &&
        (state.neutral.tier ?? state.neutralTier) <= action.tier
          ? state.curio
          : false,
      baubleRecrafts:
        state.neutral &&
        (state.neutral.tier ?? state.neutralTier) <= action.tier
          ? state.baubleRecrafts
          : 0,
    };
  }
  if (action.type === "neutral-equip") {
    if (
      action.target === "enchantment" &&
      action.item !== null &&
      state.neutral?.item === "item_divine_regalia" &&
      state.neutral.choice === "dead"
    )
      return state;
    if (action.item === null)
      return {
        ...state,
        [action.target]: null,
        ...(action.target === "neutral"
          ? { curio: false, baubleRecrafts: 0 }
          : {}),
      };
    const item = (
      action.target === "neutral" ? tier?.items : tier?.enchantments
    )?.find((i) => i.internalName === action.item);
    if (!item) return state;
    return {
      ...state,
      [action.target]: {
        item: item.internalName,
        choice: item.choices[0]?.id ?? "",
        charges: 1,
        tier: state.neutralTier,
      },
      ...(action.target === "neutral" ? { baubleRecrafts: 0 } : {}),
    };
  }
  if (action.type === "neutral-choice") {
    const item = catalog.neutralTiers
      .find((t) => t.tier === (state.neutral?.tier ?? state.neutralTier))
      ?.items.find((i) => i.internalName === state.neutral?.item);
    if (!state.neutral || !item?.choices.some((c) => c.id === action.choice))
      return state;
    return {
      ...state,
      neutral: { ...state.neutral, choice: action.choice },
      ...(item.internalName === "item_divine_regalia" &&
      action.choice === "dead"
        ? { enchantment: null }
        : {}),
    };
  }
  if (action.type === "curio")
    return state.neutral ? { ...state, curio: action.enabled } : state;
  if (action.type === "bauble-recrafts")
    return state.neutral?.item === "item_enchanters_bauble" &&
      Number.isInteger(action.count) &&
      action.count >= 0 &&
      action.count <= 100
      ? { ...state, baubleRecrafts: action.count }
      : state;
  const itemById = (id: string) =>
    catalog.items.find((item) => item.internalName === id);
  const addStatus = (id: string, slots = state.slots) => {
    const definition = catalog.statuses.find((status) => status.id === id);
    if (!definition) return state;
    const statuses = state.statuses.filter((key) => {
      const existing = catalog.statuses.find((status) => status.id === key);
      return (
        key !== id &&
        (!definition.group || existing?.group !== definition.group)
      );
    });
    return {
      ...state,
      slots:
        definition.group === "scepter"
          ? slots.map((slot) => (slot && scepters.has(slot.item) ? null : slot))
          : slots,
      statuses: [...statuses, id],
      statusLevels: Object.fromEntries(
        [...statuses, id].map((key) => [key, state.statusLevels?.[key] ?? 1]),
      ),
    };
  };
  if (action.type === "status")
    return action.enabled
      ? addStatus(action.id)
      : {
          ...state,
          statuses: state.statuses.filter((id) => id !== action.id),
          statusLevels: Object.fromEntries(
            Object.entries(state.statusLevels ?? {}).filter(
              ([id]) => id !== action.id,
            ),
          ),
        };
  if (!Number.isInteger(action.slot) || action.slot < 0 || action.slot >= 6)
    return state;
  const slots = [...state.slots];
  if (action.type === "equip") {
    const item = itemById(action.item);
    if (!item) return state;
    if (item.automatic && item.consumeStatus)
      return addStatus(item.consumeStatus);
    let statuses = state.statuses;
    if (scepters.has(item.internalName)) {
      // Scepter configuration modes are exclusive; switching modes replaces the old one.
      statuses = statuses.filter(
        (id) => catalog.statuses.find((s) => s.id === id)?.group !== "scepter",
      );
      slots.forEach((slot, i) => {
        if (slot && scepters.has(slot.item)) slots[i] = null;
      });
    }
    slots[action.slot] = {
      item: item.internalName,
      choice: item.choices[0]?.id ?? "",
      charges: item.initialCharges,
    };
    return { ...state, slots, statuses };
  }
  const slot = slots[action.slot];
  if (!slot) return state;
  const item = itemById(slot.item);
  if (action.type === "remove") slots[action.slot] = null;
  else if (action.type === "choice") {
    if (!item?.choices.some((choice) => choice.id === action.choice))
      return state;
    slots[action.slot] = { ...slot, choice: action.choice };
  } else if (action.type === "consume") {
    if (!item?.consumeStatus || state.statuses.includes(item.consumeStatus))
      return state;
    slots[action.slot] =
      slot.charges > 1 ? { ...slot, charges: slot.charges - 1 } : null;
    return addStatus(item.consumeStatus, slots);
  }
  return { ...state, slots };
}

export interface InventoryStatSource {
  id: string;
  name: string;
  enName?: string;
  modifiers: HeroStatModifier[];
  upgrade?: "scepter" | "shard";
}

export function projectInventory(
  state: HeroInventory,
  catalog: InventoryCatalog,
  attackType: string,
) {
  const items = new Map(catalog.items.map((item) => [item.internalName, item]));
  const statuses = catalog.statuses
    .filter((status) => state.statuses.includes(status.id))
    .map((status) =>
      statusAtLevel(status, state.statusLevels?.[status.id] ?? 1),
    );
  const sources: InventoryStatSource[] = [];
  const effects: Array<{
    effect: InventoryEffect;
    source: InventoryStatSource;
  }> = [];
  const addSource = (
    source: Omit<InventoryStatSource, "modifiers">,
    values: InventoryEffect[],
  ) => {
    const entry: InventoryStatSource = { ...source, modifiers: [] };
    sources.push(entry);
    effects.push(...values.map((effect) => ({ effect, source: entry })));
  };
  let inventoryValue = 0;
  let unknownPrices = 0;
  const equipped: InventoryItem[] = [];
  for (const [index, slot] of state.slots.entries()) {
    const item = slot && items.get(slot.item);
    if (!item || !slot) continue;
    equipped.push(item);
    if (item.cost === null) unknownPrices++;
    else
      inventoryValue +=
        (Number(item.cost) * slot.charges) / item.initialCharges;
    addSource(
      {
        id: `slot:${index}`,
        name: item.zhName,
        enName: item.enName,
        upgrade:
          item.internalName === "item_ultimate_scepter" ? "scepter" : undefined,
      },
      [
        ...item.effects,
        ...(item.choices.find((choice) => choice.id === slot.choice)?.effects ??
          []),
      ],
    );
  }
  const tier = catalog.neutralTiers.find((t) => t.tier === state.neutralTier);
  const neutral = catalog.neutralTiers
    .find((t) => t.tier === (state.neutral?.tier ?? state.neutralTier))
    ?.items.find((i) => i.internalName === state.neutral?.item);
  const enchantment = tier?.enchantments.find(
    (i) => i.internalName === state.enchantment?.item,
  );
  const neutralEffects = neutral
    ? [
        ...neutral.effects,
        ...(neutral.choices.find((c) => c.id === state.neutral?.choice)
          ?.effects ?? []),
      ]
    : [];
  const potency = state.curio ? 1.3 : 1;
  if (neutral)
    addSource(
      { id: "neutral", name: neutral.zhName, enName: neutral.enName },
      neutralEffects.map((e) => ({
        ...e,
        amount: e.amount * (e.curio ? potency : 1),
      })),
    );
  const amplification = neutral?.enchantmentAmplification;
  const enchantmentMultiplier = amplification
    ? 1 +
      (amplification.base +
        amplification.growth * potency * state.baubleRecrafts) /
        100
    : 1;
  if (
    enchantment &&
    !(
      neutral?.internalName === "item_divine_regalia" &&
      state.neutral?.choice === "dead"
    )
  )
    addSource(
      {
        id: "enchantment",
        name: enchantment.zhName,
        enName: enchantment.enName,
      },
      enchantment.effects.map((e) => ({
        ...e,
        amount: e.amount * enchantmentMultiplier,
      })),
    );
  for (const status of statuses)
    addSource(
      {
        id: `status:${status.id}`,
        name: status.name,
        enName: status.enName,
        upgrade: status.upgrade,
      },
      status.effects,
    );
  const grouped = new Map<string, (typeof effects)[number]>();
  const modifiers: HeroStatModifier[] = [];
  if (catalog.supported)
    for (const entry of effects) {
      const { effect, source } = entry;
      if (effect.attackType && effect.attackType !== attackType) continue;
      if (effect.group) {
        const key = `${effect.group}:${effect.kind}:${effect.stat}`;
        const previous = grouped.get(key);
        if (!previous || effect.amount > previous.effect.amount)
          grouped.set(key, entry);
      } else {
        modifiers.push(effect);
        source.modifiers.push(effect);
      }
    }
  for (const { effect, source } of grouped.values()) {
    modifiers.push(effect);
    source.modifiers.push(effect);
  }
  const upgrades = {
    scepter:
      catalog.supported &&
      (equipped.some((item) => item.internalName === "item_ultimate_scepter") ||
        statuses.some((s) => s.upgrade === "scepter")),
    shard: catalog.supported && statuses.some((s) => s.upgrade === "shard"),
  };
  return {
    modifiers,
    sources: catalog.supported ? sources : [],
    neutral,
    enchantment,
    enchantmentMultiplier,
    upgrades,
    statuses,
    equipped,
    unknownPrices,
    inventoryValue: Number(inventoryValue.toFixed(2)),
    configurationValue: Number(
      (
        inventoryValue + statuses.reduce((sum, status) => sum + status.cost, 0)
      ).toFixed(2),
    ),
  };
}
