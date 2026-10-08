import { describe, expect, it } from "vitest";
import { assessChange } from "@/presentation/change-impact";
import {
  changeTableGroups,
  orderChangeRows,
} from "@/presentation/changes-table";
import { noteCovered, noteEndpoints } from "@/presentation/change-notes";
import type { ReadableChange } from "@/presentation/entity-changes";
const row = (
  field: string,
  before: string,
  after: string,
  key = "sample",
): ReadableChange => ({
  field,
  before,
  after,
  subject: { key, name: key },
  label: field,
  kind: "ability",
  category: "property",
  evidence: [],
});
describe("contextual change ranking", () => {
  it("separates numeric polarity from benefit and handles negative and zero baselines", () => {
    expect(assessChange(row("cooldown", "10", "8"))).toMatchObject({
      direction: "buff",
      percent: -20,
    });
    expect(assessChange(row("mana_cost", "0", "35"))).toMatchObject({
      direction: "nerf",
      percent: null,
    });
    expect(assessChange(row("base_armor", "-1", "0"))).toMatchObject({
      direction: "buff",
      percent: 100,
    });
    expect(
      assessChange(row("base_health_regen", "-0.25", "-0.5")),
    ).toMatchObject({ direction: "nerf", percent: -100 });
    expect(
      assessChange(row("presence_armor_reduction", "-2", "-1.5")),
    ).toMatchObject({ direction: "nerf", percent: 25 });
  });
  it("ranks a stun change above a tiny regeneration adjustment, even with a smaller raw percentage", () => {
    const stun = assessChange(row("arrow_max_stun", "2", "1.5"));
    const regen = assessChange(row("base_health_regen", "0.5", "0.25"));
    expect(stun.score).toBeGreaterThan(regen.score);
    expect(Math.abs(stun.percent!)).toBeLessThan(Math.abs(regen.percent!));
  });
  it("uses actual upgraded values and recognizes offsetting shard changes as neutral", () => {
    expect(
      assessChange({
        ...row("AbilityCooldown", "-10", "-20"),
        impactBasis: { before: "100 / 95 / 90", after: "90 / 85 / 80" },
      }),
    ).toMatchObject({ direction: "buff" });
    expect(
      assessChange({
        ...row("illuminate_heal", "+30", "+40"),
        impactBasis: { before: "100", after: "100" },
      }),
    ).toMatchObject({ direction: "neutral", percent: 0, score: 0 });
  });
  it("keeps mixed levels and unknown semantics honest and reverses known direction", () => {
    expect(
      assessChange(row("ally_movespeed_pct", "15 / 20 / 25 / 30", "25")),
    ).toMatchObject({ direction: "neutral", mixed: true });
    expect(assessChange(row("unreviewed_parameter", "1", "2"))).toMatchObject({
      direction: "neutral",
      pending: true,
    });
    expect(assessChange(row("damage", "+25%", "+35"))).toMatchObject({
      pending: true,
      percent: null,
    });
    expect(assessChange(row("ItemCost", "800", "700"))).toMatchObject({
      direction: "buff",
      percent: -12.5,
    });
  });
  it("removes matching notes from the main rows without dropping notes or field evidence", () => {
    const change = {
      ...row("static_duration", "15 秒", "12 秒", "item_mjollnir"),
      label: "静电冲击持续时间",
    };
    const note = { text: "静电冲击的持续时间：15秒 → 12秒" };
    expect(noteEndpoints(note)).toEqual({
      label: "静电冲击的持续时间",
      before: "15",
      after: "12",
    });
    expect(noteCovered(note, [change])).toBe(true);
    expect(
      noteEndpoints({
        text: "Base Charge Restore Time increased from 6s to 7s",
      }),
    ).toEqual({ label: "Base Charge Restore Time", before: "6", after: "7" });
    const groups = changeTableGroups(
      [
        {
          key: "item_mjollnir",
          name: "雷神之锤",
          kind: "item",
          sections: [
            {
              key: "item_mjollnir",
              name: "雷神之锤",
              rows: [change],
              notes: [note],
            },
          ],
        },
      ],
      "zh-CN",
    );
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0].notes).toEqual([note]);
    expect(groups[0].start).toBe(1);
  });
});

