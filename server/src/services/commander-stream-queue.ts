import type { AgentStreamChunk } from "./internal-agent/agent-loop.js";
/** The owned operation continues after an HTTP reader disconnects. Bounded UI
 * delivery stops retaining chunks; result persistence remains the owner's job. */
export function createCommanderStreamQueue<T>(run: (emit: (chunk: AgentStreamChunk) => void) => Promise<T>) {
  const pending: AgentStreamChunk[] = []; let finished = false; let receiving = true; let overflowed = false;
  let wake: (() => void) | undefined;
  const result = run((chunk) => {
    if (!receiving || overflowed) return;
    if (pending.length >= 1024) { overflowed = true; return; }
    pending.push(chunk); wake?.(); wake = undefined;
  });
  // Keep rejection observed while a generator is still yielding partial output.
  void result.then(() => { finished = true; wake?.(); }, () => { finished = true; wake?.(); });
  return { result, async *chunks(): AsyncGenerator<AgentStreamChunk> {
    try {
      while (!finished || pending.length) {
        const chunk = pending.shift(); if (chunk) { yield chunk; continue; }
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    } finally { receiving = false; pending.length = 0; }
  } };
}
/** Delivered output must be a prefix of the accepted output, never a reordered
 * subset. A mismatch fails closed; durable history still uses the accepted artifact. */
export function removeDeliveredCommanderChunks(final: AgentStreamChunk[], delivered: AgentStreamChunk[]): AgentStreamChunk[] {
  const key = (chunk: AgentStreamChunk) => JSON.stringify(chunk.type === "action_confirmation"
    ? { type: chunk.type, toolName: chunk.toolName, params: chunk.params } : chunk);
  for (let i = 0; i < delivered.length; i += 1) {
    if (!final[i] || final[i]!.type === "done" || key(final[i]!) !== key(delivered[i]!)) {
      throw new Error("Commander live output differs from accepted result");
    }
  }
  return final.slice(delivered.length);
}
