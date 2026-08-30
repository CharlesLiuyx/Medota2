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
const assetDatasetVersionId = "11111111-1111-4111-8111-111111111111";

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

  it("selects the immutable asset dataset requested by v", async () => {
    const response = await GET(
      new Request(
        `http://localhost/valve-assets/ability/antimage_blink?v=${assetDatasetVersionId}&width=96`,
      ),
      routeParams("ability", "antimage_blink"),
    );

    expect(mocks.getActiveEntityIcon).toHaveBeenCalledWith(
      "ability",
      "antimage_blink",
      96,
      assetDatasetVersionId,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
  });

  it("accepts the same UUIDv7 dataset identity as catalog cursors", async () => {
    const versionId = "01890f47-6e7a-7cc0-98f1-7c3a2bc91e13";
    const response = await GET(
      new Request(
        `http://localhost/valve-assets/ability/antimage_blink?v=${versionId}`,
      ),
      routeParams("ability", "antimage_blink"),
    );

    expect(response.status).toBe(200);
    expect(mocks.getActiveEntityIcon).toHaveBeenCalledWith(
      "ability",
      "antimage_blink",
      null,
      versionId,
    );
  });

  it("keeps unversioned requests on the current asset head", async () => {
    const response = await GET(
      new Request("http://localhost/valve-assets/hero/npc_dota_hero_antimage"),
      routeParams("hero", "npc_dota_hero_antimage"),
    );

    expect(mocks.getActiveEntityIcon).toHaveBeenCalledWith(
      "hero",
      "npc_dota_hero_antimage",
      null,
    );
    expect(response.status).toBe(200);
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

  it.each([
    "",
    "asset-dataset-2",
    "11111111111141118111111111111111",
    "11111111-1111-0111-8111-111111111111",
    "11111111-1111-4111-7111-111111111111",
    `${assetDatasetVersionId}extra`,
  ])("rejects invalid asset dataset version %j before querying", async (v) => {
    const response = await GET(
      new Request(
        `http://localhost/valve-assets/ability/antimage_blink?v=${encodeURIComponent(v)}`,
      ),
      routeParams("ability", "antimage_blink"),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid asset dataset version.");
    expect(mocks.getActiveEntityIcon).not.toHaveBeenCalled();
  });
});

function routeParams(entity: string, key: string) {
  return { params: Promise.resolve({ entity, key }) };
}
