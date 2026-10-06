import { scrubOutputText } from "./run-output.js";
export const COMMANDER_STREAM_LOG_PREFIX = "aoa-commander-stream-v1:";
/** Complete lines only; each event remains within the frozen log payload bound.
 * This bounded, per-run channel is optional and never substitutes for the final artifact. */
export function createCommanderLiveOutput(options: {
  canaries: readonly string[]; emit(message: string): Promise<unknown>; maxEvents?: number;
}) {
  let buffer = ""; let closed = false; let disabled = false; let count = 0;
  const pending: Promise<unknown>[] = [];
  const maxEvents = Math.max(0, Math.min(options.maxEvents ?? 480, 480));
  function line(value: string) {
    if (count >= maxEvents || value.length > 65000) return;
    const scrubbed = scrubOutputText(value, options.canaries);
    if (scrubbed === null) { disabled = true; return; }
    count += 1;
    try { pending.push(Promise.resolve(options.emit(COMMANDER_STREAM_LOG_PREFIX + scrubbed)).catch(() => undefined)); }
    catch { /* Log observation cannot fail tenant execution. */ }
  }
  return {
    onStdout(chunk: string): void {
      if (closed || disabled || count >= maxEvents || typeof chunk !== "string") return;
      for (const part of chunk.split(/(?<=\n)/)) {
        if (disabled) return;
        const complete = part.endsWith("\n");
        buffer += part;
        if (buffer.length > 65000) { buffer = ""; disabled = true; return; }
        if (complete) { line(buffer); buffer = ""; }
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if (buffer && !disabled) line(buffer);
      buffer = "";
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([Promise.all(pending), new Promise<void>((resolve) => { timer = setTimeout(resolve, 5000); })]); }
      finally { if (timer) clearTimeout(timer); }
    },
  };
}
