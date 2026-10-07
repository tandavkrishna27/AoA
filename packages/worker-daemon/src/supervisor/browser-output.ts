/** Guest output is untrusted. Bound bytes and queued intents before parsing. */
export function createBrowserOutput(input: { receive(message: unknown): Promise<void> }) {
  let buffer = ""; let count = 0; let failed = false; let closed = false;
  let pending = Promise.resolve();
  function line(text: string) {
    if (++count > 128) { failed = true; return; }
    try {
      const message: unknown = JSON.parse(text);
      pending = pending.then(() => input.receive(message)).catch(() => { failed = true; });
    } catch { failed = true; }
  }
  return {
    onStdout(chunk: string) {
      if (closed || failed) return;
      if (typeof chunk !== "string" || chunk.length > 16384) { failed = true; return; }
      for (const part of chunk.split(/(?<=\n)/)) {
        buffer += part;
        if (buffer.length > 16384) { failed = true; buffer = ""; return; }
        if (part.endsWith("\n")) { line(buffer); buffer = ""; }
      }
    },
    async close() { closed = true; if (buffer.trim()) line(buffer); buffer = ""; await pending; return !failed; },
  };
}
