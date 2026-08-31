import { afterEach, describe, expect, it } from "vitest";
import {
  assertOutboundNetworkAllowed,
  isLoopbackHostname,
} from "@/config/network-policy";

const originalPolicy = process.env.MEDOTA2_NETWORK_POLICY;

afterEach(() => {
  if (originalPolicy === undefined) delete process.env.MEDOTA2_NETWORK_POLICY;
  else process.env.MEDOTA2_NETWORK_POLICY = originalPolicy;
});

describe("network policy", () => {
  it.each(["localhost", "127.0.0.1", "127.20.30.40", "::1"])(
    "recognizes loopback hostname %s",
    (hostname) => expect(isLoopbackHostname(hostname)).toBe(true),
  );

  it("blocks external adapters during a Test Run", () => {
    process.env.MEDOTA2_NETWORK_POLICY = "loopback-only";
    expect(() =>
      assertOutboundNetworkAllowed(
        "https://cdn.steamstatic.com/example.png",
        "Steam adapter",
      ),
    ).toThrow(/loopback-only/u);
  });

  it("allows loopback and normal-policy traffic", () => {
    process.env.MEDOTA2_NETWORK_POLICY = "loopback-only";
    expect(() =>
      assertOutboundNetworkAllowed("http://127.0.0.1:3100", "Web adapter"),
    ).not.toThrow();
    process.env.MEDOTA2_NETWORK_POLICY = "normal";
    expect(() =>
      assertOutboundNetworkAllowed("https://example.com", "Example adapter"),
    ).not.toThrow();
  });
});
