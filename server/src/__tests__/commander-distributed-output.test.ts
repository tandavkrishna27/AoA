import { describe, expect, it } from "vitest";
import { parseCommanderDistributedOutput } from "../services/commander-distributed-output.js";
const result = { version: 1 as const, operationId: "turn", stdout: [JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "accepted answer" } } }), JSON.stringify({ type: "result", is_error: false, usage: { input_tokens: 4, output_tokens: 2 }, total_cost_usd: 0 })].join("\n"), stderr: "", exitCode: 0, timedOut: false, durationMs: 20, captureError: null };
const base = { result, cliTool: "claude_cli", turnId: "turn", model: "claude-sonnet-4-6" };
describe("Commander accepted output parsing", () => {
  it("returns ordinary text/tools and one done with the actual pinned provenance", async () => {
    const chunks = await parseCommanderDistributedOutput(base);
    expect(chunks).toContainEqual({ type: "text", delta: "accepted answer" });
    const done = chunks.filter((chunk) => chunk.type === "done"); expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ summary: { runId: "turn", model: base.model, provider: "anthropic", durationMs: 20, tokenUsage: { inputTokens: 4, outputTokens: 2 } } });
  });
  it("parses Codex JSONL with the same assistant summary and real usage", async () => {
    const stdout = [JSON.stringify({ type: "thread.started", thread_id: "thread" }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "codex answer" } }), JSON.stringify({ type: "turn.completed", usage: { input_tokens: 4, output_tokens: 2 } })].join("\n");
    const chunks = await parseCommanderDistributedOutput({ ...base, cliTool: "codex", model: "gpt-4.1", result: { ...result, stdout } });
    expect(chunks).toContainEqual({ type: "text", delta: "codex answer" }); expect(chunks.find((chunk) => chunk.type === "done")).toMatchObject({ summary: { provider: "openai", model: "gpt-4.1", tokenUsage: { inputTokens: 4, outputTokens: 2 } } });
  });
  it.each([{ exitCode: 7 }, { timedOut: true }, { stdout: "" }, { stdout: JSON.stringify({ type: "result", is_error: true, result: "CLI failed" }) }])("rejects incomplete or failed CLI output", async (change) => {
    await expect(parseCommanderDistributedOutput({ ...base, result: { ...result, ...change } })).rejects.toThrow();
  });
});
