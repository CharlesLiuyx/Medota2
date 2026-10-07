import {
  parseKeyValues,
  type KeyValuesObject,
} from "@/importers/keyvalues/parser";
import {
  UNIT_STATS,
  type UnitCategory,
  type UnitDefinition,
} from "@/domain/units";

export const UNIT_ADAPTER_VERSION = "vpk-units-v2";
export function unitTokens(text: string): Record<string, string> {
  const lang = parseKeyValues(text.replace(/^\uFEFF/u, "")).entries.find(
    (e) => e.key.toLowerCase() === "lang",
  )?.value;
  const tokens =
    typeof lang === "object"
      ? lang.entries.find((e) => e.key.toLowerCase() === "tokens")?.value
      : undefined;
  if (!tokens || typeof tokens === "string")
    throw new Error("Missing localization tokens");
  const index: Record<string, string> = Object.fromEntries(
    tokens.entries
      .filter((e) => typeof e.value === "string")
      .map((e) => [e.key.toLowerCase(), e.value as string]),
  );
  // Valve keeps some item display names under a suffixed name token.
  // Preserve the raw key and prefer an explicit unsuffixed token on conflicts.
  for (const [key, value] of Object.entries(index))
    if (key.endsWith(":n")) index[key.slice(0, -2)] ??= value;
  return index;
}
function scalar(object: KeyValuesObject): Record<string, string> {
  return Object.fromEntries(
    object.entries
      .filter((e) => typeof e.value === "string")
      .map((e) => [e.key, e.value as string]),
  );
}
function category(id: string, fields: Record<string, string>): UnitCategory {
  if (
    /halloween|diretide|greevil|seasonal|frostivus|cny_|aghsfort|shmup|_event|dark_carnival|mutation/.test(
      id,
    )
  )
    return "event";
  if (
    /units_base|_generic|_default|thinker|loadout|target_dummy|looping_sound|invisible_vision|halloffame|ent_dota_promo/.test(
      id,
    )
  )
    return "helper";
  if (["npc_dota_roshan", "npc_dota_miniboss"].includes(id)) return "boss";
  if (/courier/.test(fields.BaseClass ?? "")) return "courier";
  if (["npc_dota_observer_wards", "npc_dota_sentry_wards"].includes(id))
    return "ward";
  if (/creep_lane|creep_siege/.test(fields.BaseClass ?? "")) return "lane";
  if (fields.IsSummoned === "1") return "summon";
  if (
    fields.BaseClass === "npc_dota_creep_neutral" &&
    id.startsWith("npc_dota_neutral_")
  )
    return fields.IsAncient === "1" ? "ancient" : "neutral";
  if (
    /tower|building|barracks|fort|filler|healer|fountain/.test(
      fields.BaseClass ?? "",
    ) ||
    /lotus_pool|teleporters|twin_gate|watch_tower|xp_fountain/.test(id)
  )
    return "building";
  return "summon";
}
export function adaptUnits(
  text: string,
  zh: Record<string, string>,
  en: Record<string, string>,
) {
  const root = parseKeyValues(text).entries.find(
    (e) => e.key === "DOTAUnits",
  )?.value;
  if (!root || typeof root === "string") throw new Error("Missing DOTAUnits");
  const objects = root.entries.filter((e) => typeof e.value === "object");
  const base = objects.find((e) => e.key === "npc_dota_units_base")?.value;
  if (!base || typeof base === "string")
    throw new Error("Missing units base definition");
  const defaults = scalar(base);
  const definitions = new Map<string, Record<string, string>>();
  for (const entry of objects) {
    if (definitions.has(entry.key))
      throw new Error(`Duplicate unit identity: ${entry.key}`);
    definitions.set(entry.key, scalar(entry.value as KeyValuesObject));
  }
  const resolved = new Map<string, Record<string, string>>();
  function inherit(id: string, chain: string[] = []): Record<string, string> {
    if (chain.includes(id)) throw new Error(`Cyclic unit inheritance: ${id}`);
    if (resolved.has(id)) return resolved.get(id)!;
    const own = definitions.get(id);
    if (!own) throw new Error(`Missing inherited unit: ${id}`);
    const parent = own.include_keys_from
      ? inherit(own.include_keys_from, [...chain, id])
      : defaults;
    const fields = { ...parent, ...own };
    resolved.set(id, fields);
    return fields;
  }
  const usableName = (value: string | undefined) =>
    value && !/%|\{.*\}/u.test(value) ? value : undefined;
  const localizedName = (
    id: string,
    tokens: Record<string, string>,
  ): string | undefined => {
    const direct = usableName(tokens[id.toLowerCase()]);
    const parent = definitions.get(id)?.include_keys_from;
    return direct || (parent ? localizedName(parent, tokens) : undefined);
  };
  const units: UnitDefinition[] = [];
  for (const entry of objects) {
    const id = entry.key;
    const fields = inherit(id);
    const kind = category(id, fields);
    const team = ["summon", "ward", "courier"].includes(kind)
      ? "随所属阵营"
      : fields.TeamName === "DOTA_TEAM_GOODGUYS"
        ? "天辉"
        : fields.TeamName === "DOTA_TEAM_BADGUYS"
          ? "夜魇"
          : fields.TeamName === "DOTA_TEAM_NEUTRALS"
            ? "中立"
            : "随所属阵营";
    const variant = /_mega$/.test(id)
      ? "超级强化"
      : /_upgraded$/.test(id)
        ? "强化"
        : /tower([1-4])/.test(id)
          ? `${/tower([1-4])/.exec(id)![1]} 级塔`
          : "";
    const position = /_(top|mid|bot)$/.exec(id)?.[1];
    units.push({
      internalName: id,
      model: fields.Model || null,
      summonAbility: fields.UnitToAbilityMap || null,
      zhName: localizedName(id, zh) || localizedName(id, en) || "名称待补充",
      enName:
        localizedName(id, en) || localizedName(id, zh) || "Name unavailable",
      nameLocales: {
        zh: localizedName(id, zh)
          ? "zh-CN"
          : localizedName(id, en)
            ? "en"
            : null,
        en: localizedName(id, en)
          ? "en"
          : localizedName(id, zh)
            ? "zh-CN"
            : null,
      },
      category: kind,
      team,
      variant: [
        variant,
        definitions.get(id)?.include_keys_from
          ? `等级 ${fields.Level || "待确认"}`
          : "",
        position ? { top: "上路", mid: "中路", bot: "下路" }[position] : "",
      ]
        .filter(Boolean)
        .join(" · "),
      attack:
        fields.AttackCapabilities === "DOTA_UNIT_CAP_MELEE_ATTACK"
          ? "近战"
          : fields.AttackCapabilities === "DOTA_UNIT_CAP_RANGED_ATTACK"
            ? "远程"
            : fields.AttackCapabilities === "DOTA_UNIT_CAP_NO_ATTACK"
              ? "无法攻击"
              : "攻击方式待确认",
      stats: Object.fromEntries(
        Object.keys(UNIT_STATS).map((key) => [
          key,
          /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(fields[key] ?? "") &&
          fields[key] !== ""
            ? fields[key]
            : null,
        ]),
      ),
      abilities: Object.entries(fields)
        .filter(
          ([key, value]) =>
            /^Ability\d+$/.test(key) && value && value !== "generic_hidden",
        )
        .sort(([a], [b]) => Number(a.slice(7)) - Number(b.slice(7)))
        .map(([, value]) => value),
    });
  }
  // Keep complete definitions available, but put readable gameplay entries first.
  units.sort((a, b) => {
    const rank = (u: UnitDefinition) =>
      u.category === "helper"
        ? 3
        : u.category === "event"
          ? 2
          : u.zhName === "名称待补充"
            ? 1
            : 0;
    return rank(a) - rank(b);
  });
  return { units, raw: root };
}
