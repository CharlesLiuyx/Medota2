import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveEntityIcon: vi.fn(),
}));

vi.mock("@/server/repositories/assets", () => ({
  getActiveEntityIcon: mocks.getActiveEntityIcon,
}));

import { GET } from "@/app/valve-assets/[entity]/[key]/route";

const asset = {
  content: Buffer.from([1, 2, 3]),
  contentSha256: "a".repeat(64),
  mimeType: "image/webp",
  width: 128,
  height: 128,
  byteSize: 3,
  lodKey: "w128",
  targetWidth: 128,
  sourceType: "exact",
  logicalPath: "panorama/images/spellicons/antimage_blink_png.vtex_c",
};

beforeEach(() => {
  mocks.getActiveEntityIcon.mockReset();
  mocks.getActiveEntityIcon.mockResolvedValue(asset);
});

describe("database asset route", () => {
  it("returns the persisted LoD selected for the requested width", async () => {
    const response = await GET(
      new Request(
        "http://localhost/valve-assets/ability/antimage_blink?width=96",
      ),
      routeParams("ability", "antimage_blink"),
    );

    expect(mocks.getActiveEntityIcon).toHaveBeenCalledWith(
      "ability",
      "antimage_blink",
      96,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("etag")).toBe(`"${asset.contentSha256}"`);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("x-medota2-asset-lod")).toBe("w128");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array(asset.content),
    );
  });

  it("honors strong and weak conditional ETags", async () => {
    for (const value of [
      `"${asset.contentSha256}"`,
      `W/"${asset.contentSha256}"`,
    ]) {
      const response = await GET(
        new Request(
          "http://localhost/valve-assets/hero/npc_dota_hero_antimage",
          {
            headers: { "If-None-Match": value },
          },
        ),
        routeParams("hero", "npc_dota_hero_antimage"),
      );
      expect(response.status).toBe(304);
      expect(response.headers.get("etag")).toBe(`"${asset.contentSha256}"`);
    }
  });

  it("rejects invalid widths before querying PostgreSQL", async () => {
    const response = await GET(
      new Request(
        "http://localhost/valve-assets/ability/antimage_blink?width=64.5",
      ),
      routeParams("ability", "antimage_blink"),
    );

    expect(response.status).toBe(400);
    expect(mocks.getActiveEntityIcon).not.toHaveBeenCalled();
  });
});

function routeParams(entity: string, key: string) {
  return { params: Promise.resolve({ entity, key }) };
}
