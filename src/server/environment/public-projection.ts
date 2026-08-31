import type { PublicEnvironmentIdentity } from "@/domain/environment";

export function createEnvironmentResponseHeaders(
  identity: PublicEnvironmentIdentity,
  initial?: HeadersInit,
): Headers {
  const headers = new Headers(initial);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Medota2-Environment", identity.environment);
  headers.set("X-Medota2-Data-Class", identity.dataClass);
  headers.set(
    "X-Medota2-Environment-Verification",
    identity.verified ? "verified" : "unverified",
  );
  if (identity.runId) {
    headers.set("X-Medota2-Run-Id", identity.runId);
  }
  if (identity.verified) {
    headers.set("X-Medota2-Database-Name", identity.databaseName);
    headers.set("X-Medota2-Database-Fingerprint", identity.safeFingerprint);
  }
  return headers;
}
