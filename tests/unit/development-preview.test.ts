import { describe, expect, it } from "vitest";
import { choosePreviewDataSource } from "@/development/preview";

describe("shared preview data", () => {
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
