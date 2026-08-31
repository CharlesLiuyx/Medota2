// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  EnvironmentStrip,
  getEnvironmentTitlePrefix,
} from "@/components/app-shell";
import type { PublicEnvironmentIdentity } from "@/domain/environment";

afterEach(cleanup);

describe("EnvironmentStrip", () => {
  it.each([
    [
      "test",
      "synthetic-fixture",
      "TEST ENVIRONMENT",
      "SYNTHETIC-FIXTURE CLASS — NOT LIVE-PRODUCTION CLASS",
    ],
    [
      "local-review",
      "production-snapshot",
      "LOCAL REVIEW ENVIRONMENT",
      "PRODUCTION-SNAPSHOT CLASS — NOT LIVE-PRODUCTION CLASS",
    ],
    [
      "production",
      "live-production",
      "PRODUCTION ENVIRONMENT",
      "LIVE PRODUCTION DATA",
    ],
  ] as const)(
    "names the %s environment and its data boundary in text",
    (environment, dataClass, heading, dataNotice) => {
      render(
        <EnvironmentStrip environment={identity({ environment, dataClass })} />,
      );

      const strip = screen.getByRole("status", {
        name: "Runtime environment",
      });
      expect(strip.getAttribute("data-environment")).toBe(environment);
      expect(strip.getAttribute("data-data-class")).toBe(dataClass);
      expect(screen.getByText(heading)).toBeTruthy();
      expect(screen.getByText(dataNotice)).toBeTruthy();
    },
  );

  it("shows the attested database, safe fingerprint, and run identity", () => {
    render(
      <EnvironmentStrip
        environment={identity({
          environment: "test",
          dataClass: "synthetic-fixture",
        })}
      />,
    );

    const strip = screen.getByRole("status", { name: "Runtime environment" });
    expect(strip.getAttribute("data-verification")).toBe("verified");
    expect(strip.getAttribute("data-run")).toBe("e2e-42");
    expect(screen.getByText(/DATABASE VERIFIED · medota2_test/u)).toBeTruthy();
    expect(screen.getByText("12345678-abcdef12")).toBeTruthy();
    expect(screen.getByText("RUN · e2e-42")).toBeTruthy();
  });

  it("makes failed attestation explicit without exposing a target", () => {
    render(
      <EnvironmentStrip
        environment={{
          environment: "development",
          dataClass: "sandbox",
          databaseName: null,
          runId: null,
          safeFingerprint: null,
          verified: false,
        }}
      />,
    );

    const strip = screen.getByRole("status", { name: "Runtime environment" });
    expect(strip.getAttribute("data-verification")).toBe("unverified");
    expect(strip.getAttribute("data-run")).toBe("none");
    expect(
      screen.getByText("DATABASE IDENTITY NOT VERIFIED — DATA ACCESS BLOCKED"),
    ).toBeTruthy();
    expect(
      screen.getByText("DECLARED DATA CLASS · SANDBOX · NOT VERIFIED"),
    ).toBeTruthy();
    expect(screen.queryByText("SANDBOX DATA")).toBeNull();
    expect(screen.queryByText(/medota2_/iu)).toBeNull();
  });
});

describe("getEnvironmentTitlePrefix", () => {
  it("keeps development quiet and prefixes every higher-risk environment", () => {
    expect(getEnvironmentTitlePrefix("development")).toBe("");
    expect(getEnvironmentTitlePrefix("test")).toBe("[TEST] ");
    expect(getEnvironmentTitlePrefix("local-review")).toBe("[LOCAL REVIEW] ");
    expect(getEnvironmentTitlePrefix("production")).toBe("[PRODUCTION] ");
  });
});

function identity(
  override: Pick<PublicEnvironmentIdentity, "environment" | "dataClass">,
): PublicEnvironmentIdentity {
  return {
    ...override,
    databaseName: "medota2_test",
    runId: "e2e-42",
    safeFingerprint: "12345678-abcdef12",
    verified: true,
  };
}
