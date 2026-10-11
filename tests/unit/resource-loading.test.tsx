// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useCatalogAttributeValues,
  useCatalogTableAttributes,
} from "@/components/use-catalog-table-attributes";
import { DeferredResource } from "@/components/deferred-resource";
import { AttributeCatalog } from "@/components/attribute-catalog";
import { CatalogViewSwitch } from "@/components/catalog-view-switch";
import { LocaleProvider } from "@/i18n/provider";
import { browserResources, resourceKey } from "@/browser/resources";
import { persistResource } from "@/browser/persistent-resources";
import type { CatalogAttributeManifest } from "@/presentation/catalog-table-columns";
import type { ListSlice } from "@/domain/infinite-list";
import type { AttributeSummary } from "@/domain/attributes";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams("release=c:test"),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.params,
  usePathname: () => "/attributes",
  useRouter: () => ({ refresh: navigation.refresh }),
}));
vi.mock("@/browser/persistent-resources", () => ({
  readPersistentResource: async () => undefined,
  persistResource: vi.fn(async () => undefined),
}));
vi.mock("@/components/infinite-list", () => ({
  InfiniteList: ({
    source,
  }: {
    source: { initialSlice: { items: { id: string }[] } };
  }) => (
    <output data-testid="slice">
      {source.initialSlice.items.map((item) => item.id).join(",")}
    </output>
  ),
}));

let serial = 0;
beforeEach(() => {
  window.history.replaceState(null, "", "/heroes?release=c:test");
  navigation.params = new URLSearchParams("release=c:test");
  navigation.refresh.mockClear();
  vi.mocked(persistResource).mockClear();
  Object.assign(document.documentElement.dataset, {
    environmentVerification: "verified",
    environment: "development",
    dataClass: "sandbox",
    environmentRun: `test-${serial++}`,
    environmentFingerprint: "safe",
  });
});

it("applies a delayed view change to the latest filters and cancels it after navigation", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const paint = () =>
    act(() => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
    });
  render(
    <LocaleProvider initialLocale="zh-CN">
      <CatalogViewSwitch />
    </LocaleProvider>,
  );
  const table = screen.getByRole("button", { name: "表格视图" });
  fireEvent.click(table);
  window.history.replaceState(null, "", "/heroes?release=c:test&q=axe");
  paint();
  paint();
  expect(
    Object.fromEntries(new URLSearchParams(window.location.search)),
  ).toEqual({
    release: "c:test",
    q: "axe",
    view: "table",
  });
  fireEvent.click(table);
  paint();
  window.history.replaceState(null, "", "/items?release=c:other&q=blink");
  paint();
  expect(window.location.pathname + window.location.search).toBe(
    "/items?release=c:other&q=blink",
  );
  fireEvent.click(table);
  act(() => window.dispatchEvent(new PopStateEvent("popstate")));
  paint();
  paint();
  expect(window.location.search).toBe("?release=c:other&q=blink");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function response(body: unknown, status = 200, environment = "development") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "x-medota2-environment-verification": "verified",
      "x-medota2-environment": environment,
      "x-medota2-data-class": "sandbox",
      "x-medota2-run-id": document.documentElement.dataset.environmentRun!,
      "x-medota2-database-fingerprint": "safe",
    },
  });
}
const manifest = (resourceId: string): CatalogAttributeManifest => ({
  version: 2,
  release: "c:test",
  datasetVersionId: "test",
  resourceId,
  kind: "hero",
  columns: [],
});

it("renders completed warm resources immediately and isolates a changed environment", async () => {
  const descriptor = manifest("warm");
  browserResources.set(
    resourceKey(["attribute-manifest/2", "c:test", "hero"]),
    descriptor,
  );
  browserResources.set(resourceKey(["warm", "armor"]), { axe: ["2"] });
  browserResources.set(resourceKey(["warm", "health"]), { axe: ["700"] });
  let respond: (value: Response) => void = () => {};
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const renders: Array<{ id?: string; armor?: string[] }> = [];
  const view = renderHook(
    ({ columns }) => {
      const attributes = useCatalogTableAttributes("hero");
      const values = useCatalogAttributeValues(attributes.data, columns);
      renders.push({
        id: attributes.data?.resourceId,
        armor: values.values?.armor?.axe,
      });
      return { attributes, values };
    },
    { initialProps: { columns: ["armor"] } },
  );
  expect(renders[0]).toEqual({ id: "warm", armor: ["2"] });
  expect(fetcher).not.toHaveBeenCalled();
  view.rerender({ columns: ["armor", "health"] });
  expect(view.result.current.values.values?.health?.axe).toEqual(["700"]);
  expect(fetcher).not.toHaveBeenCalled();
  view.rerender({ columns: ["armor", "health", "mana"] });
  expect(view.result.current.values.values?.armor?.axe).toEqual(["2"]);
  expect(view.result.current.values.loaded?.has("mana")).toBe(false);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await act(async () =>
    respond(
      response({
        version: 2,
        resourceId: "warm",
        loadedColumns: ["mana"],
        values: { axe: { mana: ["291"] } },
      }),
    ),
  );
  await waitFor(() =>
    expect(view.result.current.values.loaded?.has("mana")).toBe(true),
  );
  document.documentElement.dataset.environmentRun = `other-${serial++}`;
  view.rerender({ columns: ["armor"] });
  expect(view.result.current.attributes.data).toBeUndefined();
  expect(view.result.current.values.values).toBeUndefined();
});

