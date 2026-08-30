// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DatasetBadge } from "@/components/ui/dataset-badge";

afterEach(cleanup);

describe("DatasetBadge", () => {
  it.each([
    ["green", "Green"],
    ["yellow", "Yellow"],
    ["red", "Red"],
  ] as const)("renders the %s catalog gate", (gateStatus, label) => {
    render(
      <DatasetBadge
        clientVersion="6918"
        sourceCommit="991daaf6fc24b08445209d9ce8767e145bab107e"
        gateStatus={gateStatus}
      />,
    );

    expect(screen.getByLabelText(`Dataset gate ${label}`)).toBeTruthy();
    expect(
      screen.getByText(`991daaf6fc · ${label.toUpperCase()}`),
    ).toBeTruthy();
  });

  it("does not present non-blocking audit records as dataset health", () => {
    render(
      <DatasetBadge
        clientVersion="6918"
        sourceCommit="991daaf6fc24b08445209d9ce8767e145bab107e"
        gateStatus="green"
      />,
    );

    expect(screen.queryByText(/warnings/iu)).toBeNull();
  });
});
