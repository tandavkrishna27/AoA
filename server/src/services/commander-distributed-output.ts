import { showRefSchema } from "@armyofagents/shared";
import type { AgentStreamChunk } from "./internal-agent/agent-loop.js";
import { StreamJsonParser } from "./internal-agent/parse-stream-json.js";
import { computeCostCents, isKnownRateModel } from "./internal-agent/cost-model.js";
import type { CapturedOneShotResult } from "./one-shot-distributed-result.js";
export async function parseCommanderDistributedOutput(input: {
  result: CapturedOneShotResult; cliTool: string; turnId: string; model: string;
}): Promise<AgentStreamChunk[]> {
  if (input.result.operationId !== input.turnId || input.result.exitCode !== 0 || input.result.timedOut) throw new Error("Commander distributed CLI failed");
  if (!isKnownRateModel(input.model)) throw new Error("Commander model has no known cost rate");
  let chunks: AgentStreamChunk[];
  if (input.cliTool === "codex") {
    const { parseCodexJsonl } = await import("@armyofagents/adapter-codex-local/server");
    const parsed = parseCodexJsonl(input.result.stdout);
    if (!parsed.summary && !(parsed.chunks?.length)) throw new Error("Commander CLI produced no result");
    chunks = (parsed.chunks ?? []).map((chunk) => chunk.type === "tool_result" ? { ...chunk,
      refs: (Array.isArray(chunk.refs) ? chunk.refs : []).flatMap((ref) => { const checked = showRefSchema.safeParse(ref); return checked.success ? [checked.data] : []; }) } : chunk);
    if (parsed.summary) chunks.push({ type: "text", delta: parsed.summary });
    chunks.push({ type: "done", summary: { runId: input.turnId, toolsCalled: [], durationMs: input.result.durationMs, costCents: 0,
      tokenUsage: { inputTokens: parsed.usage?.inputTokens ?? 0, outputTokens: parsed.usage?.outputTokens ?? 0,
        cachedInputTokens: parsed.usage?.cachedInputTokens ?? 0 } } });
  } else if (input.cliTool === "claude_cli") {
    const parser = new StreamJsonParser(); chunks = [...parser.push(input.result.stdout), ...parser.flush()];
  } else throw new Error("Commander distributed CLI unsupported");
  const error = chunks.find((chunk) => chunk.type === "error");
  if (error?.type === "error") throw new Error(error.message);
  const done = chunks.findLast((chunk) => chunk.type === "done");
  if (!done || done.type !== "done") throw new Error("Commander CLI produced no terminal result");
  const provider = input.cliTool === "codex" ? "openai" : "anthropic";
  const toolsCalled = [...new Set(chunks.flatMap((chunk) => chunk.type === "tool_call" || chunk.type === "tool_result" ? [chunk.name] : []))];
  return [...chunks.filter((chunk) => chunk.type !== "done"), { type: "done", summary: {
    ...done.summary, runId: input.turnId, durationMs: input.result.durationMs, model: input.model, provider, toolsCalled,
    costCents: computeCostCents(provider, input.model, done.summary.tokenUsage.inputTokens, done.summary.tokenUsage.outputTokens),
  } }];
}
