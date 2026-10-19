import { neutralPool } from "./neutral-pool";
import type { KeyValuesObject } from "@/importers/keyvalues/parser";
import { itemCatalogRow, type ItemDefinition } from "@/domain/items";
import type {
  InventoryCatalog,
  InventoryEffect,
  InventoryItem,
  HeroStatusDefinition,
} from "@/domain/hero-inventory";
import type { FlatHeroStat, HeroStatModifier } from "@/domain/hero-build";
import { supportsHeroStats } from "@/presentation/hero-stats";

const scalar = (root: KeyValuesObject, key: string) => {
  const value = root.entries.findLast((entry) => entry.key === key)?.value;
  return typeof value === "string" ? value : undefined;
};
const object = (root: KeyValuesObject, key: string) => {
  const value = root.entries.findLast((entry) => entry.key === key)?.value;
  return typeof value === "object" ? value : undefined;
};
const flatFields: Record<string, FlatHeroStat> = {
  bonus_strength: "strength",
  bonus_str: "strength",
  bonus_agility: "agility",
  bonus_intellect: "intelligence",
  bonus_int: "intelligence",
  bonus_health: "health",
  bonus_hp: "health",
  bonus_mana: "mana",
  bonus_damage: "attackDamage",
  bonus_armor: "armor",
  bonus_attack_speed: "attackSpeed",
  bonus_health_regen: "healthRegen",
  bonus_hp_regen: "healthRegen",
  bonus_regen: "healthRegen",
  bonus_mana_regen: "manaRegen",
  bonus_mp_regen: "manaRegen",
};
const boots = new Set(
  [
    "boots",
    "phase_boots",
    "power_treads",
    "travel_boots",
    "travel_boots_2",
    "tranquil_boots",
    "arcane_boots",
    "guardian_greaves",
    "boots_of_bearing",
  ].map((id) => `item_${id}`),
);
const yasha = new Set([
  "item_yasha",
  "item_manta",
  "item_sange_and_yasha",
  "item_yasha_and_kaya",
]);

