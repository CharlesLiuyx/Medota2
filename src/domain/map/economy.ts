import type { CampEconomy, CreepGroup, MapEconomy } from "./economy-schema";
export type GoldRange = { min: number; max: number };
export const goldText = (v: GoldRange) => `${v.min}–${v.max}`;
export const xpText = (v: GoldRange | null) =>
  v === null ? "未收录" : v.min === v.max ? String(v.min) : `${v.min}–${v.max}`;
export function unitExperience(
  data: MapEconomy,
  id: string,
  time: number,
): number | null {
  const unit = data.units[id];
  if (unit?.xp === undefined) return null;
  const upgrades = Math.min(
    data.neutralUpgrade.max,
    Math.floor(Math.max(0, time) / data.neutralUpgrade.interval),
  );
  if (unit.neutralUpgrade && upgrades && data.neutralUpgrade.xp === undefined)
    return null;
  return (
    unit.xp +
    (unit.neutralUpgrade ? upgrades * (data.neutralUpgrade.xp ?? 0) : 0)
  );
}
export function groupExperience(
  data: MapEconomy,
  group: CreepGroup,
  time: number,
  children = true,
): GoldRange | null {
  let total = 0;
  for (const m of [...group.members, ...(children ? group.children : [])]) {
    const xp = unitExperience(data, m.unit, time);
    if (xp === null) return null;
    total += xp * m.count;
  }
  return { min: total, max: total };
}
export function campExperience(
  data: MapEconomy,
  camp: CampEconomy,
  time: number,
  children = true,
): GoldRange | null {
  const groups = campGroups(data, camp, time),
    ranges = groups.map((g) => groupExperience(data, g, time, children));
  if (!ranges.length || ranges.some((r) => r === null)) return null;
  return {
    min: Math.min(...ranges.map((r) => r!.min)),
    max: Math.max(...ranges.map((r) => r!.max)),
  };
}
export const clockText = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
export function groupGold(
  data: MapEconomy,
  group: CreepGroup,
  time: number,
  children = true,
): GoldRange {
  const upgrades = Math.min(
    data.neutralUpgrade.max,
    Math.floor(Math.max(0, time) / data.neutralUpgrade.interval),
  );
  return [...group.members, ...(children ? group.children : [])].reduce(
    (sum, m) => {
      const unit = data.units[m.unit];
      if (!unit) throw new Error(`Missing unit: ${m.unit}`);
      const bonus = unit.neutralUpgrade
        ? upgrades * data.neutralUpgrade.gold
        : 0;
      return {
        min: sum.min + (unit.min + bonus) * m.count,
        max: sum.max + (unit.max + bonus) * m.count,
      };
    },
    { min: 0, max: 0 },
  );
}
/** Flooded camps upgrade one of three slots per five minutes, not the entire camp at once.
 * Enumerate eligible upgraded slots; blocked/uncleared camps may lag behind this ideal schedule. */
