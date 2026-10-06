// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { CompactSelect } from "@/components/ui/compact-select";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("works outside forms, skips disabled choices with keyboard and preserves focus", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const changed = vi.fn();
  render(
    <CompactSelect label="移动方式" value="ground" onValueChange={changed}>
      <option value="ground">陆地</option>
      <option disabled value="blocked">
        未收录
      </option>
      <option value="fly">飞行</option>
    </CompactSelect>,
  );
  const trigger = screen.getByRole("combobox", { name: "移动方式" });
  fireEvent.click(trigger);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: "陆地" }),
    ),
  );
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(document.activeElement).toBe(
    screen.getByRole("option", { name: "飞行" }),
  );
  fireEvent.click(screen.getByRole("option", { name: "未收录" }));
  expect(changed).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  expect(changed).toHaveBeenCalledWith("fly");
  expect(document.activeElement).toBe(trigger);
  expect(trigger.closest("details")!.open).toBe(false);
});
it("preserves the catalog FormData contract and accepts numeric option values", () => {
  const changed = vi.fn();
  render(
    <form>
      <input name="q" defaultValue="test" />
      <CompactSelect name="time" label="时间" value={0} onChange={changed}>
        <option value={0}>0:00</option>
        <option value={60}>1:00</option>
      </CompactSelect>
    </form>,
  );
  fireEvent.click(screen.getByRole("combobox", { name: "时间" }));
  fireEvent.click(
    within(screen.getByRole("listbox", { name: "时间" })).getByRole("option", {
      name: "1:00",
    }),
  );
  expect(changed.mock.calls[0][0].get("time")).toBe("60");
  expect(changed.mock.calls[0][0].get("q")).toBe("test");
});