type InventorySnapshot = {
  items: ItemDefinition[];
  raw: KeyValuesObject;
  neutralRaw?: KeyValuesObject | null;
  provenance?: object;
};
function adaptInventoryItems(
  snapshot: InventorySnapshot,
  supported: boolean,
  primary: string,
  levels?: Map<string, number>,
) {
  const all = new Map<string, InventoryItem>();
  for (const item of snapshot.items) {
    if (levels && !levels.has(item.internalName)) continue;
    const raw = object(snapshot.raw, item.internalName);
    if (!raw) throw new Error(`Missing item source: ${item.internalName}`);
    if (scalar(raw, "ItemRecipe") === "1" || scalar(raw, "IsObsolete") === "1")
      continue;
    if (
      !levels &&
      scalar(raw, "ItemPurchasable") === "0" &&
      item.internalName !== "item_ultimate_scepter_roshan"
    )
      continue;
    if (
      !levels &&
      item.category !== "equipment" &&
      item.internalName !== "item_ultimate_scepter_roshan"
    )
      continue;
    const values = object(raw, "AbilityValues");
    // ItemBaseLevel, not a number guessed from the name, selects Dagon's current level.
    const level =
      levels?.get(item.internalName) ??
      Math.max(1, Number(scalar(raw, "ItemBaseLevel") ?? 1));
    const value = (field: string): number | null => {
      const entry = values?.entries.findLast((e) => e.key === field)?.value;
      const text =
        typeof entry === "string"
          ? entry
          : entry
            ? scalar(entry, "value")
            : undefined;
      if (!text) return null;
      const parts = text.trim().split(/\s+/u);
      if (!parts.every((n) => /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(n)))
        return null;
      return Number(parts[Math.min(level - 1, parts.length - 1)]);
    };
    const effects: InventoryEffect[] = [];
    const add = (
      target: InventoryEffect[],
      field: string,
      modifier: Omit<HeroStatModifier, "amount">,
      group?: string,
      attackType?: "melee" | "ranged",
      sign = 1,
    ) => {
      const amount = value(field);
      if (amount !== null && amount !== 0)
        target.push({
          ...modifier,
          amount: amount * sign,
          field,
          ...(scalar(
            object(values ?? { entries: [] }, field) ?? { entries: [] },
            "apply_curio_bonus",
          ) === "1"
            ? { curio: true }
            : {}),
          ...(group ? { group } : {}),
          ...(attackType ? { attackType } : {}),
        } as InventoryEffect);
    };
    const flat = (
      field: string,
      stat: FlatHeroStat,
      group?: string,
      attackType?: "melee" | "ranged",
    ) => add(effects, field, { kind: "flat", stat }, group, attackType);
    const percent = (
      field: string,
      stat: Extract<HeroStatModifier, { kind: "percent" }>["stat"],
      group?: string,
    ) => add(effects, field, { kind: "percent", stat }, group);
    const id = item.internalName;
    for (const [field, stat] of Object.entries(flatFields)) {
      // Hurricane Pike's attack speed is a target-restricted active effect.
      if (
        ["item_hurricane_pike", "item_duelist_gloves"].includes(id) &&
        stat === "attackSpeed"
      )
        continue;
      if (id === "item_rapier" && field === "bonus_damage") continue;
      flat(field, stat);
    }
    for (const field of ["bonus_all_stats", "bonus_stats"])
      for (const stat of ["strength", "agility", "intelligence"] as const)
        flat(field, stat);
    const movementGroup = boots.has(id) ? "boots" : `movement:${id}`;
    if (!yasha.has(id) && id !== "item_smoke_of_deceit")
      flat("bonus_movement_speed", "movementSpeed", movementGroup);
    if (yasha.has(id)) {
      percent("bonus_movement_speed", "movementSpeed", "yasha");
      percent("movement_speed_percent_bonus", "movementSpeed", "yasha");
    }
    for (const field of [
      "bonus_movement_speed_ranged",
      "bonus_movement_speed_melee",
    ])
      flat(
        field,
        "movementSpeed",
        movementGroup,
        field.endsWith("ranged") ? "ranged" : "melee",
      );
    if (boots.has(id)) flat("bonus_movement", "movementSpeed", "boots");
    flat("self_movement_speed", "movementSpeed", `movement:${id}`);
    if (id === "item_wind_lace")
      flat("movement_speed", "movementSpeed", "wind-lace");
    flat("bonus_damage_melee", "attackDamage", undefined, "melee");
    flat("bonus_damage_range", "attackDamage", undefined, "ranged");
    if (
      [
        "item_dragon_lance",
        "item_hurricane_pike",
        "item_hydras_breath",
      ].includes(id)
    )
      flat("base_attack_range", "attackRange", "dragon-range", "ranged");
    if (id === "item_monkey_king_bar")
      flat("melee_attack_range", "attackRange", `range:${id}`, "melee");
    flat(
      "bonus_night_vision",
      "nightVision",
      id === "item_moon_shard" ? "moon-vision" : undefined,
    );
    for (const field of [
      "bonus_magical_armor",
      "bonus_spell_resist",
      "magic_resistance",
    ])
      add(
        effects,
        field,
        { kind: "resistance", stat: "magicResistance" },
        `resist:${id}`,
      );
    for (const field of ["bonus_evasion", "evasion"])
      add(
        effects,
        field,
        { kind: "resistance", stat: "evasion" },
        `evasion:${id}`,
      );
    percent("bonus_max_mana_percentage", "mana");
    percent("mana_regen_multiplier", "manaRegen", "kaya-regen");
    percent("hp_regen_amp", "healthRegen", "sange-regen");
    if (id === "item_heart")
      percent("hp_regen", "maxHealthRegen", "heart-regen");
    if (id === "item_enchanted_mango") flat("hp_regen", "healthRegen");
    if (id === "item_butterfly")
      percent("bonus_attack_speed_pct", "baseAttackSpeed");
    for (const field of ["spell_amp", "bonus_spell_amp"])
      if (id !== "item_rapier")
        flat(
          field,
          "spellAmplification",
          item.category === "equipment" ? "spell-amp" : `spell-amp:${id}`,
        );
    flat(
      "cast_range_bonus",
      "castRangeBonus",
      item.category === "equipment" ? "cast-range" : `cast-range:${id}`,
    );
    flat("bonus_cooldown", "cooldownReduction", `cooldown:${id}`);
    flat("lifesteal_percent", "lifesteal", `lifesteal:${id}`);
    flat("spell_lifesteal", "spellLifesteal", "spell-lifesteal");
    // These unprefixed fields have passive semantics only for these specific items.
    if (["item_pipe", "item_headdress"].includes(id))
      flat("health_regen", "healthRegen");
    if (
      [
        "item_infused_raindrop",
        "item_vladmir",
        "item_ring_of_basilius",
        "item_urn_of_shadows",
        "item_spirit_vessel",
        "item_arcane_boots",
        "item_guardian_greaves",
      ].includes(id)
    )
      flat("mana_regen", "manaRegen");
    if (["item_vladmir", "item_buckler"].includes(id)) flat("armor", "armor");
    if (["item_specialists_array", "item_hydras_breath"].includes(id)) {
      flat("strength", "strength");
      flat("agility", "agility");
      flat("damage", "attackDamage");
    }
    // Friendly auras affect the owner; shared aura families do not add twice.
    if (
      [
        "item_headdress",
        "item_mekansm",
        "item_guardian_greaves",
        "item_ancient_janggo",
        "item_boots_of_bearing",
        "item_pipe",
      ].includes(id)
    )
      flat("aura_health_regen", "healthRegen", `regen-aura:${id}`);
    if (
      [
        "item_ring_of_basilius",
        "item_arcane_boots",
        "item_guardian_greaves",
      ].includes(id)
    )
      flat(
        "aura_mana_regen",
        "manaRegen",
        id === "item_guardian_greaves" ? "greaves-aura" : "basilius-aura",
      );
    if (id === "item_vladmir") {
      flat("armor_aura", "armor", "vladmir-aura");
      flat("mana_regen_aura", "manaRegen", "vladmir-aura");
      percent("damage_aura", "baseAttackDamage", "vladmir-aura");
      flat("lifesteal_aura", "lifesteal", "vladmir-aura");
    }
    if (id === "item_buckler") flat("bonus_aoe_armor", "armor", "buckler-aura");
    if (id === "item_assault") {
      flat("aura_attack_speed", "attackSpeed", "assault-aura");
      flat("aura_positive_armor", "armor", "assault-aura");
    }
    if (id === "item_pipe")
      add(
        effects,
        "magic_resistance_aura",
        { kind: "resistance", stat: "magicResistance" },
        "pipe-aura",
      );
    if (["item_ancient_janggo", "item_boots_of_bearing"].includes(id))
      flat("aura_movement_speed", "movementSpeed", "drum-aura");
    if (item.category === "enchantment") {
      flat("health_bonus", "health");
      flat("health_regen", "healthRegen");
      flat("mana_regen", "manaRegen");
      flat("armor", "armor");
      flat("movement_speed", "movementSpeed");
      flat("movespeed", "movementSpeed");
      percent("movespeed_pct", "movementSpeed");
      flat("bonus_attack_range", "attackRange");
      flat("attack_lifesteal", "lifesteal");
      flat("cooldown_reduction", "cooldownReduction", `cooldown:${id}`);
      flat("manacost_reduction", "manaCostReduction");
      flat("slow_resist", "slowResistance");
      flat("knockback_resist", "knockbackResistance");
      flat("status_resistance", "statusResistance");
      flat("debuff_amp", "debuffAmplification");
      flat("incoming_damage", "incomingDamage");
      flat("magic_damage", "onHitMagicDamage");
      flat("cast_speed", "castSpeed");
      flat("bonus_gpm", "goldPerMinute");
      add(effects, "magic_res", {
        kind: "resistance",
        stat: "magicResistance",
      });
      percent("health_restoration", "healthRegen");
      flat("health_restoration", "healingAmplification");
      percent("intelligence_pct", "intelligence");
      percent("base_attack_damage", "baseAttackDamage");
      percent("max_health", "health");
      percent("max_health_regen", "maxHealthRegen");
      add(
        effects,
        "mana_reduction_pct",
        { kind: "percent", stat: "mana" },
        undefined,
        undefined,
        -1,
      );
      add(
        effects,
        "hp_regen_reduce",
        { kind: "flat", stat: "healthRegen" },
        undefined,
        undefined,
        -1,
      );
      add(
        effects,
        "vision_reduce",
        { kind: "percent", stat: "dayVision" },
        undefined,
        undefined,
        -1,
      );
      add(
        effects,
        "vision_reduce",
        { kind: "percent", stat: "nightVision" },
        undefined,
        undefined,
        -1,
      );
      add(
        effects,
        "bat_reduce",
        { kind: "percent", stat: "baseAttackTime" },
        undefined,
        undefined,
        -1,
      );
      if (id === "item_enhancement_feverish")
        add(
          effects,
          "max_mana",
          { kind: "percent", stat: "mana" },
          undefined,
          undefined,
          -1,
        );
      else flat("max_mana", "mana");
      if (["item_enhancement_hulking", "item_enhancement_titanic"].includes(id))
        percent("attack_speed", "attackSpeed");
      else flat("attack_speed", "attackSpeed");
      if (id === "item_enhancement_evolved") {
        if (primary === "universal")
          for (const stat of ["strength", "agility", "intelligence"] as const)
            flat("primary_stat_universal", stat);
        else if (["strength", "agility", "intelligence"].includes(primary))
          flat("primary_stat", primary as FlatHeroStat);
      }
    }
    if (id === "item_harmonizer")
      flat("manacost_reduction", "manaCostReduction");
    const choices: InventoryItem["choices"] = [];
    if (id === "item_stonefeather_satchel") {
      const feathers: InventoryEffect[] = [],
        rocks: InventoryEffect[] = [];
      add(feathers, "feather_movespeed", {
        kind: "flat",
        stat: "movementSpeed",
      });
      add(
        feathers,
        "knockback_resistance",
        { kind: "flat", stat: "knockbackResistance" },
        undefined,
        undefined,
        -1,
      );
      add(rocks, "rocks_armor", { kind: "flat", stat: "armor" });
      add(rocks, "knockback_resistance", {
        kind: "flat",
        stat: "knockbackResistance",
      });
      choices.push(
        { id: "feathers", label: "羽毛", effects: feathers },
        { id: "rocks", label: "石头", effects: rocks },
      );
    }

    const toggle = (
      label: string,
      fields: Array<[string, HeroStatModifier["kind"], string, number?]>,
    ) => {
      const active: InventoryEffect[] = [];
      for (const [field, kind, stat, sign] of fields)
        add(
          active,
          field,
          { kind, stat } as Omit<HeroStatModifier, "amount">,
          undefined,
          undefined,
          sign ?? 1,
        );
      choices.push(
        { id: "off", label: "未生效", effects: [] },
        { id: "on", label, effects: active },
      );
    };
    if (id === "item_duelist_gloves")
      toggle("附近有敌方英雄", [["bonus_attack_speed", "flat", "attackSpeed"]]);
    if (id === "item_essence_ring")
      toggle("生命精华", [["health_gain", "flat", "health"]]);
    if (id === "item_flayers_bota")
      toggle("嗜血", [
        ["base_damage", "percent", "baseAttackDamage"],
        ["attack_speed", "flat", "attackSpeed"],
      ]);
    if (id === "item_metamorphic_mandible")
      toggle("化蛹", [
        ["bonus_magic_resistance", "resistance", "magicResistance"],
        ["bonus_movespeed", "percent", "movementSpeed"],
        ["armor_decrease", "percent", "armor", -1],
      ]);
    if (id === "item_occult_bracelet") {
      const amount = value("mana_regen"),
        maximum = value("stack_limit");
      if (amount !== null && maximum !== null)
        for (let stack = 0; stack <= maximum; stack++)
          choices.push({
            id: String(stack),
            label: String(stack),
            effects: [
              {
                kind: "flat",
                stat: "manaRegen",
                amount: amount * stack,
                field: "mana_regen",
              },
            ],
          });
    }
    if (id === "item_unrelenting_eye") {
      const max = value("max_slow_res"),
        reduction = value("hero_reduction");
      if (max !== null && reduction !== null)
        for (let enemies = 0; enemies <= 5; enemies++)
          choices.push({
            id: String(enemies),
            label: String(enemies),
            effects: [
              {
                kind: "flat",
                stat: "slowResistance",
                amount: Math.max(0, max - enemies * reduction),
                field: "max_slow_res",
              },
            ],
          });
    }
    if (id === "item_divine_regalia") {
      const active: InventoryEffect[] = [];
      add(active, "outgoing_damage", { kind: "flat", stat: "outgoingDamage" });
      choices.push(
        { id: "alive", label: "尚未死亡", effects: active },
        { id: "dead", label: "死亡后失效", effects: [] },
      );
    }
    if (id === "item_dezun_bloodrite") flat("aoe_pct", "spellArea");
    if (id === "item_power_treads")
      for (const [stat, label] of [
        ["strength", "力量"],
        ["agility", "敏捷"],
        ["intelligence", "智力"],
      ] as const) {
        const selected: InventoryEffect[] = [];
        add(selected, "bonus_stat", { kind: "flat", stat });
        choices.push({ id: stat, label, effects: selected });
      }
    if (id === "item_armlet") {
      const active: InventoryEffect[] = [];
      add(active, "unholy_bonus_damage", {
        kind: "flat",
        stat: "attackDamage",
      });
      add(active, "unholy_bonus_strength", { kind: "flat", stat: "strength" });
      add(active, "unholy_bonus_armor", { kind: "flat", stat: "armor" });
      // Drain is not health regeneration and must not be multiplied by regen amplification.
      choices.push(
        { id: "off", label: "关闭", effects: [] },
        { id: "on", label: "邪恶之力", effects: active },
      );
    }
    if (id === "item_rapier") {
      flat("bonus_damage_base", "attackDamage");
      const attack: InventoryEffect[] = [],
        spell: InventoryEffect[] = [];
      add(attack, "bonus_damage", { kind: "flat", stat: "attackDamage" });
      add(spell, "bonus_spell_amp", {
        kind: "flat",
        stat: "spellAmplification",
      });
      choices.push(
        { id: "attack", label: "攻击力", effects: attack },
        { id: "spell", label: "技能增强", effects: spell },
      );
    }
    if (id === "item_tranquil_boots") {
      const speed = value("bonus_movement_speed"),
        broken = value("broken_movement_speed"),
        regen = value("bonus_health_regen");
      const normal = effects.filter(
        (effect) =>
          effect.stat === "movementSpeed" || effect.stat === "healthRegen",
      );
      for (let i = effects.length - 1; i >= 0; i--)
        if (normal.includes(effects[i])) effects.splice(i, 1);
      choices.push(
        { id: "normal", label: "完好", effects: normal },
        {
          id: "broken",
          label: "破损",
          effects:
            speed !== null && broken !== null && regen !== null
              ? [
                  {
                    kind: "flat",
                    stat: "movementSpeed",
                    amount: broken,
                    field: "broken_movement_speed",
                    group: "boots",
                  },
                ]
              : [],
        },
      );
    }
    all.set(id, {
      ...itemCatalogRow(item),
      ...(levels
        ? {
            cost: "0",
            stats: itemCatalogRow(item).stats.map((stat) => {
              const pieces = stat.value.split(" / ");
              const suffix = stat.value.endsWith("%") ? "%" : "";
              return pieces.length > 1
                ? {
                    ...stat,
                    value:
                      pieces[Math.min(level - 1, pieces.length - 1)].replace(
                        /%$/,
                        "",
                      ) + suffix,
                  }
                : stat;
            }),
          }
        : {}),
      enchantmentAmplification:
        id === "item_enchanters_bauble"
          ? {
              base: value("enchantment_bonus_base") ?? 0,
              growth: value("enchantment_bonus_growth") ?? 0,
            }
          : undefined,
      effects: supported ? effects : [],
      choices: supported ? choices : [],
      searchText: [id, item.zhName, item.enName]
        .join("|")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s_'’\-]+/gu, ""),
      initialCharges: Math.max(
        1,
        Number(scalar(raw, "ItemInitialCharges") ?? 1),
      ),
      hasCombatEffects: Boolean(item.descriptions.en || item.descriptions.zh),
    });
  }
  if (levels && all.size !== levels.size)
    throw new Error(
      "Neutral pool references missing or obsolete item definitions",
    );
  return all;
}

