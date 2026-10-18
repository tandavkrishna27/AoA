export interface CodexCrewToolCapture {
  push(chunk: string): void;
  flush(): void;
  names(): string[];
}

export function createCodexCrewToolCapture(allowlist: readonly unknown[]): CodexCrewToolCapture {
  const allowedNames = new Set(allowlist.filter((name): name is string =>
    typeof name === "string" && /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(name),
  ));
  const observedNames = new Set<string>();
  let carry = "";
  let discarding = false;

  function collect(line: string): void {
    if (observedNames.size >= 128) return;
    try {
      const event = JSON.parse(line);
      const item = event?.item;
      if (
        event?.type !== "item.completed" || item?.type !== "mcp_tool_call"
        || item.server !== "aoa" || item.status !== "completed" || item.error != null
        || !allowedNames.has(item.tool)
      ) return;
      const result = item.result;
      if (!result || result.isError === true || result.structured_content?.success === false) return;
      let successful = result.structured_content?.success === true;
      const content = Array.isArray(result.content) ? result.content.slice(0, 16) : [];
      for (const entry of content) {
        if (entry?.type !== "text" || typeof entry.text !== "string") continue;
        try {
          const envelope = JSON.parse(entry.text);
          if (envelope?.success === false) return;
          if (envelope?.success === true) successful = true;
        } catch {}
      }
      if (successful) observedNames.add(item.tool);
    } catch {}
  }

  return {
    push(chunk) {
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf("\n", offset);
        const end = newline === -1 ? chunk.length : newline;
        const fragment = chunk.slice(offset, end);
        if (discarding) {
          if (newline !== -1) discarding = false;
        } else if (carry.length + fragment.length > 65_536) {
          carry = "";
          discarding = newline === -1;
        } else {
          carry += fragment;
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
    names: () => [...observedNames],
  };
}
