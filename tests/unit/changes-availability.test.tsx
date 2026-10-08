// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ChangesPage from "@/app/changes/page";
import { EnvironmentContractError } from "@/server/environment/policy";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  diff: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/i18n/server", () => ({
  getTranslations: async () => (s: string) => s,
  getRequestLocale: async () => "zh-CN",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/server/services/releases", () => ({
  resolvePageRelease: mocks.resolve,
  getReleaseIndex: async () => ({ releases: [{ id: "c:a" }, { id: "c:b" }] }),
}));
vi.mock("@/server/services/entity-version-diff", () => ({
  getEntityVersionDiff: mocks.diff,
}));
vi.mock("@/server/services/release-changes", () => ({
  getReleaseChangesView: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it.each(["resolve", "diff"])(
  "keeps a retryable page when %s loses its connection, including across HMR",
  async (stage) => {
    // An older module's pool produces an Error with the same public contract,
    // but not an instance of the freshly loaded error class.
    const oldModuleError = Object.assign(new Error("safe"), {
      name: "EnvironmentContractError",
      code: "ENV_CONNECT_FAILED",
      connectionFailure: "timeout",
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.resolve.mockResolvedValue({ id: "c:b" });
    mocks[stage as "resolve" | "diff"].mockRejectedValue(oldModuleError);
    const view = render(
      await ChangesPage({ searchParams: Promise.resolve({ release: "c:b" }) }),
    );
    expect(view.getByRole("status").textContent).toContain("暂时无法加载");
    fireEvent.click(view.getByRole("button", { name: "重试" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    // A subsequent request is attempted again; no rejected promise is cached here.
    mocks.resolve.mockResolvedValue(null);
    const recovered = await ChangesPage({ searchParams: Promise.resolve({}) });
    view.rerender(recovered);
    expect(view.queryByRole("button", { name: "重试" })).toBeNull();
  },
);

it.each([
  new EnvironmentContractError("ENV_TARGET_MISMATCH"),
  new Error("programming error"),
  new Error("NEXT_REDIRECT"),
  new Error("NEXT_HTTP_ERROR_FALLBACK;404"),
])(
  "does not hide integrity, navigation or programming failures: %s",
  async (error) => {
    mocks.resolve.mockRejectedValue(error);
    await expect(
      ChangesPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toBe(error);
  },
);