/** Audited semantics; values and tier membership come from the pinned VPK. */
export function adaptInventory(
  snapshot: InventorySnapshot,
  source: Omit<InventoryCatalog["source"], "adapterVersion">,
  primary = "strength",
): InventoryCatalog {
  const supported = supportsHeroStats(source.commit);
  const all = adaptInventoryItems(snapshot, supported, primary);
  const neutralTiers = neutralPool(snapshot.neutralRaw, primary).map(
    (pool) => ({
      tier: pool.tier,
      items: [
        ...adaptInventoryItems(
          snapshot,
          supported,
          primary,
          pool.items,
        ).values(),
      ],
      enchantments: [
        ...adaptInventoryItems(
          snapshot,
          supported,
          primary,
          pool.enchantments,
        ).values(),
      ],
    }),
  );
  const statuses: HeroStatusDefinition[] = [];
  const status = (
    id: string,
    item: string,
    name: string,
    description: string,
    fields: Array<[string, HeroStatModifier["kind"], string, string?]>,
    options: Partial<HeroStatusDefinition> = {},
  ) => {
    const original = snapshot.items.find((i) => i.internalName === item);
    const raw = object(snapshot.raw, item);
    if (!original || !raw) return;
    const effects: InventoryEffect[] = [];
    for (const [field, kind, stat, group] of fields) {
      const rawValue = scalar(
        object(raw, "AbilityValues") ?? { entries: [] },
        field,
      );
      if (rawValue === undefined || !Number.isFinite(Number(rawValue))) return;
      effects.push({
        field,
        kind,
        stat,
        amount: Number(rawValue),
        ...(group ? { group } : {}),
      } as InventoryEffect);
    }
    statuses.push({
      id,
      item,
      name,
      description,
      effects: supported ? effects : [],
      duration: null,
      cost: Number(original.cost ?? 0),
      sourceModifier: null,
      sourceFields: fields.map(([field]) => field),
      ...options,
    });
  };
  status(
    "scepter-consumed",
    "item_ultimate_scepter_2",
    "阿哈利姆福佑",
    "已吞服神杖，获得技能升级；不保留神杖的属性加成。",
    [],
    {
      group: "scepter",
      upgrade: "scepter",
      sourceModifier: null,
    },
  );
  status(
    "scepter-gifted",
    "item_ultimate_scepter",
    "炼金赠予神杖",
    "炼金术士赠予，获得技能升级和神杖完整属性；替代已有神杖或福佑，本人购入价值为0。",
    [],
    {
      group: "scepter",
      upgrade: "scepter",
      cost: 0,
      effects: all.get("item_ultimate_scepter")?.effects ?? [],
      sourceModifier: null,
      sourceFields:
        all.get("item_ultimate_scepter")?.effects.map((e) => e.field) ?? [],
    },
  );
  status(
    "shard",
    "item_aghanims_shard",
    "阿哈利姆魔晶",
    "已吸收魔晶，升级对应技能或解锁新技能，不占装备槽。",
    [],
    { upgrade: "shard", sourceModifier: "modifier_item_aghanims_shard" },
  );
  status(
    "moon-consumed",
    "item_moon_shard",
    "银月祝福",
    "已吞服银月之晶。攻速与持有的银月叠加，夜间视野取较高值；每个英雄只能吸收一次。",
    [
      ["consumed_bonus", "flat", "attackSpeed"],
      ["consumed_bonus_night_vision", "flat", "nightVision", "moon-vision"],
    ],
    { sourceModifier: "modifier_item_moon_shard_consumed" },
  );
  for (const [id, name, description, field, stat] of [
    [
      "tango",
      "树之祭祀恢复",
      "食用普通树木后的恢复状态。",
      "health_regen",
      "healthRegen",
    ],
    [
      "flask",
      "药膏恢复",
      "对自己使用药膏后的恢复状态，受到英雄或肉山攻击时中断。",
      "health_regen",
      "healthRegen",
    ],
    [
      "clarity",
      "净化恢复",
      "使用净化药水后的恢复状态，受到英雄或肉山攻击时中断。",
      "mana_regen",
      "manaRegen",
    ],
  ]) {
    const item = snapshot.items.find((i) => i.internalName === `item_${id}`);
    const duration = Number(
      item?.stats.find((s) => s.key === "buff_duration")?.value,
    );
    status(
      `${id}-regen`,
      `item_${id}`,
      name,
      description,
      [[field, "flat", stat]],
      {
        duration: Number.isFinite(duration) ? duration : null,
        cost:
          Number(item?.cost ?? 0) /
          (all.get(`item_${id}`)?.initialCharges ?? 1),
        sourceModifier:
          id === "flask"
            ? "modifier_flask_healing"
            : id === "clarity"
              ? "modifier_clarity_potion"
              : "modifier_tango_heal",
      },
    );
  }
  const consumers: Record<string, string> = {
    item_ultimate_scepter: "scepter-consumed",
    item_ultimate_scepter_2: "scepter-consumed",
    item_aghanims_shard: "shard",
    item_moon_shard: "moon-consumed",
    item_tango: "tango-regen",
    item_flask: "flask-regen",
    item_clarity: "clarity-regen",
  };
  for (const [id, consumeStatus] of Object.entries(consumers)) {
    const item = all.get(id);
    if (item && statuses.some((s) => s.id === consumeStatus)) {
      item.consumeStatus = consumeStatus;
      item.automatic = [
        "item_ultimate_scepter_2",
        "item_aghanims_shard",
      ].includes(id);
    }
  }
  all.delete("item_ultimate_scepter_roshan");
  return {
    items: [...all.values()],
    statuses,
    neutralTiers,
    supported,
    source: { ...source, adapterVersion: "hero-inventory-v1" },
    provenance: {
      ...snapshot.provenance,
      importer_version: "hero-inventory-v1",
      schema_version: "hero-inventory-v1",
      primary_attribute: primary,
    },
  };
}
