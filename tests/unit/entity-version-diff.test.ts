import { describe, expect, it } from "vitest";
import {
  compareEntityVersions,
  ENTITY_KINDS,
  type EntityVersionSnapshot,
  type EntityVersionState,
} from "@/domain/entity-version-diff";
import { readReleaseParameter, withRelease } from "@/domain/releases";
const evidence = [
  {
    repository: "synthetic-fixture",
    commit: null,
    path: "fixture.json",
    line: null,
    sha256: "a".repeat(64),
    clientVersion: "fixture-1",
  },
];
const entity = (
  key: string,
  fields: Record<string, unknown>,
): EntityVersionState => ({ key, fields, sources: evidence });
function snapshot(version: string): EntityVersionSnapshot {
  return {
    version,
    implementation: { parser: "fixture-v1" },
    groups: Object.fromEntries(
      ENTITY_KINDS.map((k) => [
        k,
        {
          status: "complete",
          reason: null,
          identityScheme: `${k}-fixture`,
          entities: [],
        },
      ]),
    ),
  };
}
describe("version state and endpoint semantics", () => {
  it("compares three complete fixtures including a reverted property and withdrawn entity", () => {
    const a = snapshot("fixture:A"),
      b = snapshot("fixture:B"),
      c = snapshot("fixture:C");
    a.groups.hero!.entities = [entity("hero", { damage: 100, nullable: null })];
    b.groups.hero!.entities = [
      entity("hero", { damage: 120, nullable: null, added: null }),
    ];
    c.groups.hero!.entities = [entity("hero", { damage: 100, nullable: null })];
    b.groups.ability!.entities = [entity("temporary", { cooldown: 5 })];
    b.groups.relation!.entities = [
      entity("hero-slot", { target: "temporary", ordinal: 1 }),
    ];
    c.groups.relation!.entities = [
      entity("hero-slot", { target: "existing", ordinal: 2 }),
    ];
    b.groups.mechanism!.entities = [
      entity("new-rule", {
        condition: { talent: true },
        effect: { bonus: 10 },
      }),
    ];
    c.groups.mechanism!.entities = b.groups.mechanism!.entities;
    const ab = compareEntityVersions(a, b),
      bc = compareEntityVersions(b, c),
      ac = compareEntityVersions(a, c);
    expect(ab.status).toBe("changed");
    expect(ab.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "hero",
          path: "/damage",
          before: { status: "value", value: 100 },
          after: { status: "value", value: 120 },
        }),
        expect.objectContaining({
          entityType: "hero",
          path: "/added",
          before: { status: "absent" },
          after: { status: "value", value: null },
        }),
        expect.objectContaining({ category: "mechanism", operation: "added" }),
      ]),
    );
    expect(bc.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "ability",
          operation: "removed",
        }),
        expect.objectContaining({
          category: "relation",
          operation: "modified",
          path: "/target",
        }),
      ]),
    );
    expect(
      ac.changes.some(
        (x) => x.entityType === "hero" || x.entityType === "ability",
      ),
    ).toBe(false);
    expect(
      ac.changes.every((x) => x.beforeSources.length || x.afterSources.length),
    ).toBe(true);
    expect(compareEntityVersions(a, a)).toMatchObject({
      status: "unchanged",
      changes: [],
    });
    expect(compareEntityVersions(a, b)).toEqual(ab);
  });
  it("keeps missing coverage, identity ambiguity and parser upgrades distinct from no change", () => {
    const a = snapshot("A"),
      b = snapshot("B");
    a.groups.unit!.entities = [entity("u", { health: 10 })];
    b.groups.unit = {
      status: "unavailable",
      identityScheme: "unit-fixture",
      entities: [],
      reason: "Pinned source missing",
    };
    expect(compareEntityVersions(a, b)).toMatchObject({
      status: "partial",
      changes: [],
      coverage: expect.arrayContaining([
        expect.objectContaining({
          entityType: "unit",
          status: "incomparable",
          reason: "Pinned source missing",
        }),
      ]),
    });
    b.groups.hero!.identityScheme = "different-source";
    b.implementation.parser = "fixture-v2";
    const diff = compareEntityVersions(a, b);
    expect(diff.implementationChanges).toBeTruthy();
    expect(diff.coverage.find((x) => x.entityType === "hero")?.status).toBe(
      "incomparable",
    );
    expect(
      compareEntityVersions(
        { version: "A", implementation: {}, groups: {} },
        { version: "B", implementation: {}, groups: {} },
      ).status,
    ).toBe("incomparable");
  });
  it("rejects duplicate stable identities and retains unknown fields as review evidence", () => {
    const a = snapshot("A"),
      b = snapshot("B");
    b.groups.source_structure!.entities = [
      {
        ...entity("unknown", { newField: { condition: "opaque" } }),
        review: "Unparsed source",
      },
    ];
    expect(compareEntityVersions(a, b)).toMatchObject({
      status: "partial",
      unresolved: [
        expect.objectContaining({ entityKey: "unknown", sources: evidence }),
      ],
    });
    b.groups.hero!.entities = [entity("same", {}), entity("same", {})];
    expect(() => compareEntityVersions(a, b)).toThrow(
      "Duplicate entity identity",
    );
  });
  it("does not infer additions/deletions from partial map coverage", () => {
    const a = snapshot("A"),
      b = snapshot("B");
    a.groups.map_object!.status = b.groups.map_object!.status = "partial";
    a.groups.map_object!.entities = [
      entity("gone", {}),
      entity("stable", { x: 1 }),
    ];
    b.groups.map_object!.entities = [
      entity("new", {}),
      entity("stable", { x: 2 }),
    ];
    const diff = compareEntityVersions(a, b);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toMatchObject({
      operation: "modified",
      path: "/x",
    });
    expect(diff.unresolved).toHaveLength(2);
  });
});
describe("release URL context", () => {
  it("preserves language, hash, explicit contexts and external links", () => {
    expect(
      withRelease(
        "/heroes/axe?lang=en#stats",
        "c:00000000-0000-0000-0000-000000000001",
      ),
    ).toBe(
      "/heroes/axe?lang=en&release=c%3A00000000-0000-0000-0000-000000000001#stats",
    );
    expect(withRelease("/map?release=m%3AA", "m:B")).toBe("/map?release=m%3AA");
    expect(withRelease("https://example.com", "m:A")).toBe(
      "https://example.com",
    );
    expect(withRelease("#stats", "m:A")).toBe("#stats");
    expect(() => readReleaseParameter(["m:A", "m:B"])).toThrow();
    expect(() => readReleaseParameter("")).toThrow();
    expect(readReleaseParameter("m:7.41f-6944")).toBe("m:7.41f-6944");
  });
});
