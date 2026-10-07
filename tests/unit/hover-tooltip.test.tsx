// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";

const renders = vi.hoisted(() => new Map<string, number>());
vi.mock("next/link", () => ({
  default: ({
    prefetch,
    href,
    ...props
  }: ComponentProps<"a"> & { prefetch?: boolean }) => {
    renders.set(href!, (renders.get(href!) ?? 0) + 1);
    return <a href={href} data-prefetch={String(prefetch)} {...props} />;
  },
}));
import { HoverTooltip } from "@/components/ui/hover-tooltip";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  renders.clear();
});

it("opens a help button without navigation and keeps source links keyboard-accessible", () => {
  render(
    <HoverTooltip content={<a href="https://example.com/source">来源</a>}>
      版本说明
    </HoverTooltip>,
  );
  const help = screen.getByRole("button", { name: "版本说明" });
  fireEvent.click(help);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  expect(renders.size).toBe(0);
  const source = screen.getByRole("link", { name: "来源" });
  fireEvent.blur(help, { relatedTarget: source });
  fireEvent.focus(source);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("updates only the previous and next anchor across a dense catalog", () => {
  render(
    <>
      {Array.from({ length: 200 }, (_, i) => (
        <HoverTooltip key={i} href={`/heroes/${i}`} content={`Details ${i}`}>
          Hero {i}
        </HoverTooltip>
      ))}
    </>,
  );
  renders.clear();
  fireEvent.focus(screen.getByText("Hero 0"));
  expect([...renders.keys()]).toEqual(["/heroes/0?lang=zh-CN"]);
  renders.clear();
  fireEvent.focus(screen.getByText("Hero 1"));
  expect([...renders.keys()].sort()).toEqual([
    "/heroes/0?lang=zh-CN",
    "/heroes/1?lang=zh-CN",
  ]);
  expect(screen.getAllByRole("tooltip")).toHaveLength(1);
  expect(screen.getByRole("tooltip").textContent).toBe("Details 1");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("prefetches only a settled active anchor and cancels a quick pass", () => {
  vi.useFakeTimers();
  render(
    <>
      <HoverTooltip href="/heroes/one" content="One">
        First
      </HoverTooltip>
      <HoverTooltip href="/heroes/two" content="Two">
        Second
      </HoverTooltip>
    </>,
  );
  const first = screen.getByText("First");
  const second = screen.getByText("Second");
  fireEvent.focus(first);
  act(() => vi.advanceTimersByTime(60));
  fireEvent.focus(second);
  act(() => vi.advanceTimersByTime(120));
  expect(first.getAttribute("data-prefetch")).toBe("false");
  expect(second.getAttribute("data-prefetch")).toBe("true");
  fireEvent.blur(second);
  expect(second.getAttribute("data-prefetch")).toBe("false");
  expect(screen.queryByRole("tooltip")).toBeNull();
});
