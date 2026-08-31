export type NetworkPolicy = "normal" | "loopback-only";

export function getNetworkPolicy(): NetworkPolicy {
  const value = process.env.MEDOTA2_NETWORK_POLICY?.trim() || "normal";
  if (value !== "normal" && value !== "loopback-only") {
    throw new Error("MEDOTA2_NETWORK_POLICY must be normal or loopback-only.");
  }
  return value;
}

export function assertOutboundNetworkAllowed(
  target: string | URL,
  adapter: string,
): void {
  if (getNetworkPolicy() !== "loopback-only") return;
  let parsed: URL;
  try {
    parsed = target instanceof URL ? target : new URL(target);
  } catch (error) {
    throw new Error(
      `${adapter} is disabled by the loopback-only test network policy.`,
      { cause: error },
    );
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error(
      `${adapter} is disabled by the loopback-only test network policy.`,
    );
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(normalized)
  );
}
