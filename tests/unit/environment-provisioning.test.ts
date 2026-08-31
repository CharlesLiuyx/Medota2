import { describe, expect, it } from "vitest";
import {
  assertAdoptionConfirmation,
  LOCAL_STACK_ADOPTION_CONFIRMATION,
  LOCAL_STACK_DATABASES,
  LocalStackAdoptionError,
} from "@/server/environment/adopt-local-stack";

describe("local environment identity provisioning policy", () => {
  it("maps the three local databases to distinct environment contracts", () => {
    expect(LOCAL_STACK_DATABASES).toEqual([
      {
        databaseName: "medota2",
        environment: "development",
        dataClass: "sandbox",
        resetPolicy: "manual",
      },
      {
        databaseName: "medota2_local",
        environment: "local-review",
        dataClass: "production-snapshot",
        resetPolicy: "explicit-rebuild",
      },
      {
        databaseName: "medota2_test",
        environment: "test",
        dataClass: "synthetic-fixture",
        resetPolicy: "run-scoped",
      },
    ]);
  });

  it("requires the exact three-database cutover confirmation", () => {
    expect(() => assertAdoptionConfirmation("adopt:medota2")).toThrow(
      LocalStackAdoptionError,
    );
    expect(() =>
      assertAdoptionConfirmation(LOCAL_STACK_ADOPTION_CONFIRMATION),
    ).not.toThrow();
  });
});