export function campGroups(
  data: MapEconomy,
  camp: CampEconomy,
  time: number,
): CreepGroup[] {
  if (camp.minType !== 7 || camp.maxType !== 7)
    return data.groups.filter(
      (g) =>
        g.tier === camp.tier &&
        g.spawnType >= camp.minType &&
        g.spawnType <= camp.maxType &&
        (camp.forced <= 0 || g.spawnType === camp.forced),
    );
  const steps = Math.min(
    camp.maxUpgrade * 3,
    Math.floor(Math.max(0, time) / 300),
  );
  const tier = Math.min(3, camp.tier + Math.floor(steps / 3));
  const base = data.groups.find((g) => g.tier === tier && g.spawnType === 7)!;
  const remainder = steps % 3;
  if (!remainder || tier === 3) return [base];
  const next = data.groups.find(
    (g) => g.tier === tier + 1 && g.spawnType === 7,
  )!;
  const expand = (g: CreepGroup) =>
    g.members.flatMap((m) => Array<string>(m.count).fill(m.unit));
  const low = expand(base),
    high = expand(next),
    seen = new Set<string>(),
    result: CreepGroup[] = [];
  for (let mask = 1; mask < 8; mask++) {
    if (mask.toString(2).split("1").length - 1 !== remainder) continue;
    const units = low.map((u, i) => (mask & (1 << i) ? high[i] : u)).sort();
    if (seen.has(units.join())) continue;
    seen.add(units.join());
    result.push({
      ...base,
      id: `${camp.name}-${steps}-${mask}`,
      label: `混合进化 · ${remainder}/3 已升级`,
      members: [...new Set(units)].map((unit) => ({
        unit,
        count: units.filter((u) => u === unit).length,
      })),
      children: [],
    });
  }
  return result;
}
export function campGold(
  data: MapEconomy,
  camp: CampEconomy,
  time: number,
  children = true,
) {
  const groups = campGroups(data, camp, time),
    ranges = groups.map((g) => groupGold(data, g, time, children));
  return ranges.length
    ? {
        min: Math.min(...ranges.map((g) => g.min)),
        max: Math.max(...ranges.map((g) => g.max)),
      }
    : null;
}
export type BarracksState = "normal" | "melee" | "ranged" | "both" | "mega";
export const BARRACKS_LABELS: Record<BarracksState, string> = {
  normal: "普通兵 · 兵营完整",
  melee: "近战兵营被毁",
  ranged: "远程兵营被毁",
  both: "本路两座兵营被毁",
  mega: "全部六座兵营被毁 · 超级兵",
};
export function laneWave(
  data: MapEconomy,
  seconds: number,
  state: BarracksState,
  team: "radiant" | "dire" = "radiant",
) {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error("Invalid wave time");
  const time = Math.floor(seconds / 30) * 30,
    upgrades = Math.floor(time / 450);
  const melee = 3 + Math.min(3, Math.floor(time / 900));
  const ranged = time >= 2400 ? 2 : 1;
  const flag = time >= 120 && time % 60 === 0 ? 1 : 0;
  const siege =
    time > 0 && time % 300 === 0
      ? 1 + Number(time >= 1800) + Number(time >= 3600)
      : 0;
  const faction = team === "radiant" ? "goodguys" : "badguys";
  const suffix = (kind: "melee" | "ranged") =>
    state === "mega"
      ? "_upgraded_mega"
      : state === "both" || state === kind
        ? "_upgraded"
        : "";
  const rows = [
    {
      id: `npc_dota_creep_${faction}_melee${suffix("melee")}`,
      count: melee - flag,
      label: "近战兵",
      bonus: suffix("melee") ? 0 : upgrades,
    },
    {
      id: `npc_dota_creep_${faction}_flagbearer${suffix("melee")}`,
      count: flag,
      label: "旗手（替换近战兵）",
      bonus: suffix("melee") ? 0 : upgrades,
    },
    {
      id: `npc_dota_creep_${faction}_ranged${suffix("ranged")}`,
      count: ranged,
      label: "远程兵",
      bonus: state === "mega" ? 0 : upgrades * 3,
    },
    {
      id: `npc_dota_${faction}_siege${suffix("ranged")}`,
      count: siege,
      label: "攻城车",
      bonus: 0,
    },
  ]
    .filter((r) => r.count)
    .map((r) => {
      const u = data.units[r.id];
      if (!u) throw new Error(`Missing lane unit: ${r.id}`);
      const direct = { min: u.min + r.bonus, max: u.max + r.bonus };
      const xp =
        u.xp === undefined || !data.laneUpgrade
          ? null
          : u.xp +
            (r.id.includes("_ranged")
              ? Math.floor(time / data.laneUpgrade.interval) *
                data.laneUpgrade.rangedXp
              : 0);
      return {
        ...r,
        direct,
        total: { min: direct.min * r.count, max: direct.max * r.count },
        xp,
        totalXp: xp === null ? null : xp * r.count,
      };
    });
  const direct = rows.reduce(
    (s, r) => ({ min: s.min + r.total.min, max: s.max + r.total.max }),
    { min: 0, max: 0 },
  );
  // Flagbearer bonus is a separate hero reward, never an extra spawned melee creep.
  const flagRow = rows.find((r) => r.id.includes("flagbearer"));
  const flagBonus = flagRow ? flagRow.direct : { min: 0, max: 0 };
  return {
    time,
    number: time / 30 + 1,
    melee,
    ranged,
    flag,
    siege,
    rows,
    direct,
    flagBonus,
    xp: rows.some((r) => r.totalXp === null)
      ? null
      : rows.reduce((sum, r) => sum + r.totalXp!, 0),
    total: { min: direct.min + flagBonus.min, max: direct.max + flagBonus.max },
  };
}
