// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { viewportAssetLimit } from "@/domain/viewport-assets";
import {
  backgroundTurn,
  isViewportAssetReady,
  warmViewportAsset,
} from "@/browser/viewport-assets";

const asset = { src: "/valve-assets/hero/axe?v=version-a", sizes: "96px" };
beforeEach(() => {
  Object.assign(document.documentElement.dataset, {
    environmentVerification: "verified",
    environment: "test",
    dataClass: "synthetic-fixture",
    environmentRun: crypto.randomUUID(),
    environmentFingerprint: "test",
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("viewport image warming", () => {
  it("shares concurrent decoding, matches responsive candidates and isolates version, size and environment", async () => {
    const instances: HTMLImageElement[] = [];
    let resolve!: () => void;
    const decode = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("Image", function Image() {
      const img = document.createElement("img");
      Object.defineProperties(img, {
        naturalWidth: { value: 192 },
        naturalHeight: { value: 108 },
        currentSrc: { value: "http://localhost/selected-192.png" },
      });
      img.decode = decode;
      instances.push(img);
      return img;
    });
    const first = warmViewportAsset(asset),
      second = warmViewportAsset(asset);
    await Promise.resolve();
    expect(isViewportAssetReady(asset.src, asset.sizes)).toBe(false);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(instances[0].srcset).toContain("width=96 96w");
    expect(instances[0].sizes).toBe("96px");
    resolve();
    await Promise.all([first, second]);
    expect(instances[0].src).toBe("http://localhost/selected-192.png");
    expect(instances[0].hasAttribute("srcset")).toBe(false);
    expect(instances[0].hasAttribute("sizes")).toBe(false);
    expect(isViewportAssetReady(asset.src, asset.sizes)).toBe(true);
    expect(
      isViewportAssetReady(
        asset.src.replace("version-a", "version-b"),
        asset.sizes,
      ),
    ).toBe(false);
    expect(isViewportAssetReady(asset.src, "36px")).toBe(false);
    document.documentElement.dataset.environmentRun = "other";
    expect(isViewportAssetReady(asset.src, asset.sizes)).toBe(false);
  });
  it("does not cache failed images and retries", async () => {
    const decode = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const instances: HTMLImageElement[] = [];
    vi.stubGlobal("Image", function Image() {
      const img = document.createElement("img");
      Object.defineProperties(img, {
        naturalWidth: { value: 96 },
        naturalHeight: { value: 54 },
      });
      img.decode = decode;
      instances.push(img);
      return img;
    });
    await expect(warmViewportAsset(asset)).rejects.toThrow("offline");
    for (const name of ["src", "srcset", "sizes"])
      expect(instances[0].hasAttribute(name)).toBe(false);
    expect(isViewportAssetReady(asset.src, asset.sizes)).toBe(false);
    await warmViewportAsset(asset);
    expect(decode).toHaveBeenCalledTimes(2);
    expect(isViewportAssetReady(asset.src, asset.sizes)).toBe(true);
  });
  it("cancels idle work and skips data saver", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = backgroundTurn(controller.signal);
    controller.abort();
    await expect(pending).resolves.toBe(false);
    vi.stubGlobal("navigator", {
      onLine: true,
      connection: { saveData: true },
    });
    const skipped = backgroundTurn(new AbortController().signal);
    await vi.runAllTimersAsync();
    await expect(skipped).resolves.toBe(false);
  });
  it("sizes work to the viewport and bounds very large screens", () => {
    expect(viewportAssetLimit("units", 390, 844)).toBe(22);
    expect(viewportAssetLimit("units", 1440, 900)).toBe(72);
    expect(viewportAssetLimit("heroes", 1440, 500)).toBe(120);
    expect(viewportAssetLimit("heroes", 10000, 10000)).toBe(192);
  });
});