it("keeps each object's nerfs, buffs and neutral changes contiguous with impact ranking inside each segment", () => {
  const groups = changeTableGroups(
    [
      {
        key: "sample",
        name: "Sample",
        kind: "hero",
        sections: [
          {
            key: "sample",
            name: "Sample",
            notes: [],
            rows: [
              row("unknown", "1", "2"),
              row("cooldown", "10", "8"),
              row("damage", "100", "90"),
              row("damage", "100", "50"),
            ],
          },
        ],
      },
    ],
    "zh-CN",
  );
  expect(groups[0].rows.map((r) => r.impact.direction)).toEqual([
    "nerf",
    "nerf",
    "buff",
    "neutral",
  ]);
  expect(groups[0].rows.slice(0, 2).map((r) => r.after)).toEqual(["50", "90"]);
  expect(groups[0].start).toBe(1);
});

it("calculates signed endpoint differences independently of relative percentage and benefit", () => {
  expect(assessChange(row("cooldown", "10 秒", "8 秒")).delta).toEqual({
    values: [-2],
    unit: "seconds",
  });
  expect(assessChange(row("mana_cost", "0", "35"))).toMatchObject({
    percent: null,
    delta: { values: [35], unit: "number" },
  });
  expect(
    assessChange(row("unknown", "15 / 20 / 25 / 30%", "25%")),
  ).toMatchObject({
    pending: true,
    delta: { values: [10, 5, 0, -5], unit: "percentagePoints" },
  });
  expect(
    assessChange(row("unknown", "25%", "15 / 20 / 25 / 30%")).delta?.values,
  ).toEqual([-10, -5, 0, 5]);
  expect(assessChange(row("base_armor", "-1.2", "-1.1")).delta?.values).toEqual(
    [0.1],
  );
  expect(
    assessChange({
      ...row("illuminate_heal", "+30", "+40"),
      impactBasis: { before: "100", after: "100" },
    }).delta?.values,
  ).toEqual([0]);
  expect(
    assessChange(row("damage", "1 / 2", "2 / 3 / 4")).delta,
  ).toBeUndefined();
  expect(assessChange(row("damage", "25%", "35")).delta).toBeUndefined();
  expect(assessChange(row("damage", "旧说明", "新说明")).delta).toBeUndefined();
});

it("keeps the same subject together across directions and reranks subjects after filtering without conflating names", () => {
  const groups = changeTableGroups(
    [
      {
        key: "owner",
        name: "Owner",
        kind: "hero",
        sections: [
          {
            key: "a",
            name: "Same display name",
            notes: [],
            rows: [
              row("damage", "100", "50", "a"),
              row("unknown", "1", "2", "a"),
              row("cooldown", "10", "8", "a"),
            ],
          },
          {
            key: "b",
            name: "Same display name",
            notes: [],
            rows: [
              row("unknown", "1", "2", "b"),
              row("damage", "100", "40", "b"),
            ],
          },
        ],
      },
    ],
    "zh-CN",
  );
  const rows = groups[0].rows;
  expect(rows.map((r) => [r.entity.key, r.impact.direction])).toEqual([
    ["b", "nerf"],
    ["b", "neutral"],
    ["a", "nerf"],
    ["a", "buff"],
    ["a", "neutral"],
  ]);
  const filtered = orderChangeRows(rows.filter((r) => r.after !== "40"));
  expect(filtered.map((r) => r.entity.key)).toEqual(["a", "a", "a", "b"]);
  expect(rows.map((r) => r.entity.key)).toEqual(["b", "b", "a", "a", "a"]);
  const versioned = rows
    .map((r, index) => ({
      ...r,
      entity: {
        ...r.entity,
        href: `/abilities/${r.entity.key}?release=${index}`,
      },
    }))
    .reverse();
  expect(orderChangeRows(versioned).map((r) => r.entity.key)).toEqual([
    "b",
    "b",
    "a",
    "a",
    "a",
  ]);
});
