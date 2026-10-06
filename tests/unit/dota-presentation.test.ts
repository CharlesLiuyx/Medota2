import { describe, expect, it } from "vitest";
import {
  behaviorLabels,
  displayName,
  effectiveAbility,
  enumText,
  gameText,
  numbers,
  talentValues,
  textValues,
  tooltipValue,
  upgradedValues,
  type ValueRow,
} from "@/presentation/dota";

const values: ValueRow[] = [
  {
    value_key: "AbilityCooldown",
    level_values: ["10.5", "9", "7.5", "6"],
    modifiers: [{ key: "special_bonus_unique_antimage", value: "-1" }],
  },
  {
    value_key: "empowered_mana_break_duration",
    level_values: ["0"],
    modifiers: [{ key: "special_bonus_scepter", value: "+5.0" }],
  },
  {
    value_key: "empowered_max_burn_pct_tooltip",
    level_values: ["0"],
    modifiers: [{ key: "special_bonus_scepter", value: "+20.0" }],
  },
];
describe("player-facing game data", () => {
  it("uses per-level definitions instead of inherited zero cooldowns", () => {
    const ability = effectiveAbility({ values, cooldown: "0" });
    expect(numbers(ability.cooldown)).toBe("10.5 / 9 / 7.5 / 6");
    expect(
      gameText("%AbilityCooldown%", textValues(values, { cooldown: "0" })),
    ).toBe("10.5 / 9 / 7.5 / 6");
    const mana: ValueRow = {
      value_key: "mana_per_hit_pct",
      level_values: ["1.8", "2.7", "3.6", "4.5"],
      modifiers: [
        { key: "display_type", value: "kManaPercentage" },
        { key: "special_bonus_scepter", value: "+1.5" },
      ],
    };
    expect(tooltipValue(numbers(mana.level_values), mana)).toBe(
      "1.8 / 2.7 / 3.6 / 4.5%",
    );
    expect(
      tooltipValue(upgradedValues([mana], "scepter").mana_per_hit_pct, mana),
    ).toBe("3.3 / 4.2 / 5.1 / 6%");
    expect(
      tooltipValue("60", {
        ...mana,
        modifiers: [{ key: "display_type", value: "kDebuffPercentage" }],
      }),
    ).toBe("60%");
    expect(
      tooltipValue("1.3", {
        ...mana,
        modifiers: [{ key: "display_type", value: "kDuration" }],
      }),
    ).toBe("1.3 秒");
  });
  it("resolves upgrades and talent bonuses from the same values without mutating base data", () => {
    expect(
      gameText(
        "%empowered_mana_break_duration%秒，%empowered_max_burn_pct_tooltip%%%",
        upgradedValues(values, "scepter"),
      ),
    ).toBe("5秒，20%");
    const talent = talentValues("special_bonus_unique_antimage", values);
    expect(
      gameText("-{s:bonus_AbilityCooldown}秒 闪烁冷却", textValues(talent)),
    ).toBe("-1秒 闪烁冷却");
    expect(values[1].level_values).toEqual(["0"]);
  });
  it("reads stored duration and percentage, replacement and multiplier talent syntax", () => {
    const rows: ValueRow[] = [
      {
        value_key: "damage",
        level_values: ["100"],
        modifiers: [
          { key: "talent_pct", value: "+40%" },
          { key: "special_bonus_shard", value: "+40%" },
        ],
      },
      {
        value_key: "charges",
        level_values: ["0"],
        modifiers: [{ key: "talent_set", value: "=2" }],
      },
      {
        value_key: "health",
        level_values: ["100"],
        modifiers: [{ key: "talent_mult", value: "x2.5" }],
      },
      {
        value_key: "interval",
        level_values: ["0.7"],
        modifiers: [{ key: "talent_minus", value: "+-0.1" }],
      },
    ];
    expect(textValues(talentValues("talent_pct", rows)).bonus_damage).toBe(
      "40",
    );
    expect(textValues(talentValues("talent_set", rows)).bonus_charges).toBe(
      "2",
    );
    expect(textValues(talentValues("talent_mult", rows)).bonus_health).toBe(
      "2.5",
    );
    expect(textValues(talentValues("talent_minus", rows)).bonus_interval).toBe(
      "0.1",
    );
    expect(upgradedValues(rows, "shard").damage).toBe("140");
    const ability = effectiveAbility({
      values: [],
      source_definition: { entries: [{ key: "AbilityDuration", value: "6" }] },
    });
    expect(gameText("%abilityduration%秒", textValues([], ability))).toBe(
      "6秒",
    );
  });
  it("does not expose engine enums, raw names, markup or unresolved tokens", () => {
    expect(
      behaviorLabels([
        "DOTA_ABILITY_BEHAVIOR_POINT",
        "DOTA_ABILITY_BEHAVIOR_IMMEDIATE",
      ]),
    ).toEqual(["点目标"]);
    expect(enumText("DAMAGE_TYPE_MAGICAL")).toBe("魔法");
    expect(enumText("FUTURE_ENGINE_ENUM")).toBe("未提供");
    expect(displayName("generic_hidden")).toBe("名称待补充");
    expect(gameText("<b>伤害</b><br>%missing% {s:bonus_unknown}")).toBe(
      "伤害\n（数值待补充） （数值待补充）",
    );
    expect(numbers("some_engine_formula")).toBe("未提供");
  });
  it("does not invent a value for an unsupported conditional upgrade", () => {
    const conditional: ValueRow[] = [
      {
        value_key: "damage",
        level_values: ["100"],
        modifiers: [{ key: "special_bonus_shard", value: { entries: [] } }],
      },
    ];
    expect(upgradedValues(conditional, "shard").damage).toBe("（数值待补充）");
  });
});
