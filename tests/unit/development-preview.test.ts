import { afterEach, describe, expect, it, vi } from "vitest";
import {
  choosePreviewDataSource,
  previewEnvironment,
} from "@/development/preview";

const state = vi.hoisted(() => ({ active: null as unknown }));
vi.mock("@/config/data-sync-state", async (original) => ({
  ...(await original<typeof import("@/config/data-sync-state")>()),
  readActiveSnapshot: () => state.active,
}));
afterEach(() => {
  state.active = null;
  vi.unstubAllEnvs();
});

describe("shared preview data", () => {
  it("restored workspaces receive their map collection while explicit local inputs remain visible to export and status", () => {
    state.active = {
      lease: { environment: "local-review", stateDirectory: "candidate" },
      sourceRoot: "sources",
      mapRoot: null,
      mapCollectionPath: "restored/versions.json",
    };
    vi.stubEnv("DOTA_MAP_COLLECTION_PATH", undefined);
    vi.stubEnv("DOTA_MAP_DATA_PATH", undefined);
    expect(previewEnvironment("local-review").DOTA_MAP_COLLECTION_PATH).toBe(
      "restored/versions.json",
    );
    vi.stubEnv("DOTA_MAP_COLLECTION_PATH", "local/versions.json");
    expect(previewEnvironment("local-review").DOTA_MAP_COLLECTION_PATH).toBe(
      "local/versions.json",
    );
    state.active = {
      ...(state.active as object),
      mapInputsAtApply: { collectionPath: "local/versions.json", dataPath: "" },
    };
    expect(previewEnvironment("local-review").DOTA_MAP_COLLECTION_PATH).toBe(
      "restored/versions.json",
    );
    vi.stubEnv("DOTA_MAP_COLLECTION_PATH", "local/new-versions.json");
    expect(previewEnvironment("local-review").DOTA_MAP_COLLECTION_PATH).toBe(
      "local/new-versions.json",
    );
    vi.stubEnv("DOTA_MAP_COLLECTION_PATH", undefined);
    vi.stubEnv("DOTA_MAP_DATA_PATH", "legacy-local");
    expect(previewEnvironment("local-review")).toMatchObject({
      DOTA_MAP_COLLECTION_PATH: "",
      DOTA_MAP_DATA_PATH: "legacy-local",
    });
  });
  it("reuses an existing real snapshot instead of replacing the page with fixtures", () => {
    expect(choosePreviewDataSource(undefined, true)).toBe("local-review");
    expect(choosePreviewDataSource("auto", true)).toBe("local-review");
    expect(choosePreviewDataSource(undefined, false)).toBe("development");
  });
  it("respects an explicit data source and rejects misspelled configuration", () => {
    expect(choosePreviewDataSource("development", true)).toBe("development");
    expect(choosePreviewDataSource("local-review", false)).toBe("local-review");
    expect(() => choosePreviewDataSource("local-reveiw", true)).toThrow(
      "MEDOTA2_WORKBENCH_DATA",
    );
  });
});
