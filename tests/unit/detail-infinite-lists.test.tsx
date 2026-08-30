// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AbilityBindingList,
  AbilityDefinitionList,
  AbilityMetaList,
  AbilityNumericIdList,
  AbilitySourceList,
  AbilityUnknownFieldList,
  AbilityValuesTable,
} from "@/components/ability-detail-lists";
import {
  HeroFacetList,
  HeroLocalizationList,
  HeroReferenceDiffList,
  HeroRoleList,
  HeroSourceFileList,
  HeroStatGroup,
  HeroTraceList,
} from "@/components/hero-detail-lists";
import type { AbilityDetail } from "@/server/repositories/abilities";
import type { HeroDetail } from "@/server/repositories/heroes";

const observers: MockIntersectionObserver[] = [];

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin: string;
  readonly scrollMargin = "0px";
  readonly thresholds = [0];
  private readonly callback: IntersectionObserverCallback;

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.rootMargin = options?.rootMargin ?? "0px";
    observers.push(this);
  }

  disconnect() {}
  observe() {}
  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  intersect(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this,
    );
  }
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    },
  );
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("detail InfiniteList adapters", () => {
  it("keeps Hero definition lists semantic and expands local chunks lazily", async () => {
    const rows = Array.from(
      { length: 25 },
      (_, index) => [`Stat ${index + 1}`, index + 1] as const,
    );
    const { container } = render(
      <HeroStatGroup
        title="属性"
        rows={rows.map((row) => [row[0], row[1]])}
        listIdentity="hero:stats"
      />,
    );

    const list = container.querySelector("[data-infinite-list]");
    expect(list).not.toBeNull();
    expect(list?.querySelector("dl")).not.toBeNull();
    expect(list?.querySelectorAll("[data-infinite-list-item]").length).toBe(24);
    for (const item of list?.querySelectorAll("dl > div") ?? []) {
      expect(Array.from(item.children).map((child) => child.tagName)).toEqual([
        "DT",
        "DD",
      ]);
    }

    const bottom = list?.querySelector('[data-infinite-list-sentinel="after"]');
    expect(bottom).not.toBeNull();
    act(() => observers.at(-1)?.intersect(bottom!));

    await waitFor(() =>
      expect(list?.querySelectorAll("[data-infinite-list-item]").length).toBe(
        25,
      ),
    );
  });

  it("routes every Hero audit collection through the local adapter", () => {
    const facet: HeroDetail["facets"][number] = {
      facet_key: "facet_one",
      icon: null,
      color: null,
      gradient_id: null,
      deprecated: false,
      source_path: "heroes.txt",
      source_line: 1,
    };
    const localization: HeroDetail["localizations"][number] = {
      locale: "en",
      display_name: "Hero",
      english_name_variant: null,
      hype: null,
      lore: null,
      name_source_path: "english.txt",
      name_token: "hero_name",
      english_name_variant_token: null,
      hype_source_path: null,
      hype_token: null,
      lore_source_path: null,
      lore_token: null,
    };
    const { container } = render(
      <>
        <HeroFacetList facets={[facet]} listIdentity="hero:facets" />
        <HeroRoleList
          roles={[{ role: "carry", role_level: 3 }]}
          labels={{ carry: "核心" }}
          listIdentity="hero:roles"
        />
        <HeroTraceList
          rows={[{ label: "Commit", value: "abc", mono: true }]}
          listIdentity="hero:trace"
        />
        <HeroSourceFileList
          files={[
            {
              source_path: "heroes.txt",
              raw_sha256: "abc",
              size_bytes: "42",
              encoding: "utf-8",
            },
          ]}
          listIdentity="hero:files"
        />
        <HeroLocalizationList
          localizations={[localization]}
          inheritedFields={["StatusHealth"]}
          listIdentity="hero:localizations"
        />
        <HeroReferenceDiffList
          diffs={[
            {
              field_name: "movement_speed",
              diff_type: "changed",
              canonical_value: 300,
              reference_value: 305,
            },
          ]}
          listIdentity="hero:diffs"
        />
      </>,
    );

    expect(container.querySelectorAll("[data-infinite-list]")).toHaveLength(7);
    expect(container.querySelectorAll("dl > div > dt").length).toBeGreaterThan(
      0,
    );
  });

  it("resets a Hero reference list when its hero-specific identity changes", () => {
    const first: NonNullable<HeroDetail["comparison"]>["diffs"] = [
      {
        field_name: "movement_speed",
        diff_type: "changed",
        canonical_value: 300,
        reference_value: 305,
      },
    ];
    const second = [
      {
        field_name: "base_armor",
        diff_type: "changed",
        canonical_value: 2,
        reference_value: 3,
      },
    ] satisfies NonNullable<HeroDetail["comparison"]>["diffs"];
    const view = render(
      <HeroReferenceDiffList
        diffs={first}
        listIdentity="dataset:hero-1:reference"
      />,
    );

    expect(view.container.textContent).toContain("movement_speed");
    view.rerender(
      <HeroReferenceDiffList
        diffs={second}
        listIdentity="dataset:hero-2:reference"
      />,
    );

    expect(view.container.textContent).toContain("base_armor");
    expect(view.container.textContent).not.toContain("movement_speed");
  });

  it("keeps AbilityValues as a native table while all detail collections use adapters", () => {
    const ability = {
      internal_name: "test_ability",
      texture_name: "test_ability",
      catalog_status: "current",
      definition_kind: "concrete",
      unknown_fields: ["MysteryField"],
      behavior: ["PASSIVE"],
      damage_type: "magical",
      unit_target_team: ["enemy"],
      cast_range: "600",
      cast_point: "0.3",
      channel_time: null,
      cooldown: "12",
      mana_cost: "100",
      base_class: "ability_lua",
    } as AbilityDetail["ability"];
    const value: AbilityDetail["values"][number] = {
      value_key: "damage",
      ordinal: 0,
      scalar_value: null,
      level_values: ["100", "200"],
      modifiers: [],
      raw_value: "100 200",
    };
    const binding: AbilityDetail["bindings"][number] = {
      hero_id: 1,
      hero_internal_name: "npc_dota_hero_test",
      slug: "test",
      hero_name: "Test Hero",
      relation_kind: "loadout",
      source_slot: "Ability1",
      ordinal: 0,
      is_current: true,
      source_path: "heroes.txt",
      source_line: 10,
    };
    const source: AbilityDetail["sources"][number] = {
      occurrence_ordinal: 0,
      source_path: "abilities.txt",
      source_line: 20,
      declaration_kind: "definition",
      raw_definition: { AbilityBehavior: "PASSIVE" },
      resolved_definition: { AbilityBehavior: "PASSIVE" },
      raw_sha256: "raw",
      resolved_sha256: "resolved",
      unknown_fields: [],
    };
    const mapping: AbilityDetail["idMappings"][number] = {
      ability_id: 123,
      source_path: "ids.txt",
      source_line: 1,
    };
    const { container } = render(
      <>
        <AbilityDefinitionList
          ability={ability}
          listIdentity="ability:definition"
        />
        <AbilityValuesTable values={[value]} listIdentity="ability:values" />
        <AbilityBindingList
          bindings={[binding]}
          listIdentity="ability:bindings"
        />
        <AbilitySourceList sources={[source]} listIdentity="ability:sources" />
        <AbilityMetaList
          rows={[{ label: "Commit", value: "abc" }]}
          listIdentity="ability:meta"
        />
        <AbilityNumericIdList mappings={[mapping]} listIdentity="ability:ids" />
        <AbilityUnknownFieldList
          fields={["MysteryField"]}
          listIdentity="ability:unknown"
        />
      </>,
    );

    // Seven top-level collections plus the two array-valued definition fields.
    expect(container.querySelectorAll("[data-infinite-list]")).toHaveLength(9);
    expect(container.querySelectorAll('[role="list"]')).toHaveLength(6);
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(6);
    const table = container.querySelector("table[data-infinite-list]");
    expect(table).not.toBeNull();
    expect(table?.querySelector(":scope > div")).toBeNull();
    for (const body of table?.querySelectorAll(":scope > tbody") ?? []) {
      expect(
        Array.from(body.children).every((child) => child.tagName === "TR"),
      ).toBe(true);
    }
    expect(
      table?.querySelector(
        "tbody[data-infinite-list-chunk] > tr[data-infinite-list-item]",
      ),
    ).not.toBeNull();
    expect(table?.querySelector('[role="list"]')).toBeNull();
    expect(container.querySelector("dl > div > dt")).not.toBeNull();
  });
});
