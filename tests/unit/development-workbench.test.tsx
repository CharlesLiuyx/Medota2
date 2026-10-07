// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/i18n/provider";
import { DevelopmentWorkbench } from "@/components/development-workbench";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  router.refresh.mockReset();
});

it("pauses hidden tabs, resumes with the latest result, and prevents overlapping polls", async () => {
  vi.useFakeTimers();
  let hidden = true;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  let revision = 1;
  let pending: (() => void) | undefined;
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        pending = () =>
          resolve(
            new Response(
              JSON.stringify({
                schemaVersion: 1,
                instance: "one",
                sample: "passed",
                phase: "ready",
                revision,
                resultRevision: revision,
                pendingSetup: [],
                changedFiles: [],
                updatedAt: String(revision),
                message: "ready",
              }),
            ),
          );
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const view = render(
    <LocaleProvider initialLocale="zh-CN">
      <DevelopmentWorkbench />
    </LocaleProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fetchMock).not.toHaveBeenCalled();
  const visibility = async (value: boolean) => {
    await act(async () => {
      hidden = value;
      document.dispatchEvent(new Event("visibilitychange"));
    });
  };
  await visibility(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await visibility(true);
  await visibility(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending!();
  });
  expect(router.refresh).not.toHaveBeenCalled();
  await visibility(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  revision = 2;
  await visibility(false);
  await act(async () => {
    pending!();
  });
  expect(router.refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
    pending!();
  });
  expect(router.refresh).toHaveBeenCalledTimes(1);
  view.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