it("clears a recovered cache error and keeps an in-flight result in its original environment", async () => {
  const descriptor = manifest("recovered");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  const view = renderHook(() =>
    useCatalogAttributeValues(descriptor, ["armor"]),
  );
  await waitFor(() => expect(view.result.current.failed).toBe(true));
  browserResources.set(resourceKey(["recovered", "armor"]), { axe: ["2"] });
  act(() => view.result.current.retry());
  expect(view.result.current.failed).toBe(false);
  expect(view.result.current.values?.armor?.axe).toEqual(["2"]);
  view.unmount();

  let finish: (value: unknown) => void = () => {};
  const body = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = response({});
  pending.json = body;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => pending),
  );
  const originalKey = resourceKey(["in-flight", "armor"]);
  const originalFamily = resourceKey(["attribute-column/2", "hero", "armor"]);
  const inFlight = manifest("in-flight");
  const next = renderHook(() => useCatalogAttributeValues(inFlight, ["armor"]));
  await waitFor(() => expect(body).toHaveBeenCalledTimes(1));
  document.documentElement.dataset.environmentRun = `new-${serial++}`;
  next.unmount();
  await act(async () =>
    finish({
      version: 2,
      resourceId: "in-flight",
      loadedColumns: ["armor"],
      values: { axe: { armor: ["3"] } },
    }),
  );
  await waitFor(() =>
    expect(persistResource).toHaveBeenCalledWith(originalKey, originalFamily, {
      axe: ["3"],
    }),
  );
  expect(
    browserResources.peek(resourceKey(["in-flight", "armor"])),
  ).toBeUndefined();
});

it("shares column requests, retains all owners, and reloads a stale manifest before retry", async () => {
  let revision = "old";
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    options?.method === "POST"
      ? response({}, 409)
      : response(manifest(revision)),
  );
  vi.stubGlobal("fetch", fetcher);
  const descriptor = renderHook(() => useCatalogTableAttributes("hero"));
  await waitFor(() =>
    expect(descriptor.result.current.data?.resourceId).toBe("old"),
  );
  const columns = renderHook(() =>
    useCatalogAttributeValues(descriptor.result.current.data, ["armor"]),
  );
  await waitFor(() => expect(columns.result.current.stale).toBe(true));
  revision = "new";
  act(() => descriptor.result.current.retry());
  await waitFor(() =>
    expect(descriptor.result.current.data?.resourceId).toBe("new"),
  );
  const load = vi.fn(async () =>
    response({
      version: 2,
      resourceId: "new",
      loadedColumns: ["armor"],
      values: { axe: { armor: ["2"] }, antimage: { armor: ["1"] } },
    }),
  );
  vi.stubGlobal("fetch", load);
  const currentManifest = manifest("new");
  const first = renderHook(() =>
    useCatalogAttributeValues(currentManifest, ["armor"]),
  );
  const second = renderHook(() =>
    useCatalogAttributeValues(currentManifest, ["armor"]),
  );
  await waitFor(() =>
    expect(first.result.current.loaded?.has("armor")).toBe(true),
  );
  await waitFor(() =>
    expect(second.result.current.loaded?.has("armor")).toBe(true),
  );
  expect(load).toHaveBeenCalledTimes(1);
  expect(first.result.current.values?.armor).toEqual({
    axe: ["2"],
    antimage: ["1"],
  });
});

it("keeps an SSR query paired with its seed and rejects a response from another environment", async () => {
  const slice = (
    id: string,
  ): ListSlice<Omit<AttributeSummary, "searchText">> => ({
    datasetVersionId: "test",
    items: [{ id } as AttributeSummary],
    nextCursor: null,
    previousCursor: null,
    total: 1,
  });
  const element = (id: string) => (
    <LocaleProvider initialLocale="zh-CN">
      <AttributeCatalog
        header="attributes"
        initialSlice={slice(id)}
        version="test"
        totalAttributes={2}
      />
    </LocaleProvider>
  );
  const fetcher = vi.fn(async () => response(slice("B")));
  vi.stubGlobal("fetch", fetcher);
  const view = render(element("A"));
  expect(fetcher).not.toHaveBeenCalled();
  navigation.params.set("q", "B");
  view.rerender(element("A"));
  await waitFor(() =>
    expect(screen.getByTestId("slice").textContent).toBe("B"),
  );
  const initialKey = resourceKey([
    "attribute-summary/1",
    "test",
    "/api/attributes?q=&scope=common&release=c%3Atest",
  ]);
  browserResources.delete(initialKey);
  view.rerender(element("B"));
  navigation.params.delete("q");
  view.rerender(element("B"));
  await waitFor(() =>
    expect(screen.getByTestId("slice").textContent).toBe("A"),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(slice("foreign"), 200, "other")),
  );
  navigation.params.set("q", "foreign");
  view.rerender(element("B"));
  await screen.findByRole("button", { name: "属性加载失败，点击重试" });
  expect(
    browserResources.has(
      resourceKey([
        "attribute-summary/1",
        "test",
        "/api/attributes?q=foreign&scope=common&release=c%3Atest",
      ]),
    ),
  ).toBe(false);
});

it("refreshes changed evidence and retries an ordinary network error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response({}, 409)),
  );
  const view = render(
    <LocaleProvider initialLocale="zh-CN">
      <DeferredResource url="/evidence/old">{() => "data"}</DeferredResource>
    </LocaleProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "刷新页面" }));
  expect(navigation.refresh).toHaveBeenCalledTimes(1);
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(response({ value: "recovered" }));
  vi.stubGlobal("fetch", fetcher);
  view.rerender(
    <LocaleProvider initialLocale="zh-CN">
      <DeferredResource<{ value: string }> url="/evidence/new">
        {(data) => data.value}
      </DeferredResource>
    </LocaleProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "重试" }));
  await screen.findByText("recovered");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
