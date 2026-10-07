// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DatasetBadge } from "@/components/ui/dataset-badge";

afterEach(cleanup);

describe("DatasetBadge", () => {
  it.each([
    ["green", "游戏版本"],
    ["yellow", "部分资料仍待核对"],
    ["red", "资料暂不可用"],
  ] as const)("renders the %s catalog gate", (gateStatus, label) => {
    render(
      <DatasetBadge
        clientVersion="6918"
        sourceCommit="991daaf6fc24b08445209d9ce8767e145bab107e"
        gateStatus={gateStatus}
      />,
    );

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("客户端 6918")).toBeTruthy();
    expect(screen.getByText("待确认")).toBeTruthy();
    expect(screen.queryByText(/991daaf6fc/u)).toBeNull();
  });

  it("shows the verified gameplay patch separately from the client build", () => {
    render(
      <DatasetBadge
        clientVersion="6918"
        sourceCommit="991daaf6fc24b08445209d9ce8767e145bab107e"
        gateStatus="green"
        gameplayVersion="7.41e"
      />,
    );

    expect(screen.getByText("7.41e")).toBeTruthy();
    expect(screen.queryByText("待确认")).toBeNull();
  });
});
