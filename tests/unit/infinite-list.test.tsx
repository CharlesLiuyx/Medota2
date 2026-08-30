// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InfiniteList } from "@/components/infinite-list";
import { infiniteListPrefetchRootMargin } from "@/domain/infinite-list";

interface Item {
  id: string;
  label: string;
}

const observers: MockIntersectionObserver[] = [];

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin: string;
  readonly scrollMargin = "0px";
  readonly thresholds: readonly number[];
  readonly targets = new Set<Element>();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.rootMargin = options.rootMargin ?? "0px";
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0];
    observers.push(this);
  }

  observe = (target: Element) => {
    this.targets.add(target);
  };

  unobserve = (target: Element) => {
    this.targets.delete(target);
  };

  disconnect = () => {
    this.targets.clear();
  };

  takeRecords = () => [];

  trigger(target: Element, isIntersecting: boolean) {
    const rect = target.getBoundingClientRect();
    this.callback(
      [
        {
          boundingClientRect: rect,
          intersectionRatio: isIntersecting ? 1 : 0,
          intersectionRect: isIntersecting ? rect : emptyRect(),
          isIntersecting,
          rootBounds: emptyRect(),
          target,
          time: 0,
        },
      ],
      this,
    );
  }
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: FrameRequestCallback): number =>
      window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );
  vi.stubGlobal("scrollBy", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InfiniteList", () => {
  it("uses the exact symmetric 3x-height margin, updates it on resize, and appends a remote slice", async () => {
    vi.stubGlobal("innerHeight", 720);
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        items: [{ id: "b", label: "Beta" }],
        previousCursor: "before-b",
        nextCursor: null,
        total: 2,
        datasetVersionId: "catalog-1",
        assetDatasetVersionId: "assets-1",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderRemoteList();

    expect(observers).toHaveLength(1);
    expect(observers[0].rootMargin).toBe(
      infiniteListPrefetchRootMargin(window.innerHeight),
    );
    expect(observers[0].rootMargin).toBe("2160px 0px 2160px 0px");

    vi.stubGlobal("innerHeight", 900);
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(observers).toHaveLength(2));
    expect(observers[1].rootMargin).toBe("2700px 0px 2700px 0px");

    const bottom = document.querySelector(
      '[data-infinite-list-sentinel="after"]',
    )!;
    act(() => observers[1].trigger(bottom, true));

    expect(await screen.findByText("Beta")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestedUrl).toContain("filter=current");
    expect(requestedUrl).toContain("after=after-a");
    expect(
      document.querySelector("[data-infinite-list]")?.getAttribute("aria-busy"),
    ).toBe("false");
  });

  it("allows one request per direction, preserves items on duplicate-key errors, and retries the same cursor", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(
        response({
          items: [{ id: "b", label: "Beta" }],
          previousCursor: "before-b",
          nextCursor: null,
          total: 2,
          datasetVersionId: "catalog-1",
          assetDatasetVersionId: "assets-1",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderRemoteList();
    const bottom = document.querySelector(
      '[data-infinite-list-sentinel="after"]',
    )!;

    act(() => {
      observers[0].trigger(bottom, true);
      observers[0].trigger(bottom, true);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector("[data-infinite-list]")?.getAttribute("aria-busy"),
    ).toBe("true");

    await act(async () => {
      pending.resolve(
        response({
          items: [{ id: "a", label: "Alpha duplicate" }],
          previousCursor: null,
          nextCursor: null,
          total: 2,
          datasetVersionId: "catalog-1",
          assetDatasetVersionId: "assets-1",
        }),
      );
      await pending.promise;
    });

    expect((await screen.findByRole("alert")).textContent).toContain(
      "duplicate stable item key",
    );
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Alpha duplicate")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry more results" }));
    expect(await screen.findByText("Beta")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("after=after-a");
  });

  it.each([
    "invalid_cursor",
    "stream_mismatch",
    "dataset_unavailable",
  ] as const)(
    "delegates a %s problem to one stale reset instead of retrying the dead cursor",
    async (code) => {
      const onStale = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status:
            code === "invalid_cursor"
              ? 400
              : code === "stream_mismatch"
                ? 409
                : 410,
          json: async () => ({ code, message: "The pinned list expired." }),
        } as Response),
      );
      render(
        <InfiniteList<Item>
          source={{
            kind: "remote",
            endpoint: "/api/items",
            initialSlice: {
              items: [{ id: "a", label: "Alpha" }],
              previousCursor: null,
              nextCursor: "after-a",
              total: 2,
              datasetVersionId: "catalog-1",
              assetDatasetVersionId: "assets-1",
            },
          }}
          getKey={(item) => item.id}
          onStale={onStale}
          renderChunk={(items) =>
            items.map((item) => <p key={item.id}>{item.label}</p>)
          }
        />,
      );

      const bottom = document.querySelector(
        '[data-infinite-list-sentinel="after"]',
      )!;
      act(() => observers[0].trigger(bottom, true));

      await waitFor(() =>
        expect(onStale).toHaveBeenCalledWith({
          code,
          message: "The pinned list expired.",
        }),
      );
      expect(onStale).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: /retry more/iu })).toBeNull();
    },
  );

  it("resets when a successful response violates the pinned dataset identity", async () => {
    const onStale = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          items: [{ id: "b", label: "Beta" }],
          previousCursor: "before-b",
          nextCursor: null,
          total: 2,
          datasetVersionId: "catalog-2",
          assetDatasetVersionId: "assets-1",
        }),
      ),
    );
    render(
      <InfiniteList<Item>
        source={{
          kind: "remote",
          endpoint: "/api/items",
          initialSlice: {
            items: [{ id: "a", label: "Alpha" }],
            previousCursor: null,
            nextCursor: "after-a",
            total: 2,
            datasetVersionId: "catalog-1",
            assetDatasetVersionId: "assets-1",
          },
        }}
        getKey={(item) => item.id}
        onStale={onStale}
        renderChunk={(items) =>
          items.map((item) => <p key={item.id}>{item.label}</p>)
        }
      />,
    );

    const bottom = document.querySelector(
      '[data-infinite-list-sentinel="after"]',
    )!;
    act(() => observers[0].trigger(bottom, true));

    await waitFor(() =>
      expect(onStale).toHaveBeenCalledWith({
        code: "stream_mismatch",
        message: "The catalog dataset changed while loading this list.",
      }),
    );
    expect(screen.queryByText("Beta")).toBeNull();
    expect(screen.queryByRole("button", { name: /retry more/iu })).toBeNull();
  });

  it("aborts the old generation and ignores its late response", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    const view = renderRemoteList();
    const bottom = document.querySelector(
      '[data-infinite-list-sentinel="after"]',
    )!;
    act(() => observers[0].trigger(bottom, true));
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;

    view.rerender(
      <TestList
        endpoint="/api/items?filter=new"
        initial={{ id: "x", label: "New generation" }}
        dataset="catalog-2"
      />,
    );
    expect(signal.aborted).toBe(true);
    expect(screen.getByText("New generation")).toBeTruthy();

    await act(async () => {
      pending.resolve(
        response({
          items: [{ id: "stale", label: "Stale result" }],
          previousCursor: null,
          nextCursor: null,
          total: 2,
          datasetVersionId: "catalog-1",
          assetDatasetVersionId: "assets-1",
        }),
      );
      await pending.promise;
    });
    expect(screen.queryByText("Stale result")).toBeNull();
  });

  it("keeps the visual anchor when a before slice is prepended", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          items: [{ id: "a", label: "Earlier" }],
          previousCursor: null,
          nextCursor: "after-a",
          total: 2,
          datasetVersionId: "catalog-1",
          assetDatasetVersionId: "assets-1",
        }),
      ),
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const isOriginalChunk =
          this.hasAttribute("data-infinite-list-chunk") &&
          this.textContent?.includes("Current");
        const prepended =
          document.body.textContent?.includes("Earlier") ?? false;
        if (isOriginalChunk) return rect(prepended ? 250 : 50, 100);
        if (this.hasAttribute("data-infinite-list-chunk")) return rect(50, 100);
        return rect(0, 1);
      },
    );

    render(
      <InfiniteList<Item>
        source={{
          kind: "remote",
          endpoint: "/api/items",
          initialSlice: {
            items: [{ id: "b", label: "Current" }],
            previousCursor: "before-b",
            nextCursor: null,
            total: 2,
            datasetVersionId: "catalog-1",
            assetDatasetVersionId: "assets-1",
          },
        }}
        getKey={(item) => item.id}
        renderChunk={(items) =>
          items.map((item) => <p key={item.id}>{item.label}</p>)
        }
      />,
    );
    const top = document.querySelector(
      '[data-infinite-list-sentinel="before"]',
    )!;
    act(() => observers[0].trigger(top, true));

    expect(await screen.findByText("Earlier")).toBeTruthy();
    await waitFor(() => expect(window.scrollBy).toHaveBeenCalledWith(0, 200));
  });

  it("does not recycle a focused chunk, then replaces and restores it with an equal-height spacer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          items: [{ id: "b", label: "Beta" }],
          previousCursor: "before-b",
          nextCursor: null,
          total: 2,
          datasetVersionId: "catalog-1",
          assetDatasetVersionId: "assets-1",
        }),
      ),
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.textContent?.includes("Alpha")) return rect(-5_000, 120);
        if (this.textContent?.includes("Beta")) return rect(100, 120);
        return rect(0, 1);
      },
    );
    renderRemoteList(true);
    const bottom = document.querySelector(
      '[data-infinite-list-sentinel="after"]',
    )!;
    act(() => observers[0].trigger(bottom, true));
    expect(await screen.findByText("Beta")).toBeTruthy();

    const alphaButton = screen.getByRole("button", { name: "Alpha" });
    alphaButton.focus();
    const alphaChunk = alphaButton.closest("[data-infinite-list-chunk]")!;
    act(() => observers[0].trigger(alphaChunk, false));
    expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy();

    alphaButton.blur();
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull());
    expect(
      (alphaChunk.querySelector("[data-infinite-list-spacer]") as HTMLElement)
        .style.height,
    ).toBe("120px");

    act(() => observers[0].trigger(alphaChunk, true));
    expect(await screen.findByRole("button", { name: "Alpha" })).toBeTruthy();
  });

  it("keeps a chunk mounted while one of its disclosures is open", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.textContent?.includes("Alpha")) return rect(-5_000, 120);
        if (this.textContent?.includes("Beta")) return rect(100, 120);
        return rect(0, 1);
      },
    );
    render(
      <InfiniteList<Item>
        source={{
          kind: "local",
          items: [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
          ],
          chunkSize: 1,
        }}
        getKey={(item) => item.id}
        renderChunk={(items) =>
          items.map((item) => (
            <details key={item.id}>
              <summary>{item.label}</summary>
              <p>{item.label} body</p>
            </details>
          ))
        }
      />,
    );
    const bottom = document.querySelector(
      '[data-infinite-list-sentinel="after"]',
    )!;
    act(() => observers[0].trigger(bottom, true));
    expect(await screen.findByText("Beta")).toBeTruthy();

    const details = screen.getByText("Alpha").closest("details")!;
    details.open = true;
    const chunk = details.closest("[data-infinite-list-chunk]")!;
    act(() => observers[0].trigger(chunk, false));
    expect(screen.getByText("Alpha")).toBeTruthy();

    details.open = false;
    fireEvent(details, new Event("toggle"));
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull());
    expect(chunk.querySelector("[data-infinite-list-spacer]")).not.toBeNull();
  });

  it("falls back to RAF-throttled document scroll checks without IntersectionObserver", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(
      <InfiniteList<Item>
        source={{
          kind: "local",
          items: [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
          ],
          chunkSize: 1,
        }}
        getKey={(item) => item.id}
        renderChunk={(items) =>
          items.map((item) => <p key={item.id}>{item.label}</p>)
        }
      />,
    );

    expect(await screen.findByText("Beta")).toBeTruthy();
    expect(document.querySelector("[data-infinite-list] > p.py-5")).toBeNull();
  });
});

function renderRemoteList(buttons = false) {
  return render(
    <TestList
      endpoint="/api/items?filter=current"
      initial={{ id: "a", label: "Alpha" }}
      dataset="catalog-1"
      buttons={buttons}
    />,
  );
}

function TestList({
  endpoint,
  initial,
  dataset,
  buttons = false,
}: {
  endpoint: string;
  initial: Item;
  dataset: string;
  buttons?: boolean;
}) {
  return (
    <InfiniteList<Item>
      source={{
        kind: "remote",
        endpoint,
        initialSlice: {
          items: [initial],
          previousCursor: null,
          nextCursor: "after-a",
          total: 2,
          datasetVersionId: dataset,
          assetDatasetVersionId: "assets-1",
        },
      }}
      getKey={(item) => item.id}
      renderChunk={(items) =>
        items.map((item) =>
          buttons ? (
            <button key={item.id}>{item.label}</button>
          ) : (
            <p key={item.id}>{item.label}</p>
          ),
        )
      }
    />
  );
}

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function rect(top: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 100,
    top,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function emptyRect(): DOMRect {
  return rect(0, 0);
}
