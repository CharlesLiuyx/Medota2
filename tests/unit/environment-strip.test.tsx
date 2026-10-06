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
    ["test", "synthetic-fixture", "测试预览", "测试样例数据"],
    ["local-review", "production-snapshot", "本地预览", "游戏版本资料"],
    ["production", "live-production", "正式环境", "在线数据"],
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

  it("keeps verified identity in machine attributes without exposing database identifiers", () => {
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
    expect(screen.getByText("测试样例数据")).toBeTruthy();
    expect(
      screen.queryByText(/medota2_test|12345678-abcdef12|e2e-42/u),
    ).toBeNull();
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
    expect(screen.getByText("数据连接未验证，暂不可用")).toBeTruthy();
    expect(screen.queryByText("演示数据")).toBeNull();
    expect(screen.queryByText(/medota2_/iu)).toBeNull();
  });
});

describe("getEnvironmentTitlePrefix", () => {
  it("keeps development quiet and prefixes every higher-risk environment", () => {
    expect(getEnvironmentTitlePrefix("development")).toBe("");
    expect(getEnvironmentTitlePrefix("test")).toBe("[测试预览] ");
    expect(getEnvironmentTitlePrefix("local-review")).toBe("[本地预览] ");
    expect(getEnvironmentTitlePrefix("production")).toBe("[正式环境] ");
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
