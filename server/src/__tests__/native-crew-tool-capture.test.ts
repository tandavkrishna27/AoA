import { describe, expect, it } from "vitest";
import { createNativeCrewToolCapture } from "../services/internal-agent/aoa-agents/native-crew-tool-capture.js";
import { successfulCrewToolEvents } from "./helpers/native-crew-tool-fixtures.js";

const tool = "hub.updateCurationSummary";
const adapters = ["claude_local", "gemini_local", "opencode_local"];

function send(capture: NonNullable<ReturnType<typeof createNativeCrewToolCapture>>, events: unknown[]) {
  capture.push(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

function fixture(adapter: string, id = "fixture-call", name = tool): any[] {
  return successfulCrewToolEvents(adapter, name, id);
}

function alterResult(adapter: string, events: any[], values: Record<string, unknown>) {
  const event = events.at(-1);
  const result = adapter === "claude_local" ? event.message.content[0] : adapter === "gemini_local" ? event : event.part.state;
  Object.assign(result, values);
}

describe.each(adapters)("%s successful AoA tool-name capture", (adapter) => {
  it("collects split protocol lines, deduplicates names and retains only canonical names", () => {
    const capture = createNativeCrewToolCapture(adapter, [tool])!;
    const lines = fixture(adapter).map((event) => JSON.stringify(event)).join("\n");
    capture.push(lines.slice(0, 63));
    capture.push(lines.slice(63));
    expect(capture.names()).toEqual([]);
    capture.flush();
    send(capture, fixture(adapter, "second-call"));
    expect(capture.names()).toEqual([tool]);
    expect(JSON.stringify(capture.names())).not.toMatch(/private|token|argument|result/);
    capture.names().push("fabricated.tool");
    expect(capture.names()).toEqual([tool]);
  });

  it.each(["denied", "unknown", "error", "prose", "conflicting"])("rejects %s result even with native success status", (kind) => {
    const capture = createNativeCrewToolCapture(adapter, [tool])!;
    const events = fixture(adapter);
    const output = kind === "prose" ? 'success: true; tool completed'
      : JSON.stringify(kind === "denied" ? { success: false, error: "denied" }
        : kind === "unknown" ? { data: "unknown" }
          : kind === "conflicting" ? { success: true, error: "denied" } : { success: true });
    alterResult(adapter, events, adapter === "claude_local" ? { content: output, ...(kind === "error" ? { is_error: true } : {}) }
      : { output, ...(kind === "error" ? adapter === "gemini_local" ? { error: { message: "denied" } } : { status: "error" } : {}) });
    send(capture, events);
    expect(capture.names()).toEqual([]);
  });

  it("rejects foreign, unqualified and disallowed names", () => {
    const capture = createNativeCrewToolCapture(adapter, [tool])!;
    for (const name of ["foreign", "unqualified", "disallowed"]) {
      const events = fixture(adapter, name, name === "disallowed" ? "unlisted.tool" : tool);
      const alias = name === "unqualified" ? tool : "foreign_tool";
      if (name !== "disallowed") {
        if (adapter === "claude_local") events[0].message.content[0].name = alias;
        else if (adapter === "gemini_local") events[0].tool_name = alias;
        else events[0].part.tool = alias;
      }
      send(capture, events);
    }
    expect(capture.names()).toEqual([]);
  });

  it("does not interpret nested JSON or assistant prose as protocol events", () => {
    const capture = createNativeCrewToolCapture(adapter, [tool])!;
    send(capture, [{ type: "message", role: "assistant", content: JSON.stringify(fixture(adapter)) }, { text: JSON.stringify(fixture(adapter)) }]);
    expect(capture.names()).toEqual([]);
  });

  it("recovers from malformed and oversized split lines without parsing their suffix", () => {
    const capture = createNativeCrewToolCapture(adapter, [tool])!;
    capture.push("malformed\n");
    capture.push("x".repeat(65_536));
    capture.push(`x${fixture(adapter).map((event) => JSON.stringify(event)).join("")}\n`);
    capture.flush();
    expect(capture.names()).toEqual([]);
    send(capture, fixture(adapter, "recover"));
    expect(capture.names()).toEqual([tool]);
  });

  it("rejects namespace aliases shared with a foreign connector server", () => {
    const connector = adapter === "claude_local" ? "aoa__hub" : "aoa_hub";
    const name = adapter === "claude_local" ? "hub__updateCurationSummary" : adapter === "gemini_local" ? "hub_updateCurationSummary" : tool;
    const capture = createNativeCrewToolCapture(adapter, [name], [name], [connector])!;
    const events = fixture(adapter, "fixture-call", name);
    send(capture, events);
    expect(capture.names()).toEqual([]);
  });

  it("caps unique observed names at 128 and ignores malformed allowlist names", () => {
    const names = Array.from({ length: 129 }, (_, index) => `tool_${index}`);
    const capture = createNativeCrewToolCapture(adapter, [...names, "invalid\nname", null])!;
    for (const [index, name] of names.entries()) send(capture, fixture(adapter, `call-${index}`, name));
    expect(capture.names()).toHaveLength(128);
    expect(capture.names()).not.toContain("tool_128");
  });
});

describe.each(["claude_local", "gemini_local"])("%s correlated call identity", (adapter) => {
  it("rejects orphan, out-of-order and replayed successful results", () => {
    const capture = createNativeCrewToolCapture(adapter, [tool])!;
    const [call, result] = fixture(adapter);
    send(capture, [result, call, result]);
    expect(capture.names()).toEqual([]);
    const failed = fixture(adapter, "failed");
    alterResult(adapter, failed, adapter === "claude_local" ? { is_error: true } : { status: "error" });
    send(capture, failed);
    send(capture, fixture(adapter, "failed"));
    expect(capture.names()).toEqual([]);
  });

  it("invalidates a duplicate call ID even when a foreign call reuses it", () => {
    const capture = createNativeCrewToolCapture(adapter, [tool])!;
    const [call, result] = fixture(adapter);
    const [foreign] = fixture(adapter, "fixture-call", "foreign.tool");
    send(capture, [call, foreign, result]);
    expect(capture.names()).toEqual([]);
  });

  it("bounds pending calls without evicting and misattributing old identities", () => {
    const capture = createNativeCrewToolCapture(adapter, [tool])!;
    for (let index = 0; index < 129; index++) send(capture, [fixture(adapter, `call-${index}`)[0]]);
    send(capture, [fixture(adapter, "call-128")[1]]);
    expect(capture.names()).toEqual([]);
    send(capture, [fixture(adapter, "call-0")[1]]);
    expect(capture.names()).toEqual([tool]);
  });

  it("stops admitting new IDs after the lifetime identity cap", () => {
    const capture = createNativeCrewToolCapture(adapter, [tool])!;
    for (let index = 0; index < 1024; index++) send(capture, [fixture(adapter, `foreign-${index}`, "foreign.tool")[0]]);
    send(capture, fixture(adapter, "beyond-cap"));
    expect(capture.names()).toEqual([]);
  });
});

it.each(["claude_local", "opencode_local"])("rejects %s sanitization collisions even when one canonical name is disallowed", (adapter) => {
  const capture = createNativeCrewToolCapture(adapter, [tool], [tool, "hub_updateCurationSummary"])!;
  send(capture, fixture(adapter));
  expect(capture.names()).toEqual([]);
});

it("rejects unqualified Gemini truncation aliases", () => {
  const name = `tool_${"a".repeat(80)}`;
  const capture = createNativeCrewToolCapture("gemini_local", [name])!;
  send(capture, fixture("gemini_local", "long", name));
  expect(capture.names()).toEqual([]);
});

it("rejects a Gemini connector whose existing mcp_ prefix collides with the AoA namespace", () => {
  const capture = createNativeCrewToolCapture("gemini_local", [tool], [tool], ["mcp_aoa"])!;
  send(capture, fixture("gemini_local"));
  expect(capture.names()).toEqual([]);
});

it("ignores nested Claude agent tool events", () => {
  const capture = createNativeCrewToolCapture("claude_local", [tool])!;
  send(capture, fixture("claude_local").map((event) => ({ ...event, parent_tool_use_id: "child-agent" })));
  expect(capture.names()).toEqual([]);
});

it("rejects malformed Claude is_error instead of interpreting it as success", () => {
  const capture = createNativeCrewToolCapture("claude_local", [tool])!;
  const events = fixture("claude_local");
  alterResult("claude_local", events, { is_error: "true" });
  send(capture, events);
  expect(capture.names()).toEqual([]);
});

it("rejects truncated OpenCode output and never derives success from structured metadata", () => {
  const capture = createNativeCrewToolCapture("opencode_local", [tool])!;
  const events = fixture("opencode_local");
  alterResult("opencode_local", events, { metadata: { truncated: true }, structuredContent: { success: true } });
  send(capture, events);
  expect(capture.names()).toEqual([]);
});

it("does not create native capture for an unknown adapter", () => {
  expect(createNativeCrewToolCapture("process", [tool])).toBeNull();
});
