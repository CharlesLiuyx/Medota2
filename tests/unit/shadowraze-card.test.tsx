// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ShadowrazeCard } from "@/components/shadowraze-card";
import type { TooltipAbility } from "@/presentation/dota";

vi.mock("@/components/ability-icon", () => ({ AbilityIcon: () => null }));
afterEach(cleanup);

it("uses one card and selects the complete range definition and its original detail link", () => {
  const rows: TooltipAbility[] = [200, 450, 700].map((range, index) => ({
    internal_name: `nevermore_shadowraze${index + 1}`,
    display_name: "毁灭阴影",
    description: "对前方区域造成伤害。",
    cooldown: String(9 + index),
    values: [{ value_key: "shadowraze_range", level_values: [String(range)] }],
  }));
  const abilities: [TooltipAbility, TooltipAbility, TooltipAbility] = [
    rows[0],
    rows[1],
    rows[2],
  ];
  render(
    <ShadowrazeCard
      abilities={abilities}
      tokens={{}}
      assetVersion="assets"
      lang="en"
    />,
  );
  for (const [index, label] of [
    "近距离 200",
    "中距离 450",
    "远距离 700",
  ].entries()) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getAllByText("对前方区域造成伤害。")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: label }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("link", { name: "毁灭阴影" }).getAttribute("href"),
    ).toBe(`/abilities/nevermore_shadowraze${index + 1}?lang=en`);
    expect(screen.getByText(/◷ 冷却/).textContent).toContain(`${9 + index}`);
  }
  // Existing links into any of the three original skill anchors still resolve.
  for (const ability of abilities)
    expect(
      document.getElementById(`skill-${ability.internal_name}`),
    ).not.toBeNull();
});
