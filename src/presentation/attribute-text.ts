import type { AttributeDefinition } from "@/domain/attributes";

export type AttributeTextAttribute = Pick<
  AttributeDefinition,
  "id" | "zh" | "en" | "enumValues"
>;
export type AttributeTextPart = {
  text: string;
  attributeId?: string;
  enumValue?: string;
};
type LocalizedNames = { "zh-CN"?: string[]; en?: string[] };
// Explicit textual aliases preserve the existing identities and source wording.
const aliases: Record<string, LocalizedNames> = {
  health: {
    "zh-CN": ["生命", "生命上限", "生命值上限", "最大生命", "最大生命值"],
    en: ["max health", "maximum health"],
  },
  mana: {
    "zh-CN": ["魔法上限", "魔法值上限", "最大魔法值"],
    en: ["max mana", "maximum mana"],
  },
  "health-regen": { "zh-CN": ["生命值恢复"], en: ["health regen"] },
  "mana-regen": { "zh-CN": ["魔法值恢复"], en: ["mana regen"] },
  "magic-resistance": { "zh-CN": ["魔抗"] },
  "attack-damage": { en: ["attack damage"] },
  "attack-speed": { "zh-CN": ["攻速"] },
  "movement-speed": { "zh-CN": ["移速"], en: ["move speed"] },
  "turn-rate": { "zh-CN": ["转身速度"] },
  "day-vision": { "zh-CN": ["白昼视野"], en: ["daytime vision"] },
  "night-vision": { "zh-CN": ["夜晚视野"], en: ["nighttime vision"] },
  "spell-lifesteal": { "zh-CN": ["法术吸血"] },
  "spell-amplification": {
    "zh-CN": ["技能伤害增强", "技能伤害增幅", "技能增强"],
    en: ["spell damage amplification", "spell amplification"],
  },
  "cooldown-reduction": { "zh-CN": ["冷却时间降低", "冷却减少", "冷却降低"] },
  "mana-cost-reduction": {
    "zh-CN": ["魔法消耗减少"],
    en: ["mana cost reduction"],
  },
  "healing-amplification": {
    "zh-CN": ["治疗增幅"],
    en: ["healing amplification"],
  },
  "restoration-amplification": { "zh-CN": ["生命回复增强"] },
};
// Bare enum labels (e.g. 魔法, 物理) are too broad to infer a textual reference.
const enumAliases: Record<string, Record<string, LocalizedNames>> = {
  "damage-type": {
    DAMAGE_TYPE_MAGICAL: {
      "zh-CN": ["魔法伤害"],
      en: ["magical damage", "magic damage"],
    },
    DAMAGE_TYPE_PHYSICAL: { "zh-CN": ["物理伤害"], en: ["physical damage"] },
    DAMAGE_TYPE_PURE: { "zh-CN": ["纯粹伤害"], en: ["pure damage"] },
  },
  "dispel-type": {
    SPELL_DISPELLABLE_YES: {
      "zh-CN": ["弱驱散", "普通驱散"],
      en: ["basic dispel", "basic dispels"],
    },
    SPELL_DISPELLABLE_YES_STRONG: {
      "zh-CN": ["强驱散"],
      en: ["strong dispel", "strong dispels"],
    },
  },
};

/** Leftmost, longest complete term wins; ambiguity stays plain and consumes the term. */
export function attributeTextParts(
  text: string,
  locale: "zh-CN" | "en",
  attributes: AttributeTextAttribute[],
): AttributeTextPart[] {
  type Target = { attributeId: string; enumValue?: string };
  const names = new Map<string, Target | null>();
  const add = (name: string, target: Target) => {
    if (!name) return;
    const key = name.toLocaleLowerCase("en"),
      previous = names.get(key);
    if (
      names.has(key) &&
      (previous?.attributeId !== target.attributeId ||
        previous?.enumValue !== target.enumValue)
    )
      names.set(key, null);
    else names.set(key, target);
  };
  for (const attribute of attributes) {
    if (attribute.id.includes("~")) continue;
    for (const name of [
      locale === "en" ? attribute.en : attribute.zh,
      ...(aliases[attribute.id]?.[locale] ?? []),
    ])
      add(name, { attributeId: attribute.id });
    for (const value of attribute.enumValues ?? [])
      for (const name of enumAliases[attribute.id]?.[value.value]?.[locale] ??
        [])
        add(name, { attributeId: attribute.id, enumValue: value.value });
  }
  const terms = [...names.keys()].sort((a, b) => b.length - a.length);
  if (!terms.length) return [{ text }];
  // Apply Latin word boundaries before choosing an alternative so an invalid
  // longer match cannot hide a valid shorter one at the same position.
  const wordCharacter = "[\\p{L}\\p{N}_]";
  const pattern = new RegExp(
    terms
      .map((name) => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return /^[a-z0-9]/i.test(name)
          ? `(?<!${wordCharacter})${escaped}(?!${wordCharacter})`
          : escaped;
      })
      .join("|"),
    "giu",
  );
  const parts: AttributeTextPart[] = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index,
      word = match[0];
    const target = names.get(word.toLocaleLowerCase("en"));
    if (!target) continue;
    if (start > end) parts.push({ text: text.slice(end, start) });
    parts.push({ text: word, ...target });
    end = start + word.length;
  }
  if (end < text.length) parts.push({ text: text.slice(end) });
  return parts.length ? parts : [{ text }];
}
