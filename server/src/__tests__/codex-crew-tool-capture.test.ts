import { describe, expect, it } from "vitest";
import { createCodexCrewToolCapture } from "../services/internal-agent/aoa-agents/codex-crew-tool-capture.js";

function completedTool(tool = "hub.updateCurationSummary", patch: Record<string, unknown> = {}) {
  return {
    type: "item.completed",
    item: {
      id: "call-fixture", type: "mcp_tool_call", server: "aoa", tool,
      status: "completed", error: null,
      result: { content: [{ type: "text", text: JSON.stringify({ success: true }) }] },
      ...patch,
    },
  };
}

describe("Codex crew successful tool-name capture", () => {
  it("records completed AoA tools once per name without copying arguments or results", () => {
    const capture = createCodexCrewToolCapture(["hub.readCurationContext", "hub.updateCurationSummary"]);
    const event = completedTool("hub.updateCurationSummary", {
      arguments: { secret: "private-argument" },
      result: { content: [{ type: "text", text: JSON.stringify({ success: true, data: "private-result-url?token=fixture" }) }] },
    });

    capture.push(`${JSON.stringify(completedTool("hub.readCurationContext"))}\n${JSON.stringify(event)}\n${JSON.stringify(event)}\n`);

    expect(capture.names()).toEqual(["hub.readCurationContext", "hub.updateCurationSummary"]);
    expect(JSON.stringify(capture.names())).not.toMatch(/private|token|argument|result/);
  });

  it("handles split JSONL and flushes a final complete event without a newline", () => {
    const capture = createCodexCrewToolCapture(["hub.updateCurationSummary"]);
    const line = JSON.stringify(completedTool());
    capture.push(line.slice(0, 57));
    capture.push(line.slice(57));
    expect(capture.names()).toEqual([]);

    capture.flush();

    expect(capture.names()).toEqual(["hub.updateCurationSummary"]);
  });

  it("rejects started, failed, foreign, disallowed and unsuccessful events", () => {
    const capture = createCodexCrewToolCapture(["hub.updateCurationSummary"]);
    const events = [
      { ...completedTool(), type: "item.started" },
      completedTool(undefined, { status: "failed" }),
      completedTool(undefined, { error: { message: "failed" } }),
      completedTool(undefined, { server: "foreign" }),
      completedTool("unlisted.tool"),
      completedTool(undefined, { result: { isError: true, content: [{ type: "text", text: '{"success":true}' }] } }),
      completedTool(undefined, { result: { content: [{ type: "text", text: '{"success":false}' }] } }),
      completedTool(undefined, { result: { content: [{ type: "text", text: "unknown result" }] } }),
      { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(completedTool()) } },
    ];
    capture.push(`${events.map((event) => JSON.stringify(event)).join("\n")}\nmalformed\n`);
    capture.flush();

    expect(capture.names()).toEqual([]);
  });

  it("discards an oversized line across chunks then recovers on the next line", () => {
    const capture = createCodexCrewToolCapture(["hub.updateCurationSummary"]);
    capture.push("x".repeat(65_536));
    capture.push(`x${JSON.stringify(completedTool())}\n`);
    expect(capture.names()).toEqual([]);

    capture.push(`${JSON.stringify(completedTool())}\n`);

    expect(capture.names()).toEqual(["hub.updateCurationSummary"]);
  });

  it("caps unique tool names and never accepts invalid allowlist names", () => {
    const allowed = Array.from({ length: 129 }, (_, index) => `tool_${index}`);
    const capture = createCodexCrewToolCapture([...allowed, "invalid\nname", null]);
    capture.push(`${[...allowed, "invalid\nname"].map((name) => JSON.stringify(completedTool(name))).join("\n")}\n`);

    expect(capture.names()).toHaveLength(128);
    expect(capture.names()).not.toContain("tool_128");
    expect(capture.names()).not.toContain("invalid\nname");
  });

  it("returns a snapshot so callers cannot fabricate later observed names", () => {
    const capture = createCodexCrewToolCapture(["hub.updateCurationSummary"]);
    capture.push(`${JSON.stringify(completedTool())}\n`);
    capture.names().push("fabricated.tool");

    expect(capture.names()).toEqual(["hub.updateCurationSummary"]);
  });
});
