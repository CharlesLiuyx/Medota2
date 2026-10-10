import { describe, expect, it } from "vitest";
import {
  catalogNumericValue,
  sortCatalogRows,
} from "@/presentation/catalog-table";
import { withCatalogPresentation } from "@/presentation/catalog-view";

describe("catalog table ordering", () => {
  it("orders actual numeric levels, preserves zero and keeps missing values last in both directions", () => {
    const entries = ["100", null, "9", "0", "-2", "9 / 12", "9 / 3"].map(
      (value) => ({ value, sort: catalogNumericValue(value) }),
    );
    expect(
      sortCatalogRows(entries, (row) => row.sort, "asc", "en").map(
        (row) => row.value,
      ),
    ).toEqual(["-2", "0", "9", "9 / 3", "9 / 12", "100", null]);
    expect(
      sortCatalogRows(entries, (row) => row.sort, "desc", "en").map(
        (row) => row.value,
      ),
    ).toEqual(["100", "9 / 12", "9 / 3", "9", "0", "-2", null]);
    expect(catalogNumericValue("10% / 20%")).toEqual([10, 20]);
    expect(catalogNumericValue("2 per stack")).toBe("2 per stack");
  });
  it("uses natural text order and stable ties", () => {
    const rows = [
      { name: "Item 10", id: 1 },
      { name: "Item 2", id: 2 },
      { name: "Item 2", id: 3 },
    ];
    expect(
      sortCatalogRows(rows, (row) => row.name, "asc", "en").map(
        (row) => row.id,
      ),
    ).toEqual([2, 3, 1]);
    expect(rows[0].id).toBe(1);
  });
  it("preserves presentation settings without changing language, filters or release", () => {
    expect(
      withCatalogPresentation("/heroes?lang=en&release=abc&q=axe", {
        view: "table",
        sort: "movement_speed",
        order: "desc",
      }),
    ).toBe(
      "/heroes?lang=en&release=abc&q=axe&view=table&sort=movement_speed&order=desc",
    );
  });
});

describe("catalog column configuration", () => {
  it("falls back on damaged or obsolete storage and preserves selections from another release", async () => {
    const { parseCatalogColumns } =
      await import("@/presentation/catalog-table-columns");
    for (const raw of [
      null,
      "broken",
      '{"version":2,"columns":[]}',
      '{"version":1,"columns":[42]}',
    ])
      expect(parseCatalogColumns(raw)).toBeNull();
    expect(
      parseCatalogColumns(
        '{"version":1,"columns":["category","historical-field","category"]}',
      ),
    ).toEqual(["entity", "category", "historical-field"]);
    expect(parseCatalogColumns('{"version":1,"columns":[]}')).toEqual([
      "entity",
    ]);
  });
  it("retains every owner value, raw field and owner-specific parameter without merging meanings", async () => {
    const { buildCatalogAttributeMatrix } =
      await import("@/presentation/catalog-table-columns");
    const { buildAttributeEntries } = await import("@/domain/attributes");
    const relation = {
      attributeId: "strength",
      kind: "hero" as const,
      owner: "axe",
      href: "/heroes/axe",
      zh: "斧王",
      en: "Axe",
      field: "base_strength",
      labelZh: "基础力量",
      labelEn: "Base strength",
      value: "25",
      descriptionZh: "",
      descriptionEn: "",
      sourcePath: "heroes.txt",
    };
    const matrix = buildCatalogAttributeMatrix(
      buildAttributeEntries([
        relation,
        { ...relation, owner: "sven", value: "24" },
        { ...relation, field: "strength_gain", value: "2.8" },
        {
          ...relation,
          attributeId: "hero~axe~special",
          field: "special",
          value: "1",
        },
        {
          ...relation,
          attributeId: "hero~axe~special",
          field: "special",
          value: "2",
        },
        {
          ...relation,
          attributeId: "hero~sven~special",
          owner: "sven",
          field: "special",
          value: "3",
        },
        { ...relation, kind: "item", owner: "item_boots" },
      ]),
      "hero",
    );
    expect(matrix.columns).toHaveLength(4);
    const base = matrix.columns.find(
      (column) => column.field === "base_strength",
    )!;
    expect(matrix.values.axe[base.key]).toEqual(["25"]);
    expect(matrix.values.sven[base.key]).toEqual(["24"]);
    expect(matrix.values.item_boots).toBeUndefined();
    const scoped = matrix.columns.find(
      (column) => column.attributeId === "hero~axe~special",
    )!;
    expect(matrix.values.axe[scoped.key]).toEqual(["1", "2"]);
    expect(matrix.values.sven[scoped.key]).toBeUndefined();
  });
});

describe("column precision and attribute contributions", () => {
  it("uses automatic significant precision and explicit rounding without altering prose", async () => {
    const { formatCatalogNumberText, catalogNumericValue } =
      await import("@/presentation/catalog-table");
    expect(formatCatalogNumberText("2.85 / 3 / +4.125% / -0.25", 1)).toBe(
      "2.9 / 3.0 / +4.1% / -0.3",
    );
    expect(formatCatalogNumberText("3.000000 / 315")).toBe("3 / 315");
    expect(
      formatCatalogNumberText("2.700000 / 2.0500 / +0.1000% / -0.0000"),
    ).toBe("2.7 / 2.05 / +0.1% / 0");
    expect(formatCatalogNumberText("2.55", 1)).toBe("2.6");
    expect(formatCatalogNumberText(".000 / +.000 / -.50")).toBe(
      "0 / +0 / -0.5",
    );
    expect(formatCatalogNumberText("3.000000", 3)).toBe("3.000");
    expect(formatCatalogNumberText("2.85 / 3", 3)).toBe("2.850 / 3.000");
    expect(formatCatalogNumberText("每秒 2.85 点")).toBe("每秒 2.85 点");
    expect(catalogNumericValue("2.85")).toEqual([2.85]);
  });
  it("preserves custom order and validates per-column precision", async () => {
    const { parseCatalogTablePreferences } =
      await import("@/presentation/catalog-table-columns");
    expect(
      parseCatalogTablePreferences(
        JSON.stringify({
          version: 1,
          columns: ["category", "entity"],
          decimals: { a: 3, b: -1, c: 11, d: 1.5, e: "2" },
          frozenThrough: "category",
        }),
      ),
    ).toEqual({
      columns: ["category", "entity"],
      decimals: { a: 3 },
      frozenThrough: "category",
    });
  });
  it("calculates reviewed primary-attribute contributions and rejects unsupported inputs", async () => {
    const { attributeValueEffects } =
      await import("@/presentation/attribute-value-effects");
    expect(
      attributeValueEffects("strength", "24", true).map(
        (value) => value.expression,
      ),
    ).toEqual(["24 × 22 = 528", "24 × 0.1 = 2.4"]);
    expect(
      attributeValueEffects("intelligence", "25", true).map(
        (value) => value.expression,
      ),
    ).toEqual(["25 × 12 = 300", "25 × 0.05 = 1.25", "25 × 0.1 = 2.5"]);
    expect(
      attributeValueEffects("agility", "10", true).map(
        (value) => value.expression,
      ),
    ).toEqual(["10 × 0.16 = 1.6", "10 × 1 = 10"]);
    expect(attributeValueEffects("strength", "24", false)).toEqual([]);
    expect(attributeValueEffects("strength", "2 / 3", true)).toEqual([]);
    expect(attributeValueEffects("armor", "7", true)).toEqual([]);
  });
});
