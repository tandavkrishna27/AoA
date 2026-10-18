export const nativeCrewAdapterTypes = ["codex_local", "claude_local", "gemini_local", "opencode_local"] as const;

export function successfulCrewToolEvents(adapterType: string, tool = "hub.updateCurationSummary", id = "fixture-call") {
  const output = JSON.stringify({ success: true, data: "private-result-url?token=fixture" });
  if (adapterType === "claude_local") return [
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: `mcp__aoa__${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`, input: { private: "fixture-argument" } }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: [{ type: "text", text: output }] }] } },
  ];
  if (adapterType === "gemini_local") return [
    { type: "tool_use", tool_id: id, tool_name: `mcp_aoa_${tool}`, parameters: { private: "fixture-argument" } },
    { type: "tool_result", tool_id: id, status: "success", output },
  ];
  if (adapterType === "opencode_local") return [
    { type: "tool_use", part: { type: "tool", callID: id, tool: `aoa_${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`, state: { status: "completed", input: { private: "fixture-argument" }, output, metadata: { truncated: false } } } },
  ];
  return [{ type: "item.completed", item: {
    id, type: "mcp_tool_call", server: "aoa", tool, status: "completed", error: null,
    arguments: { private: "fixture-argument" }, result: { content: [{ type: "text", text: output }] },
  } }];
}
