import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ readJson: vi.fn(), writeJson: vi.fn() }));
vi.mock("@/development/runtime", () => ({
  developmentRoot: ".medota2/development",
  readJson: state.readJson,
  writeJson: state.writeJson,
}));
import { GET, POST } from "@/app/api/development/route";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("MEDOTA2_WORKBENCH", "1");
  vi.stubEnv("MEDOTA2_ENVIRONMENT", "development");
  state.readJson.mockResolvedValue({ phase: "ready", instance: "current" });
  state.writeJson.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
function request(origin = "http://127.0.0.1:3000", action = "cancel") {
  return new Request("http://localhost:3000/api/development", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action }),
  });
}

describe("development controls", () => {
  it("accepts the browser origin when Next normalizes the internal URL", async () => {
    expect((await POST(request())).status).toBe(202);
    expect(state.writeJson).toHaveBeenCalledWith(
      expect.stringContaining("command.json"),
      expect.objectContaining({ action: "cancel", instance: "current" }),
    );
  });
  it("rejects another origin and unsupported actions without writing", async () => {
    expect((await POST(request("https://example.com"))).status).toBe(403);
    expect(
      (await POST(request("http://127.0.0.1:3000", "delete"))).status,
    ).toBe(400);
    expect(state.writeJson).not.toHaveBeenCalled();
  });
  it("supports the real preview but keeps ordinary local-review and production private", async () => {
    vi.stubEnv("MEDOTA2_ENVIRONMENT", "local-review");
    expect((await GET()).status).toBe(200);
    vi.stubEnv("MEDOTA2_WORKBENCH", "0");
    expect((await GET()).status).toBe(404);
    vi.stubEnv("MEDOTA2_WORKBENCH", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect((await GET()).status).toBe(404);
    expect((await POST(request())).status).toBe(404);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MEDOTA2_ENVIRONMENT", "test");
    expect((await GET()).status).toBe(404);
    expect(state.writeJson).not.toHaveBeenCalled();
  });
});
