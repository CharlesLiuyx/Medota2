import { afterEach, expect, it, vi } from "vitest";
import { warmBrowserOrigin } from "@/development/warm-browser";

afterEach(() => vi.unstubAllGlobals());

function serve(manifestRelease = "c:catalog", valuesStatus = 200) {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", async (target: string, init?: RequestInit) => {
    const url = new URL(target);
    requests.push({ url, init });
    let body: unknown = "";
    let status = 200;
    if (url.pathname === "/api/catalog/head")
      body = { datasetVersionId: "catalog", assetDatasetVersionId: "assets" };
    else if (url.pathname === "/api/catalog/table-attributes") {
      if (init?.method === "POST") {
        status = valuesStatus;
        body = { values: {} };
      } else
        body = {
          version: 2,
          release: manifestRelease,
          kind: "hero",
          datasetVersionId: "catalog",
          resourceId: "table-attributes/2:revision",
          columns: [{ key: "armor" }, { key: "health" }],
        };
    } else if (url.pathname.startsWith("/api/catalog/")) body = { items: [] };
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      {
        status,
      },
    );
  });
  return requests;
}

it("prepares a bounded column read from the pinned manifest before browser assertions", async () => {
  const requests = serve();
  await warmBrowserOrigin("http://127.0.0.1:3000", ["heroes"]);
  const table = requests.filter(
    ({ url }) => url.pathname === "/api/catalog/table-attributes",
  );
  expect(table.map(({ init }) => init?.method ?? "GET")).toEqual([
    "GET",
    "POST",
  ]);
  expect(
    table.every(({ url }) => url.searchParams.get("release") === "c:catalog"),
  ).toBe(true);
  expect(JSON.parse(String(table[1].init?.body))).toEqual({
    resourceId: "table-attributes/2:revision",
    columns: ["armor"],
  });
  for (const path of [
    "/api/catalog/head",
    "/api/catalog/heroes",
    "/api/catalog/abilities",
  ]) {
    expect(requests.filter(({ url }) => url.pathname === path)).toHaveLength(1);
  }
  expect(
    requests
      .filter(({ url }) => url.pathname === "/api/catalog/replica")
      .map(({ init }) => {
        const body = JSON.parse(String(init?.body));
        return `${body.entity}/${body.locale}`;
      })
      .sort(),
  ).toEqual(["abilities/en", "abilities/zh-CN", "heroes/en", "heroes/zh-CN"]);
});

it("does not mark mismatched or failed table preparation ready", async () => {
  const requests = serve("c:other");
  await expect(
    warmBrowserOrigin("http://127.0.0.1:3000", ["heroes"]),
  ).rejects.toThrow("invalid identity");
  expect(
    requests.some(
      ({ url, init }) =>
        url.pathname.endsWith("table-attributes") && init?.method === "POST",
    ),
  ).toBe(false);
  serve("c:catalog", 503);
  await expect(
    warmBrowserOrigin("http://127.0.0.1:3000", ["heroes"]),
  ).rejects.toThrow("table values: 503");
});
