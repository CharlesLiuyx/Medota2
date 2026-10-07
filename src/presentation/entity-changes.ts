import { createTranslator } from "@/i18n/messages";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locale";
import type {
  DiffValue,
  EntityVersionChange,
} from "@/domain/entity-version-diff";
import {
  gameText,
  numbers,
  valueLabel,
  tooltipValue,
  type ValueRow,
} from "./dota";

export interface ChangeIdentity {
  key: string;
  name: string;
  href?: string;
  heroKey?: string;
  values?: Record<string, string>;
  labels?: Record<string, string>;
  valueRows?: Record<string, ValueRow>;
  talentLevel?: number;
}
export interface ChangeDictionary {
  heroes: Record<string, ChangeIdentity>;
  heroIds: Record<string, string>;
  abilities: Record<string, ChangeIdentity>;
}
export interface ReadableChange {
  subject: ChangeIdentity;
  label: string;
  before: string;
  after: string;
  kind: string;
  category: string;
  evidence: EntityVersionChange[];
  talent?: boolean;
  sourceLocale?: "zh-CN" | "en";
}
const fields: Record<string, string> = {
  base_armor: "基础护甲",
  base_strength: "基础力量",
  base_agility: "基础敏捷",
  base_intelligence: "基础智力",
  strength_gain: "力量成长",
  agility_gain: "敏捷成长",
  intelligence_gain: "智力成长",
  base_health_regen: "基础生命恢复（每秒）",
  base_attack_speed: "基础攻击速度",
  base_attack_damage_min: "基础攻击力下限",
  base_attack_damage_max: "基础攻击力上限",
  movement_speed: "基础移动速度",
  cooldown: "冷却时间",
  mana_cost: "魔法消耗",
  cast_range: "施法距离",
  cast_point: "施法前摇",
  channel_time: "持续施法时间",
  damage: "伤害",
  has_scepter_upgrade: "阿哈利姆神杖升级",
  has_shard_upgrade: "阿哈利姆魔晶升级",
  description: "技能说明",
  display_name: "名称",
  scepter_description: "神杖说明",
  shard_description: "魔晶说明",
  AbilityCooldown: "冷却时间",
  AbilityManaCost: "魔法消耗",
  ItemCost: "价格",
  bonus_mana_regen: "魔法恢复加成",
  bonus_movement_speed: "移动速度加成",
  illusion_damage_outgoing_ranged: "远程幻象攻击力",
  lifesteal_creep: "对普通单位吸血",
  blast_damage: "极寒冲击伤害",
  duration: "持续时间",
  lifesteal_percent: "吸血比例",
  damage_reduction: "攻击力降低",
  mark_only_heroes: "迷烟标记的目标",
  parry_only_heroes: "招架目标",
  pierce_units: "穿透普通单位",
  secondary_targets: "次要目标数",
  images_do_damage_percent_ranged: "远程幻象攻击力",
  tooltip_damage_outgoing_ranged: "远程幻象攻击力",
  static_duration: "静电冲击持续时间",
  windwalk_movement_speed: "疾影步移速加成",
  cooldown_reduction: "冷却时间减少",
  heal_percentage: "每秒最大生命值治疗",
  illuminate_heal: "冲击波治疗比例",
  percent_damage_per_burn: "损毁魔法值伤害系数",
  presence_armor_reduction: "护甲降低",
  damage_per_second: "每秒伤害",
  damage_duration: "伤害持续时间",
  damage_str: "力量伤害系数",
  rock_damage: "残岩伤害",
  necromastery_damage_per_soul: "每个灵魂的攻击力",
  AbilityCharges: "能量点数",
  scepter_drag_speed: "牵引速度",
  infest_duration_enemy: "对敌方英雄持续时间",
};
const seconds = new Set([
  "cooldown",
  "cast_point",
  "channel_time",
  "AbilityCooldown",
  "AbilityChargeRestoreTime",
  "arrow_max_stun",
  "cooldown_reduction",
]);
export function changeValue(
  v: DiffValue,
  identity?: ChangeIdentity,
  key = "",
  locale: Locale = DEFAULT_LOCALE,
): string {
  const t = createTranslator(locale);
  if (v.status === "absent") return t("未设置");
  if (v.value === null) return t("空值");
  if (typeof v.value === "boolean") return v.value ? t("有") : t("无");
  if (["mark_only_heroes", "parry_only_heroes"].includes(key))
    return String(v.value) === "1" ? t("仅英雄") : t("英雄与普通单位");
  const numeric = numbers(v.value, locale);
  if (numeric !== t("未提供")) {
    const row = identity?.valueRows?.[key];
    const formatted = row
      ? tooltipValue(
          numeric,
          row,
          identity?.labels?.[key.toLowerCase()],
          locale,
        )
      : numeric;
    if (formatted !== numeric) return formatted;
    if (
      [
        "lifesteal_percent",
        "images_do_damage_percent_ranged",
        "tooltip_damage_outgoing_ranged",
        "windwalk_movement_speed",
        "heal_percentage",
        "percent_damage_per_burn",
        "illuminate_heal",
      ].includes(key)
    )
      return `${numeric}%`;
    return (
      numeric +
      (seconds.has(key) || /(?:duration|time)$/u.test(key) ? t(" 秒") : "")
    );
  }
  if (typeof v.value === "string")
    return gameText(v.value, identity?.values, locale);
  return t("含结构变化（展开查看）");
}
function valueKey(path: string) {
  return /^\/values\/\d+:([^/]+)/u.exec(path)?.[1];
}
/** Keep every raw record, but present duplicate level/scalar and modifier projections only once. */
export function readableChanges(
  changes: EntityVersionChange[],
  names: ChangeDictionary,
  oldNames: ChangeDictionary = names,
  locale: Locale = DEFAULT_LOCALE,
) {
  const t = createTranslator(locale);
  const rows: ReadableChange[] = [];
  const technical: EntityVersionChange[] = [];
  const push = (row: ReadableChange) => {
    const existing = rows.find(
      (r) =>
        r.subject.key === row.subject.key &&
        r.label === row.label &&
        r.before === row.before &&
        r.after === row.after,
    );
    if (existing) existing.evidence.push(...row.evidence);
    else rows.push(row);
  };
  for (const c of changes) {
    let subject: ChangeIdentity | undefined;
    let key = c.path.slice(1),
      label: string | null = fields[key] ? t(fields[key]) : null;
    if (c.entityKey.startsWith("item_")) {
      key = c.path.split("/").at(-1)!;
      label = valueLabel(key, undefined, locale) ?? fields[key] ?? null;
    }
    if (c.entityType === "hero") subject = names.heroes[c.entityKey];
    if (c.entityType === "ability") {
      subject = names.abilities[c.entityKey];
      label ??= valueLabel(key, subject?.labels?.[key.toLowerCase()], locale);
    }
    if (c.entityType === "localization") {
      const match = /^ability:(.+):(zh-CN|en)$/u.exec(c.entityKey);
      if (match) {
        subject = names.abilities[match[1]];
        label = label
          ? t("{label}（{language}）", {
              label,
              language: t(match[2] === "en" ? "英文" : "中文"),
            })
          : null;
      }
    }
    const modifier = /^ability-modifier:(.+):\d+:([^:]+)$/u.exec(c.entityKey);
    if (modifier) {
      subject = names.abilities[modifier[1]];
      key = modifier[2];
    }
    const vk = valueKey(c.path);
    if (vk) {
      key = vk;
      label =
        valueLabel(key, subject?.labels?.[key.toLowerCase()], locale) ??
        (fields[key] ? t(fields[key]) : undefined) ??
        null;
    }
    if (
      c.entityType === "source_structure" ||
      c.entityType === "asset_binding"
    ) {
      technical.push(c);
      continue;
    }
    if ((vk || modifier) && c.path.endsWith("/modifiers")) {
      const before =
        c.before.status === "value" && Array.isArray(c.before.value)
          ? (c.before.value as Array<{ key: string; value: unknown }>)
          : [];
      const after =
        c.after.status === "value" && Array.isArray(c.after.value)
          ? (c.after.value as Array<{ key: string; value: unknown }>)
          : [];
      let explained = false,
        unknown = false;
      const property =
        valueLabel(key, subject?.labels?.[key.toLowerCase()], locale) ??
        (fields[key] ? t(fields[key]) : undefined);
      const growth = (mods: typeof before) => {
        const gain = mods.find((m) => m.key === "hero_levelup")?.value;
        const interval =
          mods.find((m) => m.key === "levelup_interval")?.value ?? "1";
        return gain === undefined
          ? t("无等级成长")
          : t("每{interval}级 {gain}", {
              interval: String(interval),
              gain: String(gain),
            });
      };
      if (growth(before) !== growth(after) && subject && property) {
        push({
          subject,
          label: t("{property} · 等级成长", { property }),
          before: growth(before),
          after: growth(after),
          kind: c.entityType,
          category: c.category,
          evidence: [c],
        });
        explained = true;
      }
      for (const condition of new Set(
        [...before, ...after].map((m) => m.key),
      )) {
        if (
          ["hero_levelup", "levelup_interval"].includes(condition) &&
          subject &&
          property
        )
          continue;
        const old = before.find((m) => m.key === condition),
          next = after.find((m) => m.key === condition);
        if (JSON.stringify(old?.value) === JSON.stringify(next?.value))
          continue;
        const talent = names.abilities[condition];
        const conditionName =
          condition === "special_bonus_scepter"
            ? t("阿哈利姆神杖")
            : condition === "special_bonus_shard"
              ? t("阿哈利姆魔晶")
              : talent?.name;
        if (subject && conditionName && property) {
          push({
            subject,
            label: talent
              ? t("{condition} · {property}修正", {
                  condition: `${talent.talentLevel ? t("{level}级天赋", { level: talent.talentLevel }) : t("天赋")} · ${subject.name}`,
                  property,
                })
              : t("{condition} · {property}修正", {
                  condition: conditionName,
                  property,
                }),
            talent: Boolean(talent),
            before: old ? String(old.value) : t("无修正"),
            after: next ? String(next.value) : t("无修正"),
            kind: c.entityType,
            category: c.category,
            evidence: [c],
          });
          explained = true;
        } else unknown = true;
      }
      if (!explained || unknown) technical.push(c);
      continue;
    }
    if (
      c.entityType === "relation" &&
      c.entityKey.startsWith("hero-ability:")
    ) {
      const parts = c.entityKey.split(":");
      const hero = names.heroes[names.heroIds[parts[1]]];
      const ability = (c.operation === "removed" ? oldNames : names).abilities[
        parts[4]
      ];
      if (hero && ability) {
        const slot = /^Ability(\d+)$/u.exec(parts[3]);
        // Slot identity is retained. Talent levels are supplied by the actual endpoint binding order.
        const level = ability.talentLevel;
        push({
          subject: hero,
          talent: parts[2] === "talent",
          label:
            parts[2] === "talent"
              ? t("{subject}{operation}", {
                  subject: level ? t("{level}级天赋", { level }) : t("天赋"),
                  operation: t(c.operation === "added" ? "加入" : "移出"),
                })
              : t("{subject}{operation}", {
                  subject: t(slot ? "技能槽位" : "技能关联"),
                  operation: t(c.operation === "added" ? "加入" : "移出"),
                }),
          before: c.before.status === "absent" ? "—" : ability.name,
          after: c.after.status === "absent" ? "—" : ability.name,
          kind: c.entityType,
          category: c.category,
          evidence: [c],
        });
      } else technical.push(c);
      continue;
    }
    if (
      subject &&
      label &&
      (!vk ||
        c.path.endsWith("/level_values") ||
        c.path.endsWith("/scalar_value"))
    ) {
      push({
        subject,
        label,
        sourceLocale:
          c.entityType === "localization"
            ? (/:(zh-CN|en)$/u.exec(c.entityKey)?.[1] as
                "zh-CN" | "en" | undefined)
            : undefined,
        before: changeValue(
          c.before,
          oldNames.abilities[subject.key] ??
            oldNames.heroes[subject.key] ??
            subject,
          key,
          locale,
        ),
        after: changeValue(c.after, subject, key, locale),
        kind: c.entityType,
        category: c.category,
        evidence: [c],
      });
    } else technical.push(c);
  }
  return { rows, technical };
}
export interface PatchBoundary {
  fromPatch: string;
  toPatch: string;
  fromCommit: string;
  toCommit: string;
}
/** Official notes describe one forward update; do not attach them to reversed or aggregated endpoint diffs. */
export function matchesPatchBoundary(
  patch: PatchBoundary,
  from: { patch: string | null; sourceCommit: string | null },
  to: { patch: string | null; sourceCommit: string | null },
) {
  return (
    patch.fromPatch === from.patch &&
    patch.toPatch === to.patch &&
    patch.fromCommit === from.sourceCommit &&
    patch.toCommit === to.sourceCommit
  );
}
