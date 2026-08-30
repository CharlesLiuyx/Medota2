import { describe, expect, it } from "vitest";
import {
  evaluateCatalogGate,
  type CatalogProjection,
} from "@/domain/catalog-diff";

const empty: CatalogProjection = {
  selectorManifestSha256: "a".repeat(64),
  heroes: [],
  abilities: [],
  bindings: [],
  idMappings: [],
  facets: [],
  localizationCoverage: { en: 2, "zh-CN": 2 },
};

describe("catalog release gate", () => {
  it("allows an initial catalog and additive semantic changes", () => {
    expect(evaluateCatalogGate(null, empty).gate).toBe("green");
    const next = {
      ...empty,
      abilities: [{ key: "new_ability", fingerprint: "1" }],
    };
    const result = evaluateCatalogGate(empty, next);
    expect(result.gate).toBe("green");
    expect(result.summary.reasons).toEqual({ ability_added: 1 });
  });

  it("routes removals, ID remaps, selector drift and coverage loss to Yellow", () => {
    const current: CatalogProjection = {
      ...empty,
      heroes: [{ key: "npc_dota_hero_fixture", fingerprint: "h" }],
      abilities: [{ key: "fixture_spell", fingerprint: "a" }],
      idMappings: [{ key: "fixture_spell\u001f100", fingerprint: "i" }],
    };
    const next: CatalogProjection = {
      ...empty,
      selectorManifestSha256: "b".repeat(64),
      idMappings: [{ key: "fixture_spell\u001f101", fingerprint: "i" }],
      localizationCoverage: { en: 1, "zh-CN": 1 },
    };
    const result = evaluateCatalogGate(current, next);
    expect(result.gate).toBe("yellow");
    expect(result.summary.reasons).toMatchObject({
      selector_manifest_changed: 1,
      hero_removed: 1,
      ability_removed: 1,
      ability_id_mapping_removed: 1,
      localization_coverage_decreased: 2,
    });
  });

  it("routes source shape drift to Yellow even when an ability remains", () => {
    const current = {
      ...empty,
      abilities: [
        {
          key: "fixture_spell",
          fingerprint: "same",
          unknownFields: [],
          occurrenceCount: 1,
        },
      ],
    };
    const next = {
      ...empty,
      abilities: [
        {
          key: "fixture_spell",
          fingerprint: "same",
          unknownFields: ["NewShape"],
          occurrenceCount: 2,
        },
      ],
    };
    expect(evaluateCatalogGate(current, next)).toMatchObject({
      gate: "yellow",
      summary: { reasons: { ability_source_shape_changed: 1 } },
    });
  });
});
