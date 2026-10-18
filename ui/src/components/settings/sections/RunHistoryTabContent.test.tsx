import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunHistoryTabContent } from "./CommanderSection";

describe("RunHistoryTabContent", () => {
  const runs = [
    {
      id: "r1",
      triggerType: "conversation",
      status: "completed",
      costCents: 0,
      durationMs: 1500,
      createdAt: "2026-06-16T08:00:00Z",
      tokenUsage: { inputTokens: 1200, outputTokens: 340 },
    },
  ];

  it("shows an Est. Cost header and a real Tokens cell", () => {
    render(
      <RunHistoryTabContent
        allRuns={runs}
        runsAggregates={{ totalCostCents: 0, totalRuns: 1, avgDurationMs: 1500, failureRate: 0 }}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={() => {}}
      />,
    );
    expect(screen.getAllByText("Est. Cost").length).toBeGreaterThan(0);
    expect(screen.getByText("1.2k / 340")).toBeInTheDocument();
  });

  it("renders an em-dash when tokenUsage is absent", () => {
    render(
      <RunHistoryTabContent
        allRuns={[{ ...runs[0], tokenUsage: undefined }]}
        runsAggregates={undefined}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={() => {}}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the durable failure guidance and leaves cost blank when no run was completed", () => {
    render(
      <RunHistoryTabContent
        allRuns={[{
          ...runs[0],
          status: "failed",
          errorMessage: "No company provider key is configured. Add one in Settings → Providers, then retry.",
          costCents: null,
          tokenUsage: null,
        }]}
        runsAggregates={undefined}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={() => {}}
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent("Add one in Settings → Providers, then retry.");
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});
