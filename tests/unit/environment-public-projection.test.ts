import { describe, expect, it } from "vitest";
import type { PublicEnvironmentIdentity } from "@/domain/environment";
import { createEnvironmentResponseHeaders } from "@/server/environment/public-projection";

describe("environment HTTP projection", () => {
  it("projects a verified identity without private connection facts", () => {
    const headers = createEnvironmentResponseHeaders({
      environment: "test",
      dataClass: "synthetic-fixture",
      databaseName: "medota2_test",
      runId: "e2e-42",
      safeFingerprint: "12345678-abcdef12",
      verified: true,
    });

    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(headers.get("X-Medota2-Environment")).toBe("test");
    expect(headers.get("X-Medota2-Data-Class")).toBe("synthetic-fixture");
    expect(headers.get("X-Medota2-Environment-Verification")).toBe("verified");
    expect(headers.get("X-Medota2-Database-Name")).toBe("medota2_test");
    expect(headers.get("X-Medota2-Database-Fingerprint")).toBe(
      "12345678-abcdef12",
    );
    expect(headers.get("X-Medota2-Run-Id")).toBe("e2e-42");
    expect([...headers.values()].join(" ")).not.toMatch(
      /postgresql:\/\/|secret|127\.0\.0\.1|[0-9a-f]{8}-[0-9a-f]{4}-/iu,
    );
  });

  it("projects only the declaration when attestation failed", () => {
    const identity: PublicEnvironmentIdentity = {
      environment: "local-review",
      dataClass: "production-snapshot",
      databaseName: null,
      runId: null,
      safeFingerprint: null,
      verified: false,
    };
    const headers = createEnvironmentResponseHeaders(identity);

    expect(headers.get("X-Medota2-Environment-Verification")).toBe(
      "unverified",
    );
    expect(headers.has("X-Medota2-Database-Name")).toBe(false);
    expect(headers.has("X-Medota2-Database-Fingerprint")).toBe(false);
    expect(headers.has("X-Medota2-Run-Id")).toBe(false);
  });
});
