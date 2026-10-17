import { createCodexCrewToolCapture, type CodexCrewToolCapture } from "./codex-crew-tool-capture.js";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function successfulEnvelope(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const envelope = record(JSON.parse(value));
    return envelope?.success === true && envelope.error == null;
  } catch {
    return false;
  }
}

export function createNativeCrewToolCapture(
  adapterType: string,
  allowlist: readonly unknown[],
  toolNames: readonly unknown[] = allowlist,
  connectorServerNames: readonly string[] = [],
): CodexCrewToolCapture | null {
  if (adapterType === "codex_local") return createCodexCrewToolCapture(allowlist);
  if (!["claude_local", "gemini_local", "opencode_local"].includes(adapterType)) return null;
  const validName = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(value);
  const allowed = new Set(allowlist.filter(validName));
  const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const prefix = (server: string) => adapterType === "claude_local" ? `mcp__${sanitize(server)}__`
    : adapterType === "gemini_local" ? `${server.startsWith("mcp_") ? "" : "mcp_"}${server.replace(/[^a-zA-Z0-9_\-.:]/g, "_")}_` : `${sanitize(server)}_`;
  const aliases = new Map<string, string | null>();
  for (const name of new Set([...toolNames, ...allowlist].filter(validName))) {
    const alias = prefix("aoa") + (adapterType === "gemini_local" ? name : sanitize(name));
    if (adapterType === "gemini_local" && alias.length > 63) continue;
    if (connectorServerNames.some((server) => alias.startsWith(prefix(server)))) continue;
    aliases.set(alias, aliases.has(alias) ? null : name);
  }
  const observed = new Set<string>();
  const seenIds = new Set<string>();
  const pending = new Map<string, string>();
  let carry = "";
  let discarding = false;

  function begin(id: unknown, alias: unknown): void {
    if (typeof id !== "string" || !id || id.length > 256) return;
    if (seenIds.has(id)) {
      pending.delete(id);
      return;
    }
    if (seenIds.size >= 1024) return;
    seenIds.add(id);
    const name = typeof alias === "string" ? aliases.get(alias) : null;
    if (name && allowed.has(name) && pending.size < 128) pending.set(id, name);
  }

  function finish(id: unknown, successful: boolean): void {
    if (typeof id !== "string" || !id || id.length > 256) return;
    const name = pending.get(id);
    pending.delete(id);
    if (seenIds.size < 1024) seenIds.add(id);
    if (name && successful && observed.size < 128) observed.add(name);
  }

  function collect(line: string): void {
    try {
      const event = record(JSON.parse(line));
      if (!event || event.parent_tool_use_id != null) return;
      if (adapterType === "claude_local") {
        const message = record(event.message);
        if (!message || !Array.isArray(message.content) || message.content.length > 128) return;
        for (const raw of message.content) {
          const block = record(raw);
          if (!block) continue;
          if (event.type === "assistant" && message.role === "assistant" && block.type === "tool_use") begin(block.id, block.name);
          if (event.type !== "user" || message.role !== "user" || block.type !== "tool_result") continue;
          const content = block.content;
          const output = Array.isArray(content) && content.length === 1 && record(content[0])?.type === "text"
            ? record(content[0])?.text : content;
          finish(block.tool_use_id, (block.is_error == null || block.is_error === false) && successfulEnvelope(output));
        }
      } else if (adapterType === "gemini_local") {
        if (event.type === "tool_use") begin(event.tool_id, event.tool_name);
        if (event.type === "tool_result") finish(event.tool_id, event.status === "success" && event.error == null && successfulEnvelope(event.output));
      } else if (event.type === "tool_use") {
        const part = record(event.part);
        const state = record(part?.state);
        if (part?.type !== "tool" || !state) return;
        begin(part.callID, part.tool);
        finish(part.callID, state.status === "completed" && state.error == null && record(state.metadata)?.truncated === false && successfulEnvelope(state.output));
      }
    } catch {}
  }

  return {
    push(chunk) {
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf("\n", offset);
        const end = newline === -1 ? chunk.length : newline;
        if (discarding) {
          if (newline !== -1) discarding = false;
        } else if (carry.length + end - offset > 65_536) {
          carry = "";
          discarding = newline === -1;
        } else {
          carry += chunk.slice(offset, end);
          if (newline !== -1) {
            collect(carry);
            carry = "";
          }
        }
        if (newline === -1) return;
        offset = newline + 1;
      }
    },
    flush() {
      if (!discarding && carry) collect(carry);
      carry = "";
      discarding = false;
    },
    names: () => [...observed],
  };
}
