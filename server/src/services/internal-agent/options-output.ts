import { normalizeCommanderOptions } from "@armyofagents/shared";
import type { AgentStreamChunk } from "./agent-loop.js";

/** Choices are conversational intent only. This parser never emits approvals. */
export function parseOptionsOutput(text: string): AgentStreamChunk[] {
  const chunks: AgentStreamChunk[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/⚡OPTIONS:([\s\S]*?)⚡/g)) {
    let normalized;
    try {
      normalized = normalizeCommanderOptions(JSON.parse(match[1]));
    } catch {
      continue;
    }
    if (!normalized) continue;
    if (match.index > cursor) {
      chunks.push({ type: "text", delta: text.slice(cursor, match.index) });
    }
    chunks.push({
      type: "options_prompt",
      ...normalized,
      promptId: crypto.randomUUID(),
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    chunks.push({ type: "text", delta: text.slice(cursor) });
  }
  return chunks.length ? chunks : [{ type: "text", delta: text }];
}
