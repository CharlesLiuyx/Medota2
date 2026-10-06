import {
  parseKeyValues,
  type KeyValuesObject,
} from "@/importers/keyvalues/parser";
import { unitTokens } from "@/importers/dota-vpk/unit-adapter";
import {
  economySchema,
  type CreepGroup,
  type MapEconomy,
} from "@/domain/map/economy-schema";
import type { MapPackage } from "@/domain/map/schema";
import { readEntityRecords } from "./adapter";
import { vector } from "./native";

function object(value: string | KeyValuesObject | undefined): KeyValuesObject {
  if (!value || typeof value === "string") throw new Error("Missing KV object");
  return value;
}
function entries(obj: KeyValuesObject) {
  const map = new Map<string, string | KeyValuesObject>();
  for (const e of obj.entries) {
    if (map.has(e.key)) throw new Error(`Duplicate economy key: ${e.key}`);
    map.set(e.key, e.value);
  }
  return map;
}
const child = (text: string, key: string) =>
  object(
    parseKeyValues(text.replace(/^\uFEFF/, "")).entries.find(
      (e) => e.key === key,
    )?.value,
  );
const numeric = (v: unknown) => {
  if (typeof v !== "string" || !v.trim() || !Number.isFinite(Number(v)))
    throw new Error(`Invalid economy number: ${String(v)}`);
  return Number(v);
};
// Composition identifiers follow the installed FGD's SpawnType enum. Counts are reviewed
// standard-mode rosters, not inferred from arbitrary npc_units entries (which include retired units).
const ROSTERS: [number, number, string, [string, number][]][] = [
  [
    0,
    1,
    "狗头人",
    [
      ["kobold", 3],
      ["kobold_tunneler", 1],
      ["kobold_taskmaster", 1],
    ],
  ],
  [0, 2, "豺狼人", [["gnoll_assassin", 3]]],
  [
    0,
    3,
    "巨魔牧师",
    [
      ["forest_troll_berserker", 2],
      ["forest_troll_high_priest", 1],
    ],
  ],
  [
    0,
    4,
    "巨魔与狗头人",
    [
      ["forest_troll_berserker", 2],
      ["kobold_taskmaster", 1],
    ],
  ],
  [
    0,
    5,
    "幽魂",
    [
      ["fel_beast", 2],
      ["ghost", 1],
    ],
  ],
  [
    0,
    6,
    "鹰身女妖",
    [
      ["harpy_scout", 2],
      ["harpy_storm", 1],
    ],
  ],
  [
    1,
    1,
    "食人魔",
    [
      ["ogre_mauler", 2],
      ["ogre_magi", 1],
    ],
  ],
  [
    1,
    2,
    "狼群",
    [
      ["giant_wolf", 2],
      ["alpha_wolf", 1],
    ],
  ],
  [1, 3, "泥土傀儡", [["mud_golem", 2]]],
  [
    1,
    4,
    "萨特",
    [
      ["satyr_trickster", 2],
      ["satyr_soulstealer", 2],
    ],
  ],
  [
    1,
    5,
    "半人马",
    [
      ["centaur_outrunner", 1],
      ["centaur_khan", 1],
    ],
  ],
  [
    2,
    1,
    "半人马",
    [
      ["centaur_outrunner", 2],
      ["centaur_khan", 1],
    ],
  ],
  [
    2,
    2,
    "黑暗巨魔",
    [
      ["dark_troll", 2],
      ["dark_troll_warlord", 1],
    ],
  ],
  [
    2,
    3,
    "地狱熊",
    [
      ["polar_furbolg_champion", 1],
      ["polar_furbolg_ursa_warrior", 1],
    ],
  ],
  [
    2,
    4,
    "萨特家族",
    [
      ["satyr_trickster", 1],
      ["satyr_soulstealer", 1],
      ["satyr_hellcaller", 1],
    ],
  ],
  [
    2,
    5,
    "枭兽",
    [
      ["wildkin", 2],
      ["enraged_wildkin", 1],
    ],
  ],
  [2, 6, "松林掠夺者", [["warpine_raider", 2]]],
  [
    3,
    1,
    "远古黑龙",
    [
      ["black_drake", 2],
      ["black_dragon", 1],
    ],
  ],
  [
    3,
    2,
    "远古花岗岩傀儡",
    [
      ["rock_golem", 2],
      ["granite_golem", 1],
    ],
  ],
  [
    3,
    3,
    "远古雷蜥",
    [
      ["small_thunder_lizard", 2],
      ["big_thunder_lizard", 1],
    ],
  ],
  [
    3,
    4,
    "远古寒冰傀儡",
    [
      ["frostbitten_golem", 2],
      ["ice_shaman", 1],
    ],
  ],
  [
    3,
    5,
    "远古潜行者",
    [
      ["prowler_acolyte", 2],
      ["prowler_shaman", 1],
    ],
  ],
  [0, 7, "蝌蚪", [["tadpole", 3]]],
  [
    1,
    7,
    "幼蛙",
    [
      ["froglet", 2],
      ["froglet_mage", 1],
    ],
  ],
  [
    2,
    7,
    "成年蛙",
    [
      ["grown_frog", 2],
      ["grown_frog_mage", 1],
    ],
  ],
  [
    3,
    7,
    "远古蛙",
    [
      ["ancient_frog", 2],
      ["ancient_frog_mage", 1],
    ],
  ],
];
export function adaptEconomy(
  map: MapPackage,
  unitText: string,
  abilitiesText: string,
  pullText: string,
  localization: string,
): MapEconomy {
  if (
    map.provenance.client_version !== "6944" ||
    map.provenance.public_source?.patch !== "7.41f" ||
    map.provenance.native_source?.map_sha1 !==
      "412137a154d86cd4ba61da98692a5fb15e1cb79a"
  )
    throw new Error(
      "Economy rules have only been reviewed for 7.41f / client 6944",
    );
  const definitions = entries(child(unitText, "DOTAUnits")),
    tokens = unitTokens(localization);
  const groups: CreepGroup[] = ROSTERS.map(
    ([tier, spawnType, label, members]) => ({
      id: `${tier}-${spawnType}`,
      tier,
      spawnType,
      label,
      members: members.map(([id, count]) => ({
        unit: `npc_dota_neutral_${id}`,
        count,
      })),
      children:
        tier === 1 && spawnType === 3
          ? [{ unit: "npc_dota_neutral_mud_golem_split", count: 4 }]
          : [],
    }),
  );
  const required = new Set(
    groups.flatMap((g) => [...g.members, ...g.children].map((m) => m.unit)),
  );
  for (const faction of ["goodguys", "badguys"])
    for (const suffix of ["", "_upgraded", "_upgraded_mega"]) {
      for (const kind of ["melee", "flagbearer", "ranged"])
        required.add(`npc_dota_creep_${faction}_${kind}${suffix}`);
      required.add(`npc_dota_${faction}_siege${suffix}`);
    }
  const units: MapEconomy["units"] = {};
  for (const id of required) {
    const fields = entries(object(definitions.get(id)));
    if (!tokens[id.toLowerCase()])
      throw new Error(`Missing localized economy unit: ${id}`);
    units[id] = {
      name: tokens[id.toLowerCase()],
      min: numeric(fields.get("BountyGoldMin")),
      max: numeric(fields.get("BountyGoldMax")),
      xp: numeric(fields.get("BountyXP")),
      neutralUpgrade: [...fields].some(
        ([key, value]) =>
          /^Ability\d+$/.test(key) && value === "neutral_upgrade",
      ),
    };
  }
  const abilities = entries(child(abilitiesText, "DOTAAbilities"));
  const upgrade = entries(
    object(
      entries(object(abilities.get("neutral_upgrade"))).get("AbilityValues"),
    ),
  );
  const pulls = entries(child(pullText, "CREEP_PULL_TIMINGS"));
  const camps = map.points
    .filter((p) => p.kind === "camp")
    .map((p) => {
      const props = p.properties,
        name = props.volumename?.replace(/^\[PR#\]/, "");
      if (!name) throw new Error("Camp has no spawn volume");
      const raw = pulls.get(name),
        fields = raw ? entries(object(raw)) : null;
      const interval = (
        f: Map<string, unknown>,
        start: string,
        end: string,
      ): [number, number] => {
        const a = numeric(f.get(start)),
          b = numeric(f.get(end));
        if (a < 0 || b > 59 || a > b) throw new Error("Invalid pull timing");
        return [a, b];
      };
      return {
        pointId: p.id,
        name,
        tier: numeric(props.neutraltype),
        minType: numeric(props.minspawntype),
        maxType: numeric(props.maxspawntype),
        forced: numeric(props.forcedsubtype),
        maxUpgrade: numeric(props.maxupgradecount),
        stack: fields ? interval(fields, "stack_start", "stack_end") : null,
        stackDirection: fields
          ? numeric(fields.get("stack_arrow_direction"))
          : null,
        pulls: (["radiant", "dire"] as const).flatMap((team) => {
          const value = fields?.get(`${team}_pull`);
          if (!value) return [];
          const f = entries(object(value));
          return [
            {
              team,
              windows: [
                interval(f, "pull_1_start", "pull_1_end"),
                interval(f, "pull_2_start", "pull_2_end"),
              ],
              direction: numeric(f.get("pull_arrow_direction")),
            },
          ];
        }),
      };
    });
  return economySchema.parse({
    schemaVersion: 1,
    clientVersion: "6944",
    patch: "7.41f",
    rulesVersion: "creep-economy-7.41-v2",
    units,
    groups,
    camps,
    neutralUpgrade: {
      interval: numeric(upgrade.get("increase_time")),
      gold: numeric(upgrade.get("increase_gold")),
      xp: numeric(upgrade.get("increase_xp")),
      max: numeric(upgrade.get("max_level")),
    },
    laneUpgrade: { interval: 450, rangedXp: 8 },
    sources: [
      {
        label: "Valve 7.22：远程兵经验每7分30秒增加8",
        url: "https://www.dota2.com/patches/7.22",
      },
      {
        label: "Valve 7.41：攻城车与洪流营地",
        url: "https://www.dota2.com/patches/7.41",
      },
      {
        label: "Valve 7.40：近战兵与旗手收益",
        url: "https://www.dota2.com/patches/7.40",
      },
      {
        label: "Valve 7.38：洪流营地逐单位进化",
        url: "https://www.dota2.com/patches/7.38",
      },
      {
        label: "Valve 7.33：兵线金币升级",
        url: "https://www.dota2.com/patches/7.33",
      },
      {
        label: "Valve 7.32：旗手额外金币",
        url: "https://www.dota2.com/patches/7.32",
      },
    ],
  });
}
export function lanePaths(text: string): MapPackage["lanePaths"] {
  const records = readEntityRecords(text, "map"),
    byName = new Map(
      records
        .filter((r) => r.properties.classname === "path_corner")
        .map((r) => [r.properties.targetname, r]),
    );
  return records
    .filter((r) =>
      /^npc_dota_spawner_(good|bad)_(top|mid|bot)$/.test(
        r.properties.classname,
      ),
    )
    .map((r) => {
      const parts = /^npc_dota_spawner_(good|bad)_(top|mid|bot)$/.exec(
        r.properties.classname,
      )!;
      const xyz = (origin: string) => {
        const [x, y, z] = vector(origin);
        return { x, y, z };
      };
      const vertices = [xyz(r.properties.origin)],
        visited = new Set<string>();
      let target = r.properties.npcfirstwaypoint;
      while (target && !visited.has(target)) {
        visited.add(target);
        const next = byName.get(target);
        if (!next) throw new Error(`Missing lane path corner: ${target}`);
        vertices.push(xyz(next.properties.origin));
        target = next.properties.target;
      }
      return {
        id: r.properties.classname,
        team: parts[1] === "good" ? ("radiant" as const) : ("dire" as const),
        lane: parts[2] as "top" | "mid" | "bot",
        vertices,
      };
    });
}
