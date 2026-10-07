import type { AttributeDefinition } from "@/domain/attributes";

export type AttributeTextPart = { text: string; attributeId?: string };
// These are explicit textual aliases, not extra attribute identities.
const aliases: Record<string, { "zh-CN"?: string[]; en?: string[] }> = {
  health: { "zh-CN": ["生命", "生命上限", "最大生命值"] },
  "health-regen": { "zh-CN": ["生命值恢复"], en: ["health regen"] },
  "mana-regen": { "zh-CN": ["魔法值恢复"], en: ["mana regen"] },
  "magic-resistance": { "zh-CN": ["魔抗"] },
  "attack-speed": { "zh-CN": ["攻速"] },
};

/** Preserve source wording; longest known name wins and ambiguous names stay plain. */
export function attributeTextParts(
  text: string,
  locale: "zh-CN" | "en",
  attributes: Pick<AttributeDefinition, "id" | "zh" | "en">[],
): AttributeTextPart[] {
  const names = new Map<string, string | null>();
  for (const attribute of attributes) {
    if (attribute.id.includes("~")) continue;
    for (const name of [
      locale === "en" ? attribute.en : attribute.zh,
      ...(aliases[attribute.id]?.[locale] ?? []),
    ]) {
      if (!name) continue;
      const key = name.toLocaleLowerCase("en");
      if (names.has(key) && names.get(key) !== attribute.id)
        names.set(key, null);
      else names.set(key, attribute.id);
    }
  }
  const terms = [...names.keys()].sort((a, b) => b.length - a.length);
  if (!terms.length) return [{ text }];
  const pattern = new RegExp(
    terms.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "giu",
  );
  const parts: AttributeTextPart[] = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const word = match[0];
    const attributeId = names.get(word.toLocaleLowerCase("en"));
    // English names must not match inside e.g. "unhealthy" or source_token_health.
    if (
      !attributeId ||
      (locale === "en" &&
        (/[\p{L}\p{N}_]/u.test(text[start - 1] ?? "") ||
          /[\p{L}\p{N}_]/u.test(text[start + word.length] ?? "")))
    )
      continue;
    if (start > end) parts.push({ text: text.slice(end, start) });
    parts.push({ text: word, attributeId });
    end = start + word.length;
  }
  if (end < text.length) parts.push({ text: text.slice(end) });
  return parts.length ? parts : [{ text }];
}
