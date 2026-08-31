import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMedota2StateDirectory } from "@/config/medota2-state";

describe("Medota2 state directory", () => {
  it("defaults to the workspace .medota2 directory", () => {
    expect(resolveMedota2StateDirectory("/workspace/medota2", undefined)).toBe(
      "/workspace/medota2/.medota2",
    );
  });

  it("allows an environment or run-scoped directory below .medota2", () => {
    expect(
      resolveMedota2StateDirectory(
        "/workspace/medota2",
        ".medota2/test-runs/run-42/state",
      ),
    ).toBe("/workspace/medota2/.medota2/test-runs/run-42/state");
  });

  it.each(["..", "state", ".medota2/../outside", "/tmp/medota2-state"])(
    "rejects a state directory outside .medota2: %s",
    (configured) => {
      expect(() =>
        resolveMedota2StateDirectory("/workspace/medota2", configured),
      ).toThrow(/must resolve inside/u);
    },
  );

  it("rejects a nested symbolic-link escape from .medota2", () => {
    const workspace = mkdtempSync(resolve(tmpdir(), "medota2-state-test-"));
    const outside = mkdtempSync(resolve(tmpdir(), "medota2-state-outside-"));
    try {
      mkdirSync(resolve(workspace, ".medota2"));
      symlinkSync(outside, resolve(workspace, ".medota2", "escaped"));

      expect(() =>
        resolveMedota2StateDirectory(workspace, ".medota2/escaped/test-state"),
      ).toThrow(/symbolic-link/u);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
