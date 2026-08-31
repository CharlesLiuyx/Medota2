import { describe, expect, it } from "vitest";
import type { LocalDatabaseCredentials } from "@/config/database-credentials";
import {
  DATABASE_ROLE_NAMES_BY_ENVIRONMENT,
  DATABASE_ROLES,
} from "@/domain/environment";
import {
  assertLocalStackCredentialManifest,
  LocalStackIsolationError,
} from "@/server/environment/isolate-local-stack";
import { LOCAL_STACK_DATABASES } from "@/server/environment/adopt-local-stack";

const CONTROL_URL =
  "postgresql://medota2_owner:control-password-that-is-long-and-private@127.0.0.1:54321/medota2";
const LEGACY_CONTROL_URL =
  "postgresql://medota2_owner:medota2_owner@127.0.0.1:54321/medota2";

describe("local stack isolation credential preflight", () => {
  it("accepts one unique credential for every environment/role cell", () => {
    expect(() =>
      assertLocalStackCredentialManifest(
        credentials(),
        CONTROL_URL,
        LEGACY_CONTROL_URL,
      ),
    ).not.toThrow();
  });

  it.each([
    [
      "a cross-environment URL",
      (candidate: LocalDatabaseCredentials) => {
        candidate.databases.test.web = candidate.databases.development.web;
      },
    ],
    [
      "the control role as a runtime role",
      (candidate: LocalDatabaseCredentials) => {
        candidate.databases.test.web =
          "postgresql://medota2_owner:runtime-password-that-is-long-and-private@127.0.0.1:54321/medota2_test";
      },
    ],
    [
      "a URL query override",
      (candidate: LocalDatabaseCredentials) => {
        candidate.databases.test.web += "?sslmode=disable";
      },
    ],
    [
      "a reused password",
      (candidate: LocalDatabaseCredentials) => {
        const source = new URL(candidate.databases.development.web);
        const target = new URL(candidate.databases.test.web);
        target.password = source.password;
        candidate.databases.test.web = target.toString();
      },
    ],
  ])("rejects %s before provisioning roles", (_label, mutate) => {
    const candidate = credentials();
    mutate(candidate);
    expect(() =>
      assertLocalStackCredentialManifest(
        candidate,
        CONTROL_URL,
        LEGACY_CONTROL_URL,
      ),
    ).toThrow(LocalStackIsolationError);
  });
});

function credentials(): LocalDatabaseCredentials {
  return {
    contractVersion: 1,
    databases: Object.fromEntries(
      LOCAL_STACK_DATABASES.map((spec) => [
        spec.environment,
        Object.fromEntries(
          DATABASE_ROLES.map((role) => [
            role,
            roleUrl(
              spec.databaseName,
              DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment][role],
              spec.environment + "-" + role,
            ),
          ]),
        ),
      ]),
    ) as LocalDatabaseCredentials["databases"],
  };
}

function roleUrl(databaseName: string, role: string, seed: string): string {
  return (
    "postgresql://" +
    role +
    ":" +
    seed.padEnd(40, "x") +
    "@127.0.0.1:54321/" +
    databaseName
  );
}
