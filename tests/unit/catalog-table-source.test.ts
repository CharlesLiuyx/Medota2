// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  loadCompleteList,
  type RemoteCursorListSource,
} from "@/components/infinite-list";

const source: RemoteCursorListSource<{ id: number }> = {
  kind: "remote",
  endpoint:
    "/api/catalog/heroes?datasetVersionId=catalog&assetDatasetVersionId=assets",
  initialSlice: {
    items: [{ id: 1 }],
    previousCursor: null,
    nextCursor: "second",
    total: 3,
    datasetVersionId: "catalog",
    assetDatasetVersionId: "assets",
  },
};
afterEach(() => vi.unstubAllGlobals());
it("materializes every pinned page before global table sorting", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [{ id: 2 }],
          previousCursor: "first",
          nextCursor: "third",
          datasetVersionId: "catalog",
          assetDatasetVersionId: "assets",
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [{ id: 3 }],
          previousCursor: "second",
          nextCursor: null,
          datasetVersionId: "catalog",
          assetDatasetVersionId: "assets",
        }),
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  await expect(
    loadCompleteList(source, (item) => item.id, controller.signal),
  ).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  expect(fetcher.mock.calls[1][0]).toContain("after=third");
  expect(fetcher.mock.calls[1][1].signal).toBe(controller.signal);
});
it("rejects a different dataset and incomplete results instead of sorting a partial catalog", async () => {
  const page = {
    items: [{ id: 2 }],
    previousCursor: "first",
    nextCursor: null,
    datasetVersionId: "other",
    assetDatasetVersionId: "assets",
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(page)))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ...page, datasetVersionId: "catalog" })),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    loadCompleteList(source, (item) => item.id, new AbortController().signal),
  ).rejects.toThrow(/dataset changed/);
  await expect(
    loadCompleteList(source, (item) => item.id, new AbortController().signal),
  ).rejects.toThrow(/incomplete/);
});
