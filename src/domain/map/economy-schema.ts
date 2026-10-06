import { z } from "zod";
const number = z.number().finite();
export const xyzSchema = z.object({ x: number, y: number, z: number });
const member = z.object({
  unit: z.string(),
  count: z.number().int().positive(),
});
export const economySchema = z
  .object({
    schemaVersion: z.literal(1),
    clientVersion: z.string(),
    patch: z.string(),
    rulesVersion: z.enum(["creep-economy-7.41-v1", "creep-economy-7.41-v2"]),
    units: z.record(
      z.string(),
      z
        .object({
          name: z.string(),
          min: number.nonnegative(),
          max: number.nonnegative(),
          xp: number.nonnegative().optional(),
          neutralUpgrade: z.boolean(),
        })
        .refine((v) => v.min <= v.max, "Invalid bounty range"),
    ),
    groups: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        tier: z.number().int().min(0).max(3),
        spawnType: z.number().int().min(1).max(7),
        members: z.array(member).min(1),
        children: z.array(member).default([]),
      }),
    ),
    camps: z.array(
      z.object({
        pointId: z.string(),
        name: z.string(),
        tier: z.number().int().min(0).max(3),
        minType: z.number().int(),
        maxType: z.number().int(),
        forced: z.number().int(),
        maxUpgrade: z.number().int().nonnegative(),
        stack: z.tuple([number, number]).nullable(),
        stackDirection: number.nullable(),
        pulls: z.array(
          z.object({
            team: z.enum(["radiant", "dire"]),
            windows: z.array(z.tuple([number, number])),
            direction: number,
          }),
        ),
      }),
    ),
    neutralUpgrade: z.object({
      interval: number.positive(),
      gold: number.nonnegative(),
      xp: number.nonnegative().optional(),
      max: z.number().int().nonnegative(),
    }),
    laneUpgrade: z
      .object({ interval: number.positive(), rangedXp: number.nonnegative() })
      .optional(),
    sources: z.array(z.object({ label: z.string(), url: z.string().url() })),
  })
  .superRefine((value, ctx) => {
    if (
      value.rulesVersion === "creep-economy-7.41-v2" &&
      (!value.laneUpgrade ||
        value.neutralUpgrade.xp === undefined ||
        Object.values(value.units).some((u) => u.xp === undefined))
    )
      ctx.addIssue({
        code: "custom",
        message: "Missing experience data for economy v2",
      });
    for (const key of ["groups", "camps"] as const) {
      const ids =
        key === "groups"
          ? value.groups.map((g) => g.id)
          : value.camps.map((c) => c.pointId);
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: "custom", message: `Duplicate economy ${key}` });
    }
    for (const group of value.groups)
      for (const m of [...group.members, ...group.children]) {
        if (!value.units[m.unit])
          ctx.addIssue({
            code: "custom",
            message: `Unknown economy unit: ${m.unit}`,
          });
      }
    for (const camp of value.camps) {
      if (
        camp.minType > camp.maxType ||
        camp.minType < 1 ||
        camp.maxType > 7 ||
        camp.forced > 7
      )
        ctx.addIssue({
          code: "custom",
          message: `Invalid camp spawn types: ${camp.name}`,
        });
    }
  });
export type MapEconomy = z.infer<typeof economySchema>;
export type CampEconomy = MapEconomy["camps"][number];
export type CreepGroup = MapEconomy["groups"][number];

export const lanePathSchema = z.object({
  id: z.string(),
  team: z.enum(["radiant", "dire"]),
  lane: z.enum(["top", "mid", "bot"]),
  vertices: z.array(xyzSchema).min(2),
});
